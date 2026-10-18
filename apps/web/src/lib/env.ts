import "server-only";

import { z } from "zod";

const environmentSchema = z.object({
  APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
});

const result = environmentSchema.safeParse({
  APP_URL: process.env.APP_URL,
});

if (!result.success) {
  const fields = result.error.issues.map((issue) => issue.path.join("."));
  throw new Error(`Invalid environment configuration: ${fields.join(", ")}`);
}

export const env = result.data;
