import "server-only";

import { sql } from "drizzle-orm";
import type { Database } from "./connection";

export async function incrementRateLimit(
  db: Database,
  key: string,
  windowMs: number,
  now = Date.now(),
) {
  const windowStart = now - windowMs;
  const result = await db.execute(sql`
    INSERT INTO auth_rate_limits (key, count, last_request)
    VALUES (${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE
    SET count = CASE
          WHEN auth_rate_limits.last_request < ${windowStart} THEN 1
          ELSE auth_rate_limits.count + 1
        END,
        last_request = CASE
          WHEN auth_rate_limits.last_request < ${windowStart} THEN ${now}
          ELSE auth_rate_limits.last_request
        END
    RETURNING count
  `);

  return Number(result.rows[0]?.count ?? 0);
}
