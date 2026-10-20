# AWS demo deployment

The Welio demo runs as one small AWS stack: an EC2 host runs the Go API, worker,
Next.js app, PostgreSQL, and Caddy in separate containers. CloudFront provides
the public HTTPS address and connects to Caddy over a private VPC origin. The
app uses an EC2 instance role for Amazon Bedrock. PostgreSQL and API ports are
not publicly reachable, and Systems Manager replaces SSH access.

This is a single-host demo deployment, not a highly available production
service. PostgreSQL lives on an encrypted EBS volume attached to that host.

## Sign in and deploy

Install Python 3.10+, Git, and AWS CLI v2, then authenticate to the AWS account
you use for the demo:

```sh
aws login --region eu-north-1
```

Complete the browser sign-in, then deploy from the repository root:

```sh
make aws-up
```

The first deploy creates the VPC, security group, EC2 host, Elastic IP,
temporary artifact bucket, and least-privilege instance role. The controller in
`deploy.py` packages the current working tree, uploads it and a private
environment file, then builds the containers, runs migrations, and starts the
services through Systems Manager. `release.sh` owns Docker/Compose installation
and the build, migration, and startup sequence. Nothing needs to be committed or
pushed to GitHub first.

The deploy command creates `deploy/aws/.env.production` if it does not exist. It
generates fresh database and auth secrets, and copies the existing development
MCP and ZeptoMail settings from `.env.api` and `.env.worker` so the demo keeps
its current business token and email sender. The file is ignored by Git and
written with mode `0600`. Back it up securely; it contains production
credentials. Existing production settings are preserved on later deploys.

The public URL is `https://<distribution>.cloudfront.net`, printed by
`make aws-status`. CloudFront manages its HTTPS certificate. Caching is disabled
and all viewer headers, cookies, query strings, and HTTP methods reach the
origin, including authenticated MCP requests. The private origin uses port 8080
inside the VPC; it is not exposed publicly.

The Bedrock model defaults to `eu.anthropic.claude-sonnet-4-6` in `eu-north-1`.
The AWS account must be allowed to invoke that model. No AWS access keys are
stored in the app environment; EC2 supplies temporary role credentials.

## Operate the demo

```sh
make aws-status       # show host state and public URL
make aws-logs         # show recent service logs
make aws-down         # stop containers and preserve database/TLS volumes
make aws-start        # start the host and containers again
make aws-stop         # stop EC2 to reduce compute charges
```

After editing `.env.production` or source, run `make aws-up` to apply the
changes. `aws-start` resumes the installed release; it does not upload local
changes. `aws-logs` and `aws-down` require a running host and never start a
stopped one.

Stopping EC2 retains the EBS data and Elastic IP. AWS still charges for the EBS
volume and allocated public IPv4 address while the host is stopped. Before
deleting the CloudFormation stack, export any data you want to keep and empty
the artifact bucket (or wait for its one-day lifecycle expiration). Stack
deletion removes the host, volumes, IP, and bucket.

After deployment, open the printed app URL, create an account, verify the email,
and finish workspace setup. In MCP Inspector, use
`https://<distribution>.cloudfront.net/api/mcp/<business-slug>` and the matching
business bearer secret from `MCP_API_SECRETS_JSON` in `.env.production`.

## GitHub Actions deployment

[Deploy production](../../.github/workflows/deploy.yml) is started manually on
`main`. It runs the Go, web, and container checks, then assumes an AWS role
using GitHub OpenID Connect (OIDC). It uploads source only; production
credentials stay on the host. The GitHub `production` environment must allow
only `main`. No AWS access keys or app secrets are stored in GitHub.

An AWS administrator provisions the provider and scoped deployment role:

```sh
aws cloudformation deploy --region eu-north-1 \
  --stack-name welio-github-deploy \
  --template-file deploy/aws/github.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    InstanceId=<InstanceId-output> \
    ArtifactBucketName=<ArtifactBucketName-output>
```

If the account already has a GitHub provider, also pass
`ExistingOidcProviderArn=<provider-arn>`. Set the GitHub production environment
variable `AWS_DEPLOY_ROLE_ARN` to the stack's `DeploymentRoleArn` output and
`APP_URL` to the app stack's `AppUrl` output. Organization policies must permit
creating and reading the OIDC provider and assuming the deployment role.

Each release gets its own directory, image tags, and private environment
snapshot. The server checks container readiness and the private API/web
endpoints, then the deployment client checks public API readiness, web health,
and sign-in. A failure after activation restores the previous release's images
and configuration. Database migrations are not reversed: schema changes must
remain compatible with the previous app release. A database backup is required
before destructive migrations. Deployment operations are serialized on the host
as well as in GitHub Actions.

The current release is `/opt/welio/current`, with the preceding release at
`/opt/welio/previous`. `make aws-up` can still provision infrastructure and
apply local production settings. GitHub's release command updates only the
existing app installation; its role cannot modify infrastructure or start EC2.

## Cost boundary

The stack uses a `t4g.medium` instance, a 30 GiB encrypted `gp3` disk, and one
public IPv4 address. Charges vary with AWS prices, CloudFront requests, Bedrock
requests, and outbound data transfer. Keep `AI_DAILY_CALL_LIMIT` low for a demo
and monitor AWS billing. AWS Budgets can send alerts but do not stop charges.

## Validate changes locally

Run `make deploy-check` to test packaging and secret-file handling, check the
release script syntax, and validate Compose using example settings. These checks
do not contact AWS or change the running deployment. `make check` and CI include
them. Run `make aws-up` when you are ready to publish a change.

Set `WELIO_AWS_REGION` or `WELIO_AWS_STACK_NAME` to target a different stack;
the defaults are `eu-north-1` and `welio-alexa-demo`.
