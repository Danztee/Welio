ALTER TABLE "workspaces" ADD COLUMN "business_address" text;--> statement-breakpoint
UPDATE "workspaces"
SET "business_address" = "service_area", "service_area" = NULL
WHERE "booking_location" IN ('business_address', 'both')
  AND "business_address" IS NULL
  AND "service_area" IS NOT NULL;
