import { z } from "zod";

const databaseUrlSchema = z.url({ protocol: /^postgres(ql)?$/ });

export function getDatabaseUrl(value = process.env.DATABASE_URL): string {
  const result = databaseUrlSchema.safeParse(value);
  if (!result.success) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  return result.data;
}
