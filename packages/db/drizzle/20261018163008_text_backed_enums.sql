ALTER TABLE "appointments" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "status" SET DEFAULT 'confirmed';--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "role" SET DATA TYPE text USING "role"::text;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "role" SET DEFAULT 'staff';--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "role" SET DATA TYPE text USING "role"::text;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "booking_location" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "booking_location" SET DATA TYPE text USING "booking_location"::text;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "booking_location" SET DEFAULT 'customer_address';--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_valid" CHECK ("appointments"."status" in ('confirmed','completed','cancelled','no_show'));--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_role_valid" CHECK ("workspace_invitations"."role" in ('owner','staff'));--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_valid" CHECK ("memberships"."role" in ('owner','staff'));--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_booking_location_valid" CHECK ("workspaces"."booking_location" in ('customer_address','business_address'));--> statement-breakpoint
DROP TYPE "public"."appointment_status";--> statement-breakpoint
DROP TYPE "public"."booking_location";--> statement-breakpoint
DROP TYPE "public"."membership_role";
