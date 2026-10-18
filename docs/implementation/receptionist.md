# Bedrock receptionist implementation

Approved scope: customers ask about a published business, check availability,
review a concrete booking, and explicitly confirm it. The resulting appointment
uses the existing booking service and email outbox. This is the public customer
flow; private customer search, appointment management, payments, and Alexa+
integration remain separate work.

Use Bedrock Converse with bounded tool rounds and the official MCP SDK. Each MCP
server is bound to one published workspace; tool arguments cannot select a
workspace. Read tools and a booking proposal tool are available to the model.
The model never receives an execution or customer-management capability.

Store chat history and pending proposals in PostgreSQL, protected by a random
session capability whose hash alone is persisted. Serialize requests with a
short lease. An expiring proposal binds workspace, session, exact booking
arguments, price quote, and a stable idempotency key. Confirmation is a separate
customer action and rechecks availability and price. A new turn invalidates the
old proposal. No model-generated text counts as authorization or a receipt.

Use published catalog data only. Bound input, transcript size, session lifetime,
turn count, tool calls, output tokens, request time, and daily model calls.
Credentials remain server-only. Missing AWS configuration produces an honest
unavailable state and leaves the normal booking form usable. Tests use injected
model responses; a separate explicit CLI checks real Bedrock access. Do not use
a simulated model in production.

Add a restrained chat tab to the existing public booking page and an owner
dashboard entry linking to the same public experience. Record runtime attempts,
token counts, and outcomes without prompts or personal data. Document AWS IAM,
model/region setup, ZeptoMail, retention cleanup, and remaining live checks.
