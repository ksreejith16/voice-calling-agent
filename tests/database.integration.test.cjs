const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { sql } = require('drizzle-orm');
const { createDatabase, withTenantTransaction } = require('../packages/database/dist');

function testUrl(name, username) {
  assert.ok(process.env[name], `${name} must name the disposable local test database`);
  const url = new URL(process.env[name]);
  assert.equal(url.pathname, '/voice_platform_test', 'Refusing to reset a database other than voice_platform_test');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Integration tests require a local database');
  assert.equal(url.username, username);
  return url.toString();
}

let owner, runtime, database, admin;
const tenantA = randomUUID(), tenantB = randomUUID();
let a, b;
const tables = ['organizations', 'users', 'wallets', 'wallet_transactions', 'wallet_reservations', 'campaigns', 'leads', 'call_logs'];

async function transaction(tenant, work) {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    if (tenant) await client.query("SELECT set_config('app.organization_id', $1, true)", [tenant]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
async function insert(client, table, values) {
  // Table and column names come only from hard-coded test fixtures.
  const columns = Object.keys(values);
  const result = await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, Object.values(values));
  return result.rows[0];
}
function callValues(f, extra = {}) {
  return { organization_id: f.org, campaign_id: f.campaign.id, lead_id: f.lead.id, wallet_id: f.wallet.id,
    attempt_number: 1, idempotency_key: randomUUID(), rate_paise_per_minute: '100',
    max_connected_duration_seconds: 60, ...extra };
}
function reservationValues(f, callId = f.call.id, extra = {}) {
  return { organization_id: f.org, wallet_id: f.wallet.id, call_id: callId,
    idempotency_key: randomUUID(), authorized_amount_paise: '200', rate_paise_per_minute: '100',
    max_connected_duration_seconds: 60, expires_at: new Date(Date.now() + 3600000), ...extra };
}
function creditValues(f, extra = {}) {
  return { organization_id: f.org, wallet_id: f.wallet.id, reason: 'top_up', direction: 'credit',
    amount_paise: '100', balance_before_paise: '1000', balance_after_paise: '1100',
    reserved_before_paise: '0', reserved_after_paise: '0', idempotency_key: randomUUID(),
    provider: 'test-provider', provider_account_id: 'test-account', provider_event_id: randomUUID(),
    provider_payment_id: randomUUID(), payment_verified_at: new Date(), description: 'Synthetic verified test event', ...extra };
}
function chargeValues(f, extra = {}) {
  return { organization_id: f.org, wallet_id: f.wallet.id, call_id: f.call.id, reservation_id: f.reservation.id,
    reason: 'call_charge', direction: 'debit', amount_paise: '100', balance_before_paise: '1000',
    balance_after_paise: '900', reserved_before_paise: '200', reserved_after_paise: '0',
    idempotency_key: randomUUID(), description: 'Synthetic call charge', ...extra };
}
async function rejectsSql(tenant, code, work) {
  await assert.rejects(transaction(tenant, work), error => error.code === code);
}

before(async () => {
  owner = new Pool({ connectionString: testUrl('TEST_MIGRATION_DATABASE_URL', 'voice_migrator'), connectionTimeoutMillis: 5000 });
  admin = new Pool({ connectionString: testUrl('TEST_ADMIN_DATABASE_URL', 'postgres'), connectionTimeoutMillis: 5000 });
  runtime = new Pool({ connectionString: testUrl('TEST_DATABASE_URL', 'voice_app'), max: 1, connectionTimeoutMillis: 5000 });
  database = createDatabase({ connectionString: testUrl('TEST_DATABASE_URL', 'voice_app'), maxConnections: 1 });
  // Explicitly destructive ONLY inside the dedicated disposable local test DB.
  await owner.query('DROP SCHEMA IF EXISTS public CASCADE');
  await owner.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
  await owner.query('CREATE SCHEMA public AUTHORIZATION voice_migrator');
  await migrate(drizzle(owner), { migrationsFolder: path.resolve('packages/database/drizzle') });
  // A second application must be a no-op, exercising versioned migration tracking.
  await migrate(drizzle(owner), { migrationsFolder: path.resolve('packages/database/drizzle') });
  async function fixture(org, name) {
    await insert(admin, 'organizations', { id: org, name, slug: name.toLowerCase() });
    return transaction(org, async client => {
      const wallet = await insert(client, 'wallets', { organization_id: org, balance_paise: '1000' });
      const campaign = await insert(client, 'campaigns', { organization_id: org, name: 'Test campaign', rate_paise_per_minute: '100', max_connected_duration_seconds: 60 });
      const campaign2 = await insert(client, 'campaigns', { organization_id: org, name: 'Second campaign', rate_paise_per_minute: '100', max_connected_duration_seconds: 60 });
      const lead = await insert(client, 'leads', { organization_id: org, campaign_id: campaign.id, phone_e164: '+919876543210', source: 'test', idempotency_key: randomUUID() });
      await insert(client, 'users', { organization_id: org, auth_issuer: 'https://test.invalid', auth_subject: name, email: `${name}@example.invalid` });
      const f = { org, wallet, campaign, campaign2, lead };
      f.call = await insert(client, 'call_logs', callValues(f));
      f.reservation = await insert(client, 'wallet_reservations', reservationValues(f));
      f.credit = await insert(client, 'wallet_transactions', creditValues(f));
      return f;
    });
  }
  a = await fixture(tenantA, 'TenantA');
  b = await fixture(tenantB, 'TenantB');
});
after(async () => { await Promise.all([owner?.end(), runtime?.end(), database?.close(), admin?.end()]); });

test('fresh migrations install all eight tables with a restricted non-owner role and forced RLS', async () => {
  const result = await runtime.query('SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = current_user');
  assert.deepEqual(result.rows[0], { rolsuper: false, rolbypassrls: false, rolcreaterole: false });
  const definitions = await runtime.query("SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'");
  assert.equal(definitions.rowCount, 8);
  for (const row of definitions.rows) { assert.equal(row.owner, 'voice_migrator'); assert.ok(row.relrowsecurity && row.relforcerowsecurity); }
});
test('missing tenant context sees no rows in every table', async () => {
  for (const table of tables) assert.equal((await runtime.query(`SELECT * FROM ${table}`)).rowCount, 0, table);
});
test('both organizations can read only their own rows in all eight tables', async () => {
  for (const f of [a, b]) await transaction(f.org, async client => {
    for (const table of tables) {
      const rows = (await client.query(`SELECT * FROM ${table}`)).rows;
      assert.ok(rows.length > 0, table);
      for (const row of rows) assert.equal(table === 'organizations' ? row.id : row.organization_id, f.org);
    }
  });
});
test('writes with missing context or another tenant identity are rejected by RLS', async () => {
  await rejectsSql(null, '42501', client => insert(client, 'campaigns', { organization_id: tenantA, name: 'Blocked', rate_paise_per_minute: '100', max_connected_duration_seconds: 60 }));
  await rejectsSql(tenantA, '42501', client => insert(client, 'campaigns', { organization_id: tenantB, name: 'Blocked', rate_paise_per_minute: '100', max_connected_duration_seconds: 60 }));
  await rejectsSql(tenantA, '23514', client => client.query('UPDATE campaigns SET organization_id=$1 WHERE id=$2', [tenantB, a.campaign2.id]));
  assert.equal(await transaction(tenantA, async client => (await client.query('UPDATE campaigns SET name=$1 WHERE id=$2', ['invisible', b.campaign.id])).rowCount), 0);
});
test('tenant context clears after commit and rollback on the same pooled connection', async () => {
  const result = await withTenantTransaction(database.db, tenantA, tx => tx.execute(sql`SELECT id FROM organizations`));
  assert.deepEqual(result.rows.map(row => row.id), [tenantA]);
  assert.equal((await database.pool.query('SELECT * FROM organizations')).rowCount, 0);
  await assert.rejects(withTenantTransaction(database.db, tenantB, async tx => { await tx.execute(sql`SELECT id FROM organizations`); throw new Error('rollback fixture'); }), /rollback fixture/);
  assert.equal((await database.pool.query('SELECT * FROM organizations')).rowCount, 0);
});
test('cross-tenant campaign, wallet, call and reservation references are rejected', async () => {
  await rejectsSql(tenantA, '23503', client => insert(client, 'leads', { organization_id: tenantA, campaign_id: b.campaign.id, phone_e164: '+919876543210', source: 'test', idempotency_key: randomUUID() }));
  await rejectsSql(tenantA, '23503', client => insert(client, 'call_logs', callValues(a, { wallet_id: b.wallet.id, attempt_number: 2 })));
  await rejectsSql(tenantA, '23503', client => insert(client, 'wallet_reservations', reservationValues(a, b.call.id)));
  await rejectsSql(tenantA, '23514', client => insert(client, 'wallet_transactions', chargeValues(a, { reservation_id: b.reservation.id })));
});
test('a call cannot reference a lead belonging to another campaign of the same tenant', async () => {
  await rejectsSql(tenantA, '23503', client => insert(client, 'call_logs', callValues(a, { campaign_id: a.campaign2.id, attempt_number: 2 })));
});
test('negative balances, negative holds, excess holds and duplicate wallets are rejected', async () => {
  for (const statement of ['balance_paise = -1', 'reserved_paise = -1', 'reserved_paise = 1001'])
    await rejectsSql(tenantA, '23514', client => client.query(`UPDATE wallets SET ${statement} WHERE id=$1`, [a.wallet.id]));
  await rejectsSql(tenantA, '23505', client => insert(client, 'wallets', { organization_id: tenantA }));
});
test('duplicate payment event, payment credit and tenant idempotency key are rejected', async () => {
  for (const extra of [{ provider_event_id: a.credit.provider_event_id }, { provider_payment_id: a.credit.provider_payment_id }, { idempotency_key: a.credit.idempotency_key }])
    await rejectsSql(tenantA, '23505', client => insert(client, 'wallet_transactions', creditValues(a, extra)));
  await rejectsSql(tenantB, '23505', client => insert(client, 'wallet_transactions', creditValues(b, { provider_payment_id: a.credit.provider_payment_id })));
});
test('duplicate call charges and provider call IDs are rejected', async () => {
  await transaction(tenantA, async client => {
    await client.query("UPDATE call_logs SET status='completed', ended_at=now(), connected_duration_seconds=30, duration_verified_at=now(), duration_source_reference='test-cdr' WHERE id=$1", [a.call.id]);
    await client.query("UPDATE wallet_reservations SET status='awaiting_settlement' WHERE id=$1", [a.reservation.id]);
    await client.query("UPDATE wallet_reservations SET status='settled', settled_amount_paise=100, released_amount_paise=100, settled_at=now(), released_at=now() WHERE id=$1", [a.reservation.id]);
  });
  await transaction(tenantA, client => insert(client, 'wallet_transactions', chargeValues(a)));
  await rejectsSql(tenantA, '23505', client => insert(client, 'wallet_transactions', chargeValues(a)));
  await transaction(tenantA, client => client.query("UPDATE call_logs SET provider='test', provider_account_id='test', provider_call_id='call-unique' WHERE id=$1", [a.call.id]));
  await rejectsSql(tenantB, '23505', client => client.query("UPDATE call_logs SET provider='test', provider_account_id='test', provider_call_id='call-unique' WHERE id=$1", [b.call.id]));
});
test('ledger UPDATE, DELETE and TRUNCATE are prohibited', async () => {
  await rejectsSql(tenantA, '42501', client => client.query("UPDATE wallet_transactions SET description='tampered' WHERE id=$1", [a.credit.id]));
  await rejectsSql(tenantA, '42501', client => client.query('DELETE FROM wallet_transactions WHERE id=$1', [a.credit.id]));
  await rejectsSql(tenantA, '42501', client => client.query('TRUNCATE wallet_transactions'));
});
test('reservation amount must fund the snapshotted duration including margin', async () => {
  await rejectsSql(tenantA, '23514', async client => {
    const call = await insert(client, 'call_logs', callValues(a, { attempt_number: 3 }));
    return insert(client, 'wallet_reservations', reservationValues(a, call.id, { authorized_amount_paise: '100' }));
  });
});
test('reservation accounting, expiry evidence and illegal lifecycle transitions are rejected', async () => {
  await rejectsSql(tenantB, '23514', client => client.query("UPDATE wallet_reservations SET settled_amount_paise=1 WHERE id=$1", [b.reservation.id]));
  await rejectsSql(tenantB, '23514', client => client.query("UPDATE wallet_reservations SET status='expired', released_amount_paise=200, released_at=now() WHERE id=$1", [b.reservation.id]));
  await rejectsSql(tenantB, '23514', client => client.query("UPDATE wallet_reservations SET status='settled', settled_amount_paise=100, released_amount_paise=100, settled_at=now(), released_at=now() WHERE id=$1", [b.reservation.id]));
});
test('call and reservation billing snapshots cannot be edited', async () => {
  await rejectsSql(tenantA, '23514', client => client.query('UPDATE call_logs SET rate_paise_per_minute=200 WHERE id=$1', [a.call.id]));
  await rejectsSql(tenantB, '23514', client => client.query('UPDATE wallet_reservations SET rate_paise_per_minute=200, authorized_amount_paise=400 WHERE id=$1', [b.reservation.id]));
});
test('30-second billing rejects odd rates and invalid E.164 phones are rejected', async () => {
  await rejectsSql(tenantA, '23514', client => client.query('UPDATE campaigns SET billing_quantum_seconds=30, rate_paise_per_minute=101 WHERE id=$1', [a.campaign.id]));
  await rejectsSql(tenantA, '23514', client => client.query("UPDATE leads SET phone_e164='9876543210' WHERE id=$1", [a.lead.id]));
});
test('never-connected call cannot carry a charge and settlement requires verified duration', async () => {
  await rejectsSql(tenantB, '23514', client => client.query('UPDATE call_logs SET connected_duration_seconds=0, charged_paise=100, billable_seconds=60 WHERE id=$1', [b.call.id]));
  await rejectsSql(tenantB, '23514', client => client.query("UPDATE call_logs SET settlement_status='settled', settled_at=now() WHERE id=$1", [b.call.id]));
});
test('audit triggers reject privileged ledger edits and runtime cannot assume the owner role', async () => {
  await assert.rejects(admin.query("UPDATE wallet_transactions SET description='tampered' WHERE id=$1", [a.credit.id]), error => error.code === '23514');
  await rejectsSql(tenantA, '42501', client => client.query('SET ROLE voice_migrator'));
});
test('a connected failed call settles from authoritative duration and cannot release its whole hold', async () => {
  await transaction(tenantB, async client => {
    await client.query("UPDATE call_logs SET status='failed', ended_at=now(), connected_duration_seconds=61, duration_verified_at=now(), duration_source_reference='failed-cdr' WHERE id=$1", [b.call.id]);
    await client.query("UPDATE wallet_reservations SET status='awaiting_settlement' WHERE id=$1", [b.reservation.id]);
  });
  await rejectsSql(tenantB, '23514', client => client.query("UPDATE wallet_reservations SET status='released', released_amount_paise=200, released_at=now() WHERE id=$1", [b.reservation.id]));
  await rejectsSql(tenantB, '23514', client => client.query("UPDATE wallet_reservations SET status='settled', settled_amount_paise=100, released_amount_paise=100, settled_at=now(), released_at=now() WHERE id=$1", [b.reservation.id]));
  await transaction(tenantB, async client => {
    await client.query("UPDATE wallet_reservations SET status='settled', settled_amount_paise=200, settled_at=now() WHERE id=$1", [b.reservation.id]);
    await client.query("UPDATE call_logs SET settlement_status='settled', settled_at=now(), billable_seconds=120, charged_paise=200 WHERE id=$1", [b.call.id]);
    await insert(client, 'wallet_transactions', chargeValues(b, { amount_paise: '200', balance_after_paise: '800' }));
  });
  await rejectsSql(tenantB, '23514', client => client.query('UPDATE call_logs SET charged_paise=100 WHERE id=$1', [b.call.id]));
  await rejectsSql(tenantB, '23514', client => client.query("UPDATE wallet_reservations SET status='active' WHERE id=$1", [b.reservation.id]));
});
test('expiry preserves funds until verified zero-duration reconciliation, then terminal row cannot reopen', async () => {
  const reservation = await transaction(tenantA, async client => {
    const call = await insert(client, 'call_logs', callValues(a, { attempt_number: 4 }));
    const row = await insert(client, 'wallet_reservations', reservationValues(a, call.id, {
      created_at: new Date(Date.now() - 7200000), expires_at: new Date(Date.now() - 3600000),
    }));
    await client.query("UPDATE wallet_reservations SET status='awaiting_settlement' WHERE id=$1", [row.id]);
    return row;
  });
  await rejectsSql(tenantA, '23514', client => client.query("UPDATE wallet_reservations SET status='expired', released_amount_paise=200, released_at=now() WHERE id=$1", [reservation.id]));
  await transaction(tenantA, async client => {
    await client.query("UPDATE call_logs SET status='no_answer', ended_at=now(), connected_duration_seconds=0, duration_verified_at=now(), duration_source_reference='no-answer-cdr' WHERE id=$1", [reservation.call_id]);
  });
  await rejectsSql(tenantA, '23514', client => client.query("UPDATE wallet_reservations SET status='expired', released_amount_paise=200, released_at=now() WHERE id=$1", [reservation.id]));
  await transaction(tenantA, async client => {
    const result = await client.query("UPDATE wallet_reservations SET status='expired', released_amount_paise=200, released_at=now(), reconciliation_requested_at=now(), reconciled_at=now(), reconciliation_reference='test-reconciliation' WHERE id=$1 RETURNING *", [reservation.id]);
    assert.equal(result.rows[0].released_amount_paise, '200');
  });
  await rejectsSql(tenantA, '23514', client => client.query("UPDATE wallet_reservations SET status='active', released_amount_paise=0, released_at=NULL WHERE id=$1", [reservation.id]));
});
