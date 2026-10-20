# AWS integrations

Welio uses Amazon Bedrock in the running application and Kiro Crew during
development. The hosted app runs on AWS infrastructure defined in
[`deploy/aws/stack.yaml`](../deploy/aws/stack.yaml).

## Amazon Bedrock

The Go API powers the customer-facing AI receptionist with Amazon Bedrock. It
creates the AWS SDK for Go v2 Bedrock Runtime client in
[`internal/app/build.go`](../internal/app/build.go). The adapter in
[`internal/receptionist/bedrock.go`](../internal/receptionist/bedrock.go)
streams responses through Bedrock's
[`ConverseStream` API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html)
and handles validated tool calls.

The API reads `AWS_REGION` and `BEDROCK_MODEL_ID`; the defaults are `eu-north-1`
and `eu.anthropic.claude-sonnet-4-6`. Credentials come from the AWS SDK
credential chain or `AWS_BEARER_TOKEN_BEDROCK`. Keep them in the Go API
environment or runtime identity. They are never sent to the browser. See the
[receptionist guide](./RECEPTIONIST.md) for the booking and tool approval flow.

## Hosting

- **Amazon EC2** runs the web app, API, worker, PostgreSQL, and Caddy as
  separate containers. PostgreSQL data is stored on encrypted EBS, and an
  Elastic IP provides a stable public address.
- **Amazon CloudFront** provides the public HTTPS address and forwards app and
  MCP requests through a private VPC origin, with caching disabled.
- **AWS IAM** gives the EC2 instance permission to invoke the configured Bedrock
  model and read deployment artifacts. The app does not store AWS access keys.
- **AWS Systems Manager** executes deployment and operations commands without
  SSH.
- **Amazon S3** temporarily holds encrypted source and configuration bundles;
  successful deploys delete them, and a lifecycle rule expires leftovers.
- **AWS CloudFormation** defines the network, host, access policies, and
  artifact bucket. See [the deployment guide](../deploy/aws/README.md) for
  operation and costs.

## Kiro Crew

Kiro Crew was used during Welio's development as an agent-assisted engineering
workspace. It supports the development process; it is not part of the deployed
application or a runtime dependency. See the
[Kiro Crew documentation](https://kiro.dev/docs/crew/).
