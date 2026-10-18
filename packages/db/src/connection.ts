import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    application_name: "welio",
  });

  pool.on("error", () => {
    console.error(JSON.stringify({ event: "database_pool_error" }));
  });

  return { db: drizzle(pool, { schema, casing: "snake_case" }), pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];
