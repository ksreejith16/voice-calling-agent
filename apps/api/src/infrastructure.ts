import type { OnApplicationShutdown } from '@nestjs/common';
import { createDatabase } from '@india-voice/database';
import { createClient } from 'redis';
import type { AppConfig } from './config';

export const INFRASTRUCTURE = Symbol('INFRASTRUCTURE');

export interface DependencyChecks extends OnApplicationShutdown {
  databaseReady(): Promise<boolean>;
  redisReady(): Promise<boolean>;
}

const tenantTables = [
  'organizations', 'users', 'wallets', 'wallet_transactions',
  'wallet_reservations', 'campaigns', 'leads', 'call_logs', 'agent_configs', 'voice_test_sessions', 'payment_orders',
];

export class Infrastructure implements DependencyChecks {
  private readonly database: ReturnType<typeof createDatabase>;

  getDb() { return this.database.db; }

  constructor(private readonly config: AppConfig) {
    this.database = createDatabase({
      connectionString: config.DATABASE_URL,
      maxConnections: 5,
    });
    // An idle connection failure must not terminate the process; readiness reports outages.
    this.database.pool.on('error', () => {
      console.error('PostgreSQL idle connection failed; check database availability.');
    });
  }

  async databaseReady(): Promise<boolean> {
    const result = await this.database.pool.query<{
      role_name: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      table_count: number;
      unsafe_table_count: number;
    }>(`
      SELECT current_user AS role_name, r.rolsuper, r.rolbypassrls,
        (SELECT count(*)::integer
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND c.relname = ANY($1::text[])) AS table_count,
        (SELECT count(*)::integer
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND c.relname = ANY($1::text[])
           AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
             OR NOT has_table_privilege(current_user, c.oid, 'SELECT')
             OR pg_has_role(current_user, c.relowner, 'MEMBER')))
          AS unsafe_table_count
      FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
    `, [tenantTables]);
    const row = result.rows[0];
    return row !== undefined
      && row.role_name === 'voice_app'
      && !row.rolsuper
      && !row.rolbypassrls
      && row.table_count === tenantTables.length
      && row.unsafe_table_count === 0;
  }

  async redisReady(): Promise<boolean> {
    // Readiness uses an isolated short-lived connection. It does not enqueue background work.
    const client = createClient({
      url: this.config.REDIS_URL,
      socket: { connectTimeout: 2000, reconnectStrategy: false },
      disableOfflineQueue: true,
    });
    client.on('error', () => {
      // Errors are represented by the public readiness result, without leaking credentials.
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        (async () => {
          await client.connect();
          return await client.ping() === 'PONG';
        })(),
        new Promise<boolean>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Redis readiness timed out')), 2500);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (client.isOpen) client.destroy();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
