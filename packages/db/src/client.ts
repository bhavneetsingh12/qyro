// QYRO Database Client — Drizzle + Postgres
// RULE: Every query must be scoped to a tenant_id. Use setTenantContext() before queries.

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(__dirname, "../../../.env.local") });
config({ path: path.resolve(__dirname, "../../../.env") });

import { drizzle } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

// ─── Connection pools ─────────────────────────────────────────────────────────

const pgConn = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

const rootDb = drizzle(pgConn, { schema });
type DbClient = typeof rootDb;

const dbContext = new AsyncLocalStorage<DbClient>();

function getScopedDb(): DbClient {
  return dbContext.getStore() ?? rootDb;
}

export const db = new Proxy(rootDb, {
  get(_target, prop) {
    const scoped = getScopedDb() as unknown as Record<string, unknown>;
    const value = scoped[prop as string];
    if (typeof value === "function") {
      return (value as Function).bind(scoped);
    }
    return value;
  },
}) as DbClient;

// Runs all db calls in fn() against a single transaction-bound connection.
// This allows request middleware to pin tenant RLS context reliably.
export async function runInDbTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return rootDb.transaction(async (tx) => {
    return dbContext.run(tx as DbClient, async () => fn());
  });
}

// ─── Admin client (bypasses RLS — use only in seed/migration scripts) ─────────

const adminPgConn = postgres(process.env.DATABASE_URL, {
  max: 2,
  idle_timeout: 10,
});

export const adminDb = drizzle(adminPgConn, { schema });

// ─── Tenant RLS context helper ────────────────────────────────────────────────
//
// Postgres RLS policy (run this migration once):
//   CREATE POLICY tenant_isolation ON <table>
//   USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
//
// Call setTenantContext(tenantId) at the start of every request that
// touches tenant-scoped data. This sets the session-local config var
// that the RLS policies read.
//
// The third arg `true` makes it LOCAL to the current transaction.

export async function setTenantContext(tenantId: string): Promise<void> {
  await db.execute(
    drizzleSql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
  );
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

export async function closeDb(): Promise<void> {
  await pgConn.end();
  await adminPgConn.end();
}
