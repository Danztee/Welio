# AWS integrations

Welio uses Amazon Bedrock in the running application and Kiro Crew during
development. The [Amazon Developer Hackathon rules](https://amazonappdev2026.devpost.com/rules)
describe the AWS Builder mini-challenge and its requirements.

## Amazon Bedrock

The Go API powers the customer-facing AI receptionist with Amazon Bedrock. It
creates the AWS SDK for Go v2 Bedrock Runtime client in
[`internal/app/build.go`](../internal/app/build.go). The adapter in
[`internal/receptionist/bedrock.go`](../internal/receptionist/bedrock.go)
streams responses through Bedrock's
[`ConverseStream` API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html)
and handles validated tool calls.

The API reads `AWS_REGION` and `BEDROCK_MODEL_ID`; the defaults are
`eu-north-1` and `eu.anthropic.claude-sonnet-4-6`. Credentials come from the
AWS SDK credential chain or `AWS_BEARER_TOKEN_BEDROCK`. Keep them in the Go API
environment or runtime identity. They are never sent to the browser. See the
[receptionist guide](./RECEPTIONIST.md) for the booking and tool approval flow.

## Kiro Crew

Kiro Crew was used during Welio's development as an agent-assisted engineering
workspace. It supports the development process; it is not part of the deployed
application or a runtime dependency. See the
[Kiro Crew documentation](https://kiro.dev/docs/crew/).

For the hackathon, describe Bedrock as Welio's application integration and
Kiro Crew as a development tool used to build the project.
