CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    first_name text NOT NULL DEFAULT '',
    last_name text NOT NULL DEFAULT '',
    email text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false,
    image text,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    logo text,
    slug varchar(80) NOT NULL,
    time_zone text NOT NULL DEFAULT 'Africa/Lagos',
    currency varchar(3) NOT NULL DEFAULT 'NGN',
    contact_email text,
    service_area text,
    business_address text,
    booking_location text NOT NULL DEFAULT 'customer_address',
    is_published boolean NOT NULL DEFAULT false,
    phone text NOT NULL DEFAULT '',
    onboarded boolean NOT NULL DEFAULT false,
    lead_hours integer NOT NULL DEFAULT 1,
    horizon_days integer NOT NULL DEFAULT 60,
    cancel_hours integer NOT NULL DEFAULT 24,
    slot_minutes integer NOT NULL DEFAULT 30,
    receptionist_settings jsonb NOT NULL DEFAULT '{"enabled":true,"greeting":"Hello! How can I help you find a service or book an appointment?","instructions":"","faqs":[],"allowAvailability":true,"allowBooking":true}'::jsonb,
    reminders_enabled boolean NOT NULL DEFAULT false,
    CONSTRAINT workspaces_slug_unique UNIQUE (slug),
    CONSTRAINT workspaces_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT workspaces_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT workspaces_booking_location_valid CHECK (booking_location IN ('customer_address','business_address','both')),
    CONSTRAINT workspaces_booking_policy CHECK (lead_hours BETWEEN 0 AND 168 AND horizon_days BETWEEN 1 AND 365 AND cancel_hours BETWEEN 0 AND 168 AND slot_minutes IN (15,30,60))
);

CREATE TABLE memberships (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner','staff')),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE workspace_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
    token_hash text NOT NULL UNIQUE,
    invited_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    revoked_at timestamptz
);
CREATE INDEX workspace_invitations_workspace_idx ON workspace_invitations (workspace_id);

CREATE TABLE services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
    buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
    buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
    price_minor bigint NOT NULL CHECK (price_minor >= 0),
    is_active boolean NOT NULL DEFAULT true,
    CONSTRAINT services_workspace_id_unique UNIQUE (workspace_id, id)
);

CREATE TABLE staff (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id uuid,
    name text NOT NULL,
    email text NOT NULL DEFAULT '',
    job_title text NOT NULL DEFAULT 'Service specialist',
    schedule jsonb NOT NULL DEFAULT '{"start":"09:00","end":"17:00","breakStart":"","breakEnd":"","days":[1,2,3,4,5]}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    CONSTRAINT staff_workspace_id_unique UNIQUE (workspace_id, id),
    CONSTRAINT staff_workspace_user_unique UNIQUE (workspace_id, user_id),
    CONSTRAINT staff_workspace_user_membership_fk FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id)
);

CREATE TABLE staff_services (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL,
    service_id uuid NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (workspace_id, staff_id, service_id),
    FOREIGN KEY (workspace_id, staff_id) REFERENCES staff(workspace_id, id),
    FOREIGN KEY (workspace_id, service_id) REFERENCES services(workspace_id, id)
);
CREATE INDEX staff_services_service_idx ON staff_services (workspace_id, service_id);

CREATE TABLE staff_time_off (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    reason text NOT NULL DEFAULT 'Time off',
    CHECK (to_date >= from_date),
    FOREIGN KEY (workspace_id, staff_id) REFERENCES staff(workspace_id, id)
);
CREATE INDEX staff_time_off_lookup_idx ON staff_time_off (workspace_id, staff_id, from_date, to_date);

CREATE TABLE customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    email text,
    phone text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customers_workspace_id_unique UNIQUE (workspace_id, id)
);
CREATE INDEX customers_workspace_email_idx ON customers (workspace_id, lower(email));

