UPDATE "staff" AS s
SET "user_id" = m."user_id",
    "name" = u."name",
    "email" = u."email"
FROM "memberships" AS m
INNER JOIN "users" AS u ON u."id" = m."user_id"
WHERE m."role" = 'owner'
  AND s."workspace_id" = m."workspace_id"
  AND s."user_id" IS NULL
  AND lower(s."email") = lower(u."email")
  AND NOT EXISTS (
    SELECT 1
    FROM "staff" AS linked
    WHERE linked."workspace_id" = m."workspace_id"
      AND linked."user_id" = m."user_id"
  );
--> statement-breakpoint

INSERT INTO "staff" ("workspace_id", "user_id", "name", "email", "job_title")
SELECT m."workspace_id", m."user_id", u."name", u."email", 'Owner'
FROM "memberships" AS m
INNER JOIN "users" AS u ON u."id" = m."user_id"
WHERE m."role" = 'owner'
  AND NOT EXISTS (
    SELECT 1
    FROM "staff" AS s
    WHERE s."workspace_id" = m."workspace_id"
      AND (
        s."user_id" = m."user_id"
        OR lower(s."email") = lower(u."email")
      )
  );
