import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(
  resolve(process.cwd(), "../../apps/web"),
  process.env.NODE_ENV !== "production",
);

import { defineConfig } from "drizzle-kit";

import { getDatabaseUrl } from "./src/config";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: { url: getDatabaseUrl() },
  migrations: { prefix: "timestamp" },
  verbose: true,
  strict: true,
});
