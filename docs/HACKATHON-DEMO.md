# Amazon Developer Hackathon demo

Welio enters the Alexa+ track with its self-hosted MCP server. The API serves
the official Go MCP SDK over Streamable HTTP at `/api/mcp/{slug}` and negotiates
MCP protocol `2025-11-25` or later. The tools read the live business catalog,
check availability, prepare a booking for review, and confirm it only after the
customer approves the exact proposal. See [the MCP contract](../contracts/mcp.md)
and [the receptionist guide](./RECEPTIONIST.md).

The hackathon rules also accept an Alexa+ simulation, but Welio does not claim a
native Alexa+ add-on. Native Alexa+ account linking is not required to show the
self-hosted MCP path for this submission.

## Rehearse the booking flow

Use a dedicated service-business demo workspace with one published service, an
assigned staff member, working hours, and a future available slot. Keep the
recorded customer name and email synthetic. If the local worker is running, use
a mail sandbox or a mailbox you control because confirming a booking queues its
confirmation email.

1. Run `make setup` once. Start PostgreSQL with `make dev-db`, apply migrations
   with `make migrate`, and start `make api` and `make web` in separate
   terminals. Leaving the worker stopped prevents confirmation emails from
   leaving the local machine during the recording. Sign in to the workspace
   and leave its appointments page ready in a second browser tab.
2. Start MCP Inspector and connect with Streamable HTTP to the API origin from
   `.env.api`, followed by `/api/mcp/<business-slug>`. Send an
   `Authorization: Bearer <business-secret>` header using the matching secret
   from `.env.api`. Keep the secret and any one-time proposal token out of the
   recording. The Inspector supports a web UI and custom headers; see its
   [server configuration guide](https://github.com/modelcontextprotocol/inspector/blob/main/docs/mcp-server-configuration.md).
3. Initialize the connection and show `tools/list`. Call `list_services`, then
   use a real service ID and a future date from that result to call
   `check_availability`.
4. Call `prepare_booking` with one returned staff ID, one available time, and
   synthetic customer details. Show the returned service, staff member, date,
   time, and price as a proposal, then state that this is not yet an appointment.
5. After showing the customer's explicit approval and separate email consent,
   call `confirm_booking` with the returned proposal ID and confirmation token,
   `customerApproved: true`, and `emailConsent: true`.
6. Show the returned receipt, switch to the Welio appointments page, and show
   that the same booking now appears in the business workspace.

Do not use a real customer's contact details. A confirmation writes an
appointment to the selected workspace and queues a real email job when the
worker and mail provider are enabled.

## Video outline (about 2 minutes 20 seconds)

- **0:00–0:15 — The problem:** Introduce a service business that misses booking
  requests while staff are busy or offline.
- **0:15–0:35 — MCP connection:** Show the Streamable HTTP endpoint connected
  in MCP Inspector and its discovered booking tools.
- **0:35–1:05 — Live information:** Call `list_services` and
  `check_availability`; point out that the returned prices, team, and slots
  come from Welio's current business data.
- **1:05–1:40 — Safe booking:** Prepare the booking, review the proposal, show
  explicit approval and email consent, then confirm it through MCP.
- **1:40–2:00 — Business result:** Show the receipt and the appointment in the
  Welio dashboard.
- **2:00–2:20 — Why it matters:** Explain that an agent can use the same
  tenant-scoped booking rules as the web receptionist, with a human approval
  step before creating an appointment.

Keep the video under three minutes, in English, and publicly visible on YouTube
or Vimeo. Avoid copyrighted music and footage or third-party marks that you do
not have permission to use.

## Submission checklist

- Select the Alexa+ primary track. The working self-hosted MCP server is the
  qualifying integration; an Agent Skill and native Alexa+ account linking are
  optional for this path.
- The project existed before the hackathon, so describe and show the substantial
  changes made during the submission period. The October 2026 Go API, MCP
  booking tools, approval flow, and shared booking service are the main changes
  to call out.
- Link the GitHub repository and make sure it includes setup instructions.
  This repository is currently private; Devpost's rules require giving its
  listed Amazon reviewers and Devpost access before submission.
- Upload the public demo video and add its URL to the submission.
- Complete product feedback for each tool, API, and SDK used: what it was used
  for, what worked, what needs improvement, onboarding experience, and whether
  you would use it again. If entering the AWS Builder mini-challenge, identify
  Amazon Bedrock and describe its runtime use in the receptionist.

The official deadline listed in the rules is October 23, 2026 at 12:00 p.m.
Pacific Time.
