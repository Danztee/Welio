# Receptionist message layout — retrospective requirements

This document records the behavior implemented in commit `5e345a9` (19 October
2026). It was written after the implementation and is not evidence that Kiro
produced the original change.

## Scope

The shared receptionist message component renders replies in the customer chat
and the owner preview. The refinement gives the reply bubble the full available
message width while retaining its text label and in-bubble activity indicator.

## Requirements

### REQ-001: Identify the speaker

**When** a receptionist reply is shown, **the interface shall** display the
“Receptionist” text label above the reply bubble. A separate avatar is not
required to identify the speaker.

### REQ-002: Use available width

**When** a receptionist reply contains long text or rich content, **the message
content shall** be able to use the full width of its container without reserving
space for an avatar.

### REQ-003: Preserve reply content

**When** the reply is Markdown, **the component shall** continue to render its
existing paragraphs, headings, lists, links, code, and tables. **When** the
reply is a React node, **the component shall** render that node as supplied.

### REQ-004: Preserve activity feedback

**When** an activity is present, **the component shall** show its existing
status text and animation inside the bubble, with a polite live announcement.

## Out of scope

- Changes to conversation storage, API responses, or AI behavior.
- A new message design for customer-authored messages.
- New Kiro hooks for this presentation-only refinement.
