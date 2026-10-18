CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_provider_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "workspace_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "workspace_invitations_role_valid" CHECK ("workspace_invitations"."role" in ('owner','staff'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "memberships_role_valid" CHECK ("memberships"."role" in ('owner','staff'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"logo" text,
	"slug" varchar(80) NOT NULL,
	"time_zone" text DEFAULT 'Africa/Lagos' NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"contact_email" text,
	"service_area" text,
	"booking_location" text DEFAULT 'customer_address' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"onboarded" boolean DEFAULT false NOT NULL,
	"lead_hours" integer DEFAULT 1 NOT NULL,
	"horizon_days" integer DEFAULT 60 NOT NULL,
	"cancel_hours" integer DEFAULT 24 NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"receptionist_settings" jsonb DEFAULT '{"enabled":true,"greeting":"Hello! How can I help you find a service or book an appointment?","instructions":"","faqs":[],"allowAvailability":true,"allowBooking":true}'::jsonb NOT NULL,
	"reminders_enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workspaces_slug_format" CHECK ("workspaces"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "workspaces_currency_format" CHECK ("workspaces"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "workspaces_booking_location_valid" CHECK ("workspaces"."booking_location" in ('customer_address','business_address')),
	CONSTRAINT "workspaces_booking_policy" CHECK ("workspaces"."lead_hours" between 0 and 168 and "workspaces"."horizon_days" between 1 and 365 and "workspaces"."cancel_hours" between 0 and 168 and "workspaces"."slot_minutes" in (15,30,60))
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"price_minor" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "services_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "services_duration_positive" CHECK ("services"."duration_minutes" > 0),
	CONSTRAINT "services_price_nonnegative" CHECK ("services"."price_minor" >= 0),
	CONSTRAINT "services_buffers_nonnegative" CHECK ("services"."buffer_before_minutes" >= 0 AND "services"."buffer_after_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"job_title" text DEFAULT 'Service specialist' NOT NULL,
	"schedule" jsonb DEFAULT '{"start":"09:00","end":"17:00","breakStart":"","breakEnd":"","days":[1,2,3,4,5]}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "staff_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "staff_workspace_user_unique" UNIQUE("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "staff_services" (
	"workspace_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "staff_services_workspace_id_staff_id_service_id_pk" PRIMARY KEY("workspace_id","staff_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "staff_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text DEFAULT 'Time off' NOT NULL,
	CONSTRAINT "staff_time_off_order" CHECK ("staff_time_off"."to_date" >= "staff_time_off"."from_date")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"service_name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"service_address" text,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_email" text DEFAULT '' NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"notification_consent" boolean DEFAULT false NOT NULL,
	"time_zone" text DEFAULT 'Africa/Lagos' NOT NULL,
	"source" text DEFAULT 'owner' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"request_fingerprint" text,
	"management_token_hash" text,
	"management_expires_at" timestamp with time zone,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "appointments_workspace_idempotency_unique" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "appointments_time_order" CHECK ("appointments"."ends_at" > "appointments"."starts_at"),
	CONSTRAINT "appointments_status_valid" CHECK ("appointments"."status" in ('confirmed','completed','cancelled','no_show')),
	CONSTRAINT "appointments_duration_positive" CHECK ("appointments"."duration_minutes" > 0),
	CONSTRAINT "appointments_duration_matches_interval" CHECK ("appointments"."ends_at" - "appointments"."starts_at" = "appointments"."duration_minutes" * interval '1 minute'),
	CONSTRAINT "appointments_price_nonnegative" CHECK ("appointments"."price_minor" >= 0),
	CONSTRAINT "appointments_buffers_nonnegative" CHECK ("appointments"."buffer_before_minutes" >= 0 AND "appointments"."buffer_after_minutes" >= 0),
	CONSTRAINT "appointments_currency_format" CHECK ("appointments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "booking_operations" (
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"appointment_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "booking_operations_workspace_id_key_pk" PRIMARY KEY("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_workspace_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'transactional' NOT NULL,
	"appointment_version" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_event_key_unique" UNIQUE("event_key"),
	CONSTRAINT "email_outbox_status" CHECK ("email_outbox"."status" in ('queued','sending','sent','failed','skipped')),
	CONSTRAINT "email_outbox_kind" CHECK ("email_outbox"."kind" in ('transactional','reminder') and ("email_outbox"."kind" <> 'reminder' or "email_outbox"."appointment_version" is not null))
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_turn" jsonb,
	"pending" jsonb,
	"receipt" uuid,
	"lease" uuid,
	"lease_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
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
	CONSTRAINT "mcp_booking_proposals_approval_token_hash_unique" UNIQUE("approval_token_hash"),
	CONSTRAINT "mcp_booking_proposals_workspace_idempotency_unique" UNIQUE("workspace_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_workspace_id_user_id_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_workspace_id_staff_id_staff_workspace_id_id_fk" FOREIGN KEY ("workspace_id","staff_id") REFERENCES "public"."staff"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_workspace_id_service_id_services_workspace_id_id_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."services"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_workspace_id_staff_id_staff_workspace_id_id_fk" FOREIGN KEY ("workspace_id","staff_id") REFERENCES "public"."staff"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_customer_id_customers_workspace_id_id_fk" FOREIGN KEY ("workspace_id","customer_id") REFERENCES "public"."customers"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_staff_id_service_id_staff_services_workspace_id_staff_id_service_id_fk" FOREIGN KEY ("workspace_id","staff_id","service_id") REFERENCES "public"."staff_services"("workspace_id","staff_id","service_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_operations" ADD CONSTRAINT "booking_operations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_operations" ADD CONSTRAINT "booking_operations_workspace_id_appointment_id_appointments_workspace_id_id_fk" FOREIGN KEY ("workspace_id","appointment_id") REFERENCES "public"."appointments"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_workspace_id_appointment_id_appointments_workspace_id_id_fk" FOREIGN KEY ("workspace_id","appointment_id") REFERENCES "public"."appointments"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_booking_proposals" ADD CONSTRAINT "mcp_booking_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_booking_proposals" ADD CONSTRAINT "mcp_booking_proposals_workspace_id_confirmed_appointment_id_appointments_workspace_id_id_fk" FOREIGN KEY ("workspace_id","confirmed_appointment_id") REFERENCES "public"."appointments"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_idx" ON "workspace_invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staff_services_service_idx" ON "staff_services" USING btree ("workspace_id","service_id");--> statement-breakpoint
CREATE INDEX "staff_time_off_lookup_idx" ON "staff_time_off" USING btree ("workspace_id","staff_id","from_date","to_date");--> statement-breakpoint
CREATE INDEX "appointments_workspace_starts_idx" ON "appointments" USING btree ("workspace_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_reminders_due_idx" ON "appointments" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_customer_idx" ON "appointments" USING btree ("workspace_id","customer_id");--> statement-breakpoint
CREATE INDEX "appointments_service_idx" ON "appointments" USING btree ("workspace_id","service_id");--> statement-breakpoint
CREATE INDEX "appointments_staff_service_idx" ON "appointments" USING btree ("workspace_id","staff_id","service_id");--> statement-breakpoint
CREATE INDEX "customers_workspace_email_idx" ON "customers" USING btree ("workspace_id",lower("email"));--> statement-breakpoint
CREATE INDEX "email_outbox_queue_idx" ON "email_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "chat_sessions_expiry_idx" ON "chat_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "chat_sessions_workspace_idx" ON "chat_sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mcp_booking_proposals_workspace_idx" ON "mcp_booking_proposals" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "mcp_booking_proposals_expiry_idx" ON "mcp_booking_proposals" USING btree ("expires_at");