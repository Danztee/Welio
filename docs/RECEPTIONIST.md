# AI receptionist and MCP

The receptionist is implemented in the Go API. The Next.js app supplies the
customer booking page, chat UI, and an owner-only preview; browser requests go
to the configured public Go API origin. The API uses Amazon Bedrock
ConverseStream and stores customer conversation state in PostgreSQL. Chat
sessions expire after seven days, and the worker removes expired sessions when
no active turn lease exists.

## Owner settings and preview

Owners configure the greeting, business instructions, FAQs, chat availability,
and whether the receptionist may check availability or prepare bookings.
Business instructions and FAQs are reference information. Catalog prices,
booking policies, and live availability remain authoritative. Pausing chat keeps
the standard booking form available.

The private preview uses saved settings and real workspace availability. It can
prepare a review proposal but cannot create or confirm an appointment. Preview
messages are sent with the request and are not stored as a public chat session.
The preview has its own owner authorization and request limits.

## Customer conversation

1. The customer starts a conversation for a published business. Go creates an
   HttpOnly session capability and stores only its hash.
2. The Bedrock agent can list the real services, check availability, and prepare
   a booking proposal through server-side tools. Tool arguments are validated,
   and workspace scope comes from the published business slug.
3. A proposal uses the live service price and is bound to the selected staff,
   time, customer details, service location, workspace, and an idempotency key.
   Proposals expire after ten minutes.
4. The customer reviews the proposal and explicitly confirms in Welio. The
   booking service rechecks publication, permissions, price, assignment, hours,
   time off, booking policies, and availability in the booking transaction.
5. The appointment appears in the workspace. Confirmation email is queued
   through River in the booking transaction and delivered by the worker when
   ZeptoMail is configured.

Typed chat approval does not confirm a booking. The model cannot invent prices
or availability, take payment, access private customer records, or send email
on its own. Customer chat history survives network interruptions and page
reloads while the seven-day session remains valid. The browser stores the active
conversation ID in local storage; its access capability stays in an HttpOnly
cookie. Customers can start a separate conversation explicitly.

## Bedrock configuration

The Go adapter streams Amazon Bedrock ConverseStream responses. The configured
default is Claude Sonnet 4.6 through the EU inference profile:

```dotenv
AWS_REGION=eu-north-1
BEDROCK_MODEL_ID=eu.anthropic.claude-sonnet-4-6
AI_DAILY_CALL_LIMIT=200
```

The AWS SDK uses its standard server-side credential chain, such as a local AWS
profile or an IAM role. Keep credentials in the Go API environment or runtime
identity; never put them in browser-visible configuration. The identity needs
permission to invoke the selected model or inference profile. There is no
automatic provider fallback. The normal booking form remains available if the
receptionist is unavailable.

## External MCP server

The Go API exposes `/api/mcp/{slug}` using the official Go MCP SDK's Streamable
HTTP transport and negotiates MCP protocol `2025-11-25` or later. The endpoint
supports initialization and discovery for these tools:

- `list_services` returns the published business's active catalog and booking
  policies.
- `check_availability` checks live slots for a service, optional staff member,
  and explicit date.
- `prepare_booking` validates the selected slot and returns an expiring review
  proposal. It never creates an appointment.
- `confirm_booking` is available only when server configuration enables MCP
  confirmation and the business allows booking. It requires an unexpired
  proposal token, `customerApproved: true`, and separate `emailConsent: true`.

External confirmation calls the same booking service as web bookings. A
proposal token is returned once and only its hash is stored. Workspace scope,
availability checks, proposal expiration, leases, and idempotency are enforced
by the API. Repeated confirmation returns the same appointment; conflicting
bookings fail and require a fresh proposal.

Set `API_SERVER_URL` to the public Go API origin and use that origin in the MCP
client URL and `MCP_OAUTH_RESOURCE_URL`. The default allowed host comes from
`API_SERVER_URL`; override `MCP_ALLOWED_HOSTS` when a reverse proxy or tunnel
uses a different public hostname. The API publishes its route-derived OpenAPI 3.1 schema at
`/v1/openapi.json`; TypeScript types can be generated with
`npx openapi-typescript https://api.example.com/v1/openapi.json -o openapi.d.ts`.
OpenDesk uses this same route-generated OpenAPI document and documents
`openapi-typescript` for optional TypeScript type generation.

Set `MCP_BOOKING_CONFIRMATION_ENABLED=true` to expose the complete tool set.
Authentication can use a business-specific bearer secret in
`MCP_API_SECRETS_JSON`, or the optional OAuth client credentials configured in
the Go API environment. Secrets must remain server-side. Configure the exact
public resource URL and HTTPS origin for remote clients; see
[`.env.api.example`](../.env.api.example) and the API guide.

The OAuth integration currently uses the service-level `client_credentials`
grant. This supports service discovery and controlled MCP clients, but Welio
does not yet implement Alexa+'s user-level authorization-code/PKCE account
linking or a verified native Alexa+ connection. Do not describe the current
integration as a native Alexa+ booking connection.

## Data limits and retention

Chat content, customer details in pending proposals, and MCP proposals are
stored in PostgreSQL. Public chat sessions expire after seven days. A River
maintenance job runs every fifteen minutes to delete expired chat sessions
without an active turn lease and to purge expired, unconfirmed MCP proposals.
Confirmed proposals retain only the appointment reference needed to make
confirmation retries idempotent.

Application logs record tool names, outcomes, latency, and token counts; they do
not include prompts, messages, customer emails, addresses, or capabilities.
Review AWS account logging and data-handling settings before processing
production personal data.

## Verification

Run Go unit tests, vet, and build from the repository root. PostgreSQL integration tests
run only when `WELIO_TEST_DATABASE_URL` points to a local disposable database
whose name ends in `_test`. To verify the customer flow, use an isolated
workspace with Bedrock access, then test service discovery, availability,
proposal review, explicit confirmation, and the resulting appointment and
email job. A successful Bedrock configuration check alone does not prove the
whole flow or email delivery.
