-- Appointment waitlist: lets customers request a slot that is currently full.
CREATE TABLE waitlist_entries (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    service_id    uuid NOT NULL,
    staff_id      uuid,                       -- NULL means "any staff member"
    request_date  date NOT NULL,
    customer_email text NOT NULL,
    customer_name  text NOT NULL DEFAULT '',
    status        text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','notified','expired','cancelled')),
    notified_at   timestamptz,
    expires_at    timestamptz NOT NULL,        -- end of request_date in the workspace time zone
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT waitlist_entries_workspace_id_unique UNIQUE (workspace_id, id),
    CONSTRAINT waitlist_entries_email_not_empty CHECK (customer_email <> ''),
    CONSTRAINT waitlist_entries_date_not_past CHECK (request_date >= (now() AT TIME ZONE 'UTC')::date - 1),
    FOREIGN KEY (workspace_id, service_id) REFERENCES services(workspace_id, id)
);

-- Match index: find the first active entry for a freed slot.
CREATE INDEX waitlist_entries_match_idx
    ON waitlist_entries (workspace_id, service_id, request_date, status, created_at);

-- Workspace listing index: owner dashboard grouped by date.
CREATE INDEX waitlist_entries_workspace_idx
    ON waitlist_entries (workspace_id, status, request_date);

-- Prevent duplicate active entries for the same request.
CREATE UNIQUE INDEX waitlist_entries_active_unique
    ON waitlist_entries (workspace_id, service_id, request_date,
                         COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'),
                         lower(customer_email))
    WHERE status = 'active';

-- Expired-entry cleanup index.
CREATE INDEX waitlist_entries_expires_idx
    ON waitlist_entries (expires_at) WHERE status = 'active';
