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
   details, then prepares a review card with the server's price and policies.
4. The customer checks the details, ticks consent, and clicks **Confirm appointment**.
5. The existing booking service rechecks publication, price, hours, time off,
   staff eligibility, booking policies, and conflicts before committing.
6. The appointment appears in the owner dashboard. A transactional confirmation
   email enters the existing outbox and uses ZeptoMail when configured. Queued does not imply delivered.

Typed chat approval does not execute a booking. The model cannot execute any
booking, send email independently, charge money, find customers, or read private
appointments. Existing appointments are managed using the customer's private
email link. Owner operations in chat, rescheduling/cancellation in chat, payment
tools, streaming responses, and Alexa+ connectivity are future milestones.

## Amazon Bedrock and Strands setup

The agent loop uses the Strands `BedrockModel` provider and Bedrock Converse.
Choose a model or inference profile that supports Converse tool use and is
available to your AWS account in the configured region. The example uses Nova
Lite's US inference profile; it can route requests across the profile's US
regions. Select a different model/profile and region if your account or data
residency requirements call for it.

Set these server-only values in `.env.local` or the deployment environment:

```dotenv
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0
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
first, then a controlled customer conversation. A configuration indicator does not
prove credentials, quota, model access, booking flow, or email delivery works.
Live Bedrock and real email delivery remain acceptance checks until completed.

Primary references: [Strands Bedrock provider](https://strandsagents.com/latest/documentation/docs/user-guide/concepts/model-providers/amazon-bedrock/),
[Strands lifecycle controls](https://strandsagents.com/docs/user-guide/sdk/agents/lifecycle-controls/),
[Amazon Nova Converse](https://docs.aws.amazon.com/nova/latest/userguide/using-converse-api.html),
[Bedrock inference permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-prereq.html).

## Integration evidence

`src/lib/receptionist/provider.ts` creates the real Strands Bedrock provider;
`gateway.ts` constructs and invokes a Strands Agent, attaches the scoped MCP-backed
Zod tools, and uses lifecycle hooks for per-call reservations, tool limits, and
sanitized metadata. Strands owns the model/tool loop. Only the explicit customer
confirmation endpoint can execute a booking. This is a runtime integration,
not only a dependency or README reference.

The [official hackathon rules](https://amazonappdev2026.devpost.com/rules), reviewed
October 17, 2026, explicitly list Strands SDK among the AWS Builder mini-challenge
integrations. They also permit an Alexa+ web simulation using the entrant's agentic
tools. The submission still needs the primary-track working demonstration, code,
setup instructions, product feedback, and documented integration. Strands use
alone does not mean the full submission is complete. Kiro Crew contribution
should be recorded only after it actually occurs.

## MCP and authorization

The Strands gateway uses the official MCP SDK's client/server pair over its
in-process transport. Before this connection opens, the gateway validates a
random 256-bit chat capability against its database hash, workspace, publication
state, and one-hour expiry. The workspace scope is injected by server code; no
tool accepts a workspace selector.

The available tools are `list_services`, `check_availability`, and `prepare_booking`; availability and proposal tools are omitted when disabled in the saved configuration.
Their Zod schemas reject extra arguments. Preparation validates catalog and
availability but makes no appointment or communication changes. Only a proposal
returned by this registered tool becomes executable state. Model text is rendered
as text and cannot create an approval or change a price.

An optional server-to-server Streamable HTTP endpoint is available at
`POST /api/mcp/[slug]`. It is disabled unless `MCP_API_SECRET` is set to at least
32 random characters. Send that credential as a Bearer token, accept
`application/json, text/event-stream`, and use a current MCP client. There is no
public SSE listener or persistent MCP transport session. The key grants only
the same public tools on published businesses, including stateless proposals;
it grants no chat confirmation or private permissions. Keep this key within
trusted server integrations. This is a private service credential, not a
third-party OAuth integration; do not distribute it to public clients. A remote
proposal does not itself become an approved web-chat action.

## Approval and failure handling

Pending proposals are stored server-side and bind the exact booking arguments,
workspace, session, price quote, unique approval ID, ten-minute expiry, and
stable booking idempotency key. The confirmation endpoint accepts the approval
ID and consent, never replacement booking arguments. A new message or rejection
invalidates the current proposal. A per-session two-minute lease serializes
model calls and confirmations. No database transaction waits on the model provider.

Confirmation uses the existing GiST overlap protection and atomic appointment/
email transaction. Repeated confirmation returns the same appointment. If the
process stops between booking commit and chat receipt storage, subsequent
confirmation, state retrieval, message, or rejection reconciles the original
idempotency key before allowing another proposal. Changed prices, expired
approvals, and occupied slots require a fresh review.

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
Bedrock model access, conversation quality or ZeptoMail delivery.

Manual release check: configure Bedrock, save configuration, check the owner preview without publishing, verify preview leaves appointments and email unchanged, then publish a business,
open **Talk to us**, ask about services, choose an explicit date/time, supply
contact details, review the card, and confirm. Verify one dashboard appointment
and one delivered email. Repeat with an occupied slot, changed service price,
rejected proposal, and unavailable model. Browser visual verification remains
pending while browser automation is disabled in Work settings.
