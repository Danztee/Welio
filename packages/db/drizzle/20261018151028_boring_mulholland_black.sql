CREATE TABLE "mcp_booking_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"approval_token_hash" text NOT NULL,
	"proposal" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_appointment_id" uuid,
	"confirmation_lease" uuid,
	"confirmation_lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_booking_proposals_approval_token_hash_unique" UNIQUE("approval_token_hash"),
	CONSTRAINT "mcp_booking_proposals_workspace_idempotency_unique" UNIQUE("workspace_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "mcp_booking_proposals" ADD CONSTRAINT "mcp_booking_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_booking_proposals" ADD CONSTRAINT "mcp_booking_proposals_workspace_id_confirmed_appointment_id_appointments_workspace_id_id_fk" FOREIGN KEY ("workspace_id","confirmed_appointment_id") REFERENCES "public"."appointments"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_booking_proposals_workspace_idx" ON "mcp_booking_proposals" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mcp_booking_proposals_expiry_idx" ON "mcp_booking_proposals" USING btree ("expires_at");