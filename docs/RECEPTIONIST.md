# AI receptionist

The public booking page now has **Booking form** and **Talk to us** tabs. Owners
can configure it from **Dashboard → Receptionist** and open the customer page after publishing the workspace.
The normal booking form continues to work without AWS configuration.

## Owner control center

**Configuration** saves a workspace greeting, business instructions, up to twelve
FAQs, customer chat status, and availability/booking permissions. Instructions and
FAQs enter the model as lower-priority reference data; catalog prices and booking
rules remain authoritative. Disabling availability also disables booking proposals.
Pausing chat leaves the normal booking form available. Live confirmation rechecks
these permissions inside the booking transaction.

**Test & publish** provides an owner-authorized preview using saved settings and
real workspace availability, including before publication. Preview can prepare a
review card but has no appointment creation, confirmation, or email execution
path. Its conversation stays in browser memory, with only the last five text
turns sent as context. Preview uses the same model-call budget and has a separate
per-user request limit. It does not provide saved conversation history.

Readiness checks cover provider configuration, service assignments, staff hours,
and chat status. Provider configuration alone does not verify AWS credentials or
model access. Owners can publish the booking page after completing setup, then
open or copy its link. Publication also enables the independent booking form.

## Implemented flow

1. Start a customer conversation for one published business.
2. Strands with Amazon Bedrock reads the real catalog and checks real slots through MCP.
3. The assistant collects an explicit date, service, time, staff, and customer
   details, then prepares a review card with the server's price and policies. It
   collects a customer address only when the workspace is configured for
   customer-address appointments; otherwise it uses the saved business address.
4. The customer checks the details, ticks consent, and clicks **Confirm appointment**.
5. The existing booking service rechecks publication, price, hours, time off,
   staff eligibility, booking policies, and conflicts before committing.
6. The appointment appears in the owner dashboard. A transactional confirmation
   email enters the existing outbox and uses ZeptoMail when configured. Queued does not imply delivered.

Typed chat approval does not execute a booking. The model cannot execute any
booking, send email independently, charge money, find customers, or read private
appointments. Existing appointments are managed using the customer's private
email link. Customer web chat streams assistant text as it arrives. Owner
operations in chat, rescheduling/cancellation in chat, and payment tools are
future milestones. The external MCP endpoint below is callable by a compatible
remote MCP client, but Welio does not yet have an Alexa+ connection or a
verified Alexa+ demonstration.

## Amazon Bedrock and Strands setup

The agent loop uses the Strands `BedrockModel` provider and Bedrock Converse.
The configured model is Anthropic Claude Sonnet 4.6 through the EU inference
profile. Its profile ID is `eu.anthropic.claude-sonnet-4-6` and the configured
Bedrock region is `eu-north-1`.

Set these server-only values in `apps/web/.env.local` or the deployment environment:

```dotenv
AWS_REGION=eu-north-1
BEDROCK_MODEL_ID=eu.anthropic.claude-sonnet-4-6
AI_DAILY_CALL_LIMIT=200
```

Both region and model ID must be set. AWS credentials are resolved using the
standard SDK credential chain, such as an AWS IAM role or a local AWS profile.
Alternatively, provide `AWS_BEARER_TOKEN_BEDROCK` privately as a Bedrock API key.
For IAM authentication the identity needs permission to invoke the selected
model or profile, including its destination regions where applicable. Never put
credentials in browser code or commit them. There is no automatic provider
fallback; the normal booking form remains available if AI is unavailable.

Welio retains its own scoped chat history in PostgreSQL. Review AWS data handling
and any invocation logging configured for your account before production use.
Model and tool retries are disabled. Each model call reserves a daily call slot.

Restart the dev server after changing environment variables. Use the owner preview
first, then a controlled customer conversation. A configuration indicator alone
does not prove credentials, quota, model access, booking flow, or email delivery.
The owner has tested live Bedrock inference successfully. Tool-use behavior,
the full customer booking flow, conversation quality, and real email delivery
remain release checks.