CREATE TABLE appointments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL,
    service_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','completed','cancelled','no_show')),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    service_name text NOT NULL,
    duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
    buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
    buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
    price_minor bigint NOT NULL CHECK (price_minor >= 0),
    currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    service_address text,
    customer_name text NOT NULL DEFAULT '',
    customer_email text NOT NULL DEFAULT '',
    customer_phone text NOT NULL DEFAULT '',
    notification_consent boolean NOT NULL DEFAULT false,
    time_zone text NOT NULL DEFAULT 'Africa/Lagos',
    source text NOT NULL DEFAULT 'owner',
    version integer NOT NULL DEFAULT 0,
    reminder_queued_version integer,
    reminder_sent_version integer,
    reminder_generation integer NOT NULL DEFAULT 0 CHECK (reminder_generation >= 0),
    request_fingerprint text,
    management_token_hash text,
    management_expires_at timestamptz,
    idempotency_key text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT appointments_workspace_id_unique UNIQUE (workspace_id, id),
    CONSTRAINT appointments_workspace_idempotency_unique UNIQUE (workspace_id, idempotency_key),
    CONSTRAINT appointments_time_order CHECK (ends_at > starts_at),
    CONSTRAINT appointments_duration_matches_interval CHECK (ends_at - starts_at = duration_minutes * interval '1 minute'),
    FOREIGN KEY (workspace_id, customer_id) REFERENCES customers(workspace_id, id),
    FOREIGN KEY (workspace_id, staff_id, service_id) REFERENCES staff_services(workspace_id, staff_id, service_id)
);
CREATE INDEX appointments_workspace_starts_idx ON appointments (workspace_id, starts_at);
CREATE INDEX appointments_reminders_due_idx ON appointments (status, starts_at);
CREATE INDEX appointments_customer_idx ON appointments (workspace_id, customer_id);
CREATE INDEX appointments_service_idx ON appointments (workspace_id, service_id);
CREATE INDEX appointments_staff_service_idx ON appointments (workspace_id, staff_id, service_id);

CREATE TABLE booking_operations (
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    key text NOT NULL,
    appointment_id uuid NOT NULL,
    fingerprint text NOT NULL,
    PRIMARY KEY (workspace_id, key),
    FOREIGN KEY (workspace_id, appointment_id) REFERENCES appointments(workspace_id, id)
);

CREATE TABLE chat_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    messages jsonb NOT NULL DEFAULT '[]'::jsonb,
    turns jsonb NOT NULL DEFAULT '[]'::jsonb,
    active_turn jsonb,
    pending jsonb,
    receipt uuid,
    lease uuid,
    lease_until timestamptz,
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_sessions_expiry_idx ON chat_sessions (expires_at);
CREATE INDEX chat_sessions_workspace_idx ON chat_sessions (workspace_id);

CREATE TABLE mcp_booking_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    approval_token_hash text NOT NULL UNIQUE,
    proposal jsonb,
    expires_at timestamptz NOT NULL,
    confirmed_appointment_id uuid,
    confirmation_lease uuid,
    confirmation_lease_until timestamptz,
    CONSTRAINT mcp_booking_proposals_workspace_idempotency_unique UNIQUE (workspace_id, idempotency_key),
    FOREIGN KEY (workspace_id, confirmed_appointment_id) REFERENCES appointments(workspace_id, id)
);
CREATE INDEX mcp_booking_proposals_workspace_idx ON mcp_booking_proposals (workspace_id);
CREATE INDEX mcp_booking_proposals_expiry_idx ON mcp_booking_proposals (expires_at);

CREATE TABLE request_counters (
    key text PRIMARY KEY,
    count integer NOT NULL CHECK (count >= 0),
    last_request bigint NOT NULL
);

CREATE TABLE welio_auth_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_hash text NOT NULL UNIQUE,
    previous_refresh_hash text,
    rotated_at timestamptz,
    ip_address text,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    max_expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);
CREATE INDEX welio_auth_sessions_user_idx ON welio_auth_sessions (user_id);
CREATE INDEX welio_auth_sessions_expiry_idx ON welio_auth_sessions (expires_at);

CREATE TABLE welio_auth_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    email text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX welio_auth_tokens_lookup_idx ON welio_auth_tokens (purpose, email, expires_at);

CREATE TABLE welio_oauth_signing_keys (
    id text PRIMARY KEY,
    public_key jsonb NOT NULL,
    encrypted_private_key bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
);
