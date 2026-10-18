import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

import { defineConfig } from "drizzle-kit";

import { getDatabaseUrl } from "./src/db/config";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url: getDatabaseUrl() },
  migrations: { prefix: "timestamp" },
  verbose: true,
  strict: true,
});
