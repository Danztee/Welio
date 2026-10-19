CREATE TABLE rate_limits (
    key text PRIMARY KEY,
    count bigint NOT NULL CHECK (count > 0),
    expires_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_expiry_idx ON rate_limits (expires_at);
CREATE INDEX customers_workspace_created_idx ON customers (workspace_id, created_at DESC, id DESC);
CREATE INDEX appointments_workspace_starts_id_idx ON appointments (workspace_id, starts_at DESC, id DESC);