Primary references: [Strands Bedrock provider](https://strandsagents.com/latest/documentation/docs/user-guide/concepts/model-providers/amazon-bedrock/),
[Strands lifecycle controls](https://strandsagents.com/docs/user-guide/sdk/agents/lifecycle-controls/),
[Amazon Nova Converse](https://docs.aws.amazon.com/nova/latest/userguide/using-converse-api.html),
[Bedrock inference permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-prereq.html).

## MCP and authorization

The Strands gateway uses the official MCP SDK's client/server pair over its
in-process transport. Before this connection opens, the gateway validates a
random 256-bit chat capability against its database hash, workspace, publication
state, and one-hour expiry. The workspace scope is injected by server code; no
tool accepts a workspace selector.

The in-process tools are `list_services`, `check_availability`, and
`prepare_booking`; availability and proposal tools are omitted when disabled in
the saved configuration. Their Zod schemas reject extra arguments. This server
never registers booking confirmation: the customer must approve the review card
in Welio. Model text cannot create an approval or change a price.

An optional server-to-server Streamable HTTP endpoint is available at
`POST /api/mcp/[slug]`. It follows the [MCP Streamable HTTP transport
specification for `2025-11-25`](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) using the official
`@modelcontextprotocol/sdk` Streamable HTTP transport. The endpoint is disabled
unless its business-specific secret is configured with at least 32 random
characters. For a slug such as `lagos-cleaning`, use
`MCP_API_SECRET__LAGOS_CLEANING`. Configure
`MCP_BOOKING_CONFIRMATION_ENABLED=true` to expose external booking preparation
and confirmation; it defaults to off. Send the secret as a Bearer token on every
request and use an MCP client that sends
`Accept: application/json, text/event-stream`. The endpoint is stateless and
returns JSON; it does not open an SSE listener. GET returns 405 as allowed for a
server without server-to-client event streams. The route checks the configured
host and rejects a mismatched `Origin` header. For a remote MCP client, add its
exact HTTPS origin to the server-only, comma-separated `MCP_ALLOWED_ORIGINS`
setting; this allowlist applies only to the MCP endpoint. Keep each secret in
trusted server-side integrations; never expose it in browser code. Each
business slug has a separate private service credential. These manually
provisioned bearer credentials are for a controlled demo; they do not provide
OAuth sign-in or a self-service business connection flow.

For a one-off local recording, run the app and expose port 3000 through ngrok.
Use a Traffic Policy that denies paths other than
`/api/mcp/<business-slug>` and rewrites the upstream `Host` to
`127.0.0.1:3000`. Add the tunnel's exact HTTPS origin to
`MCP_ALLOWED_ORIGINS`, then connect the client to
`https://<ngrok-host>/api/mcp/<business-slug>` with the Bearer secret configured
in that client's trusted server-side settings. The tunnel is temporary: the
local app and ngrok process must remain running. This is a demo bridge, not a
deployed Alexa+ connection.

For example, with Claude Code installed, set the business token in your
terminal and add the remote server using its Streamable HTTP transport:

```sh
export WELIO_MCP_TOKEN='paste-the-business-secret-here'
claude mcp add --scope local --transport http welio \
  https://<ngrok-host>/api/mcp/lagos-cleaning \
  --header "Authorization: Bearer ${WELIO_MCP_TOKEN}"
```

Use `/mcp` in Claude Code to confirm the connection and tool list. Keep the
client configuration private because it contains the bearer token.

This is an implemented external MCP server, not an Alexa+ integration by itself.
The business-scoped bearer authorization has unit tests. A local MCP SDK client
has also initialized the endpoint, discovered its tools, listed services, and
checked live availability. A public ngrok connection and an agent completing a
customer-approved booking remain demo checks; no booking was created during
the local smoke test.

When external confirmation is enabled and the business receptionist allows
booking, the endpoint exposes `list_services`, `check_availability`,
`prepare_booking`, and `confirm_booking`. Availability and booking tools remain
scoped to the slug in the endpoint path. The model cannot select another
workspace or access private customer records. When the environment flag is off,
external clients can discover services and availability but cannot prepare or
confirm bookings.

To make the endpoint callable, set a random value of at least 32 characters in
the server environment variable for that business slug (for example,
`MCP_API_SECRET__LAGOS_CLEANING`), set
`MCP_BOOKING_CONFIRMATION_ENABLED=true`, enable availability and booking in the
business's Receptionist settings, and restart or redeploy the server. Give a
trusted MCP client the deployed endpoint URL `https://<host>/api/mcp/<slug>` and
the matching business Bearer secret through that client's trusted configuration.
Each business secret only authorizes its own slug. Do not put the secret in the
booking page or browser. After connecting, verify
tool discovery, list services, check a real slot, prepare a proposal, show the
returned booking details to the customer, collect their explicit approval and
email consent, then call `confirm_booking`. The external client path has not yet
been demonstrated end to end.

## Approval and failure handling

Web chat proposals are stored in the chat session and bound to its workspace,
price quote, ten-minute expiry, and stable booking idempotency key. A new message
or rejection invalidates the current web-chat proposal. Only the human review
card confirms it.

External MCP proposals are stored in `mcp_booking_proposals`, bound to the
workspace, exact booking arguments, quote, stable idempotency key, random
proposal ID, and ten-minute expiry. A separate 256-bit confirmation token is
returned once to the trusted MCP client; only its SHA-256 digest is stored. The
tool accepts no replacement booking arguments. It requires both
`customerApproved: true` and `emailConsent: true`. The agent must first show the
customer the exact service, staff member, date, time, price, and contact details,
then wait for explicit approval and email consent. An MCP tool call can only
record the trusted agent's assertion that those responses were received; it
cannot independently observe a spoken conversation.

Confirmation uses the existing atomic appointment/email transaction through
`createBooking`; it rechecks publication, receptionist permissions, service
price, staff assignment, working hours, time off, booking window, and current
availability while holding the workspace booking lock. Availability compares
appointment start/end times and saved buffers. Current migrations do not install
a database exclusion constraint for writes that bypass the booking repository.
A per-proposal lease prevents simultaneous
confirmation. Repeated confirmation returns the same appointment. If the
process stops between booking commit and proposal receipt storage, the booking
idempotency key recovers the original appointment on retry. Changed prices,
expired proposals, and occupied slots fail safely and require a fresh review.
Confirmed proposal details are scrubbed after recording the appointment ID;
expired, unconfirmed proposals are purged on the next external preparation.

## Limits, privacy, and cleanup

- Requests are same-origin JSON with an 8 KB body limit; tokens are never in URLs.
- Public chat starts, messages, confirmations, and MCP calls have persistent
  rate limits. Configure `AUTH_TRUSTED_IP_HEADER` only behind a proxy that
  overwrites it; local development safely shares a bucket.
- Each session lasts one hour, with at most 20 completed turns. Message text is
  limited to 1,600 characters, and stored context is limited before inference.
- Each turn has at most four model calls, eight tool calls, 700 output tokens per
  model call, a 35-second invocation deadline, and no automatic provider retries. Slots
  are capped at 24 per tool response; oversized tool data fails safely.
- A database-backed global UTC-day cap reserves each model call atomically.
  `AI_DAILY_CALL_LIMIT` defaults to 200 and accepts 1–10,000. This bounds
  invocation count, not exact currency cost; configure AWS budgets and Bedrock
  model quotas separately. Calls that fail can consume a reservation.
- Application logs contain tool names, outcomes, latency, and token counts;
  they do not contain prompts, messages, emails, addresses, or capabilities.
  AWS data handling and invocation logging must be reviewed
  separately before processing production personal data.
- The database stores chat text, model context, and pending contact details.
  Expiry blocks access but does not automatically delete rows. A production cleanup job for expired sessions without an active lease is still required; the standalone cleanup script has been removed. Apply normal
  database encryption, backups, access controls, and retention policy.
- The browser retains its capability only in component memory. Reloading or
  leaving the page starts a fresh conversation; existing appointments persist.

## Verification

Earlier isolated verification exercised the Strands loop, MCP tools, PostgreSQL
booking confirmation and outbox dispatch using a controlled model and a capture
sender. It checked preview isolation, explicit approval, duplicate confirmation,
occupied slots, disabled booking permissions, loop caps and call-budget failure.
Temporary fixture records were removed. Those historical checks do not prove
conversation quality or ZeptoMail delivery. The owner has since tested live
Bedrock inference successfully.

Manual release check: configure Bedrock, save configuration, check the owner preview without publishing, verify preview leaves appointments and email unchanged, then publish a business,
open **Talk to us**, ask about services, choose an explicit date/time, supply
contact details, review the card, and confirm. Verify one dashboard appointment
and one delivered email. Repeat with an occupied slot, changed service price,
rejected proposal, and unavailable model. Complete a manual desktop and mobile
walkthrough before release.
