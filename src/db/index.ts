import "server-only";

import { getDatabaseUrl } from "./config";
import { createDatabase } from "./connection";

const globalForDatabase = globalThis as typeof globalThis & {
  welioDatabase?: ReturnType<typeof createDatabase>;
};

export function getDatabase() {
  globalForDatabase.welioDatabase ??= createDatabase(getDatabaseUrl());
  return globalForDatabase.welioDatabase.db;
}
