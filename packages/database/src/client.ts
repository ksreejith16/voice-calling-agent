import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { organizationIdSchema } from './validation';

export type Database = NodePgDatabase<typeof schema>;
export type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDatabase(options: { connectionString: string; maxConnections?: number }) {
  const pool = new Pool({ connectionString: options.connectionString, max: options.maxConnections ?? 10,
    connectionTimeoutMillis: 2000, statement_timeout: 5000, query_timeout: 6000, idleTimeoutMillis: 30000 });
  const db = drizzle(pool, { schema });
  return { pool, db, close: () => pool.end() };
}

/** organizationId MUST come from verified server authentication/authorization, never a raw tenant header.
 * All business queries must use the supplied transaction. SET LOCAL cannot leak through pooling.
 * Background jobs must re-authorize stored tenant identity. This helper is not authentication.
 */
export async function withTenantTransaction<T>(db: Database, organizationId: string,
  work: (transaction: TenantTransaction) => Promise<T>): Promise<T> {
  const tenantId = organizationIdSchema.parse(organizationId);
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('app.organization_id', ${tenantId}, true)`);
    return work(transaction);
  });
}
