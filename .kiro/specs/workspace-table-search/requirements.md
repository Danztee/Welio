# Workspace table search and notification filters — retrospective requirements

This records changes in commit `85c87ba` on 19 October 2026. It was written
after implementation and does not establish that Kiro produced the feature.

## Requirements

### REQ-001: Search service details

**When** an owner searches the services table, **the UI shall** match visible
service information, including name, description, duration, price, status, and
assigned active staff names.

### REQ-002: Search team details

**When** an owner searches the team table, **the UI shall** match member name,
email, job title, role, status, and access description.

### REQ-003: Search notification details

**When** an owner searches booking notifications, **the UI shall** match
subject, recipient, kind, status, and attempt count. The existing status filter
shall remain available with an accessible label.

### REQ-004: Search all customer records

**When** an owner searches customers, **the UI shall** use the shared
workspace list controls and pagination rather than filtering only the
currently loaded page. An empty search result shall say no customers were
found, even when the loaded page has no rows.

## Out of scope

- New server search endpoints or schema changes in this commit.
- Changes to the meaning of notification statuses.
