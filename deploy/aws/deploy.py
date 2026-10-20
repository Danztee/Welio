"""Deploy and operate Welio's small AWS demo stack through AWS CLI and SSM."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

AWS_DIR = Path(__file__).resolve().parent
ROOT = AWS_DIR.parents[1]
ENV_FILE = AWS_DIR / ".env.production"
STACK_TEMPLATE = AWS_DIR / "stack.yaml"
DEFAULT_REGION = "eu-north-1"
DEFAULT_STACK_NAME = "welio-alexa-demo"
POLL_INTERVAL_SECONDS = 5
INSTANCE_TIMEOUT_SECONDS = 900
COMMAND_TIMEOUT_SECONDS = 1800
EXCLUDED_PATH_PARTS = {
    ".git",
    ".kiro",
    ".vscode",
    "_bg",
    ".next",
    ".next-build",
    ".next-e2e",
    ".turbo",
    ".vercel",
    "node_modules",
    "__pycache__",
    "bin",
    "coverage",
}


def aws(*arguments: str, capture: bool = False, check: bool = True) -> str:
    result = subprocess.run(
        ["aws", "--region", region(), *arguments],
        cwd=ROOT,
        check=False,
        text=True,
        capture_output=capture,
    )
    if check and result.returncode != 0:
        details = result.stderr.strip() if capture else ""
        raise RuntimeError(details or f"AWS command failed: {arguments[0]}")
    return result.stdout.strip() if capture else ""


def region() -> str:
    return os.environ.get("WELIO_AWS_REGION", DEFAULT_REGION)


def stack_name() -> str:
    return os.environ.get("WELIO_AWS_STACK_NAME", DEFAULT_STACK_NAME)


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, raw_value = stripped.split("=", 1)
        key = key.removeprefix("export ").strip()
        raw_value = raw_value.strip()
        if raw_value.startswith("'") and raw_value.endswith("'"):
            value = raw_value[1:-1]
        elif raw_value.startswith('"') and raw_value.endswith('"'):
            value = shlex.split(raw_value)[0]
        else:
            value = raw_value.split("#", 1)[0].rstrip()
        values[key] = value
    return values


def write_env_file(values: dict[str, str]) -> None:
    lines = [f"{key}={json.dumps(value)}" for key, value in values.items()]
    ENV_FILE.write_text("\n".join(lines) + "\n")
    ENV_FILE.chmod(0o600)


def initialize_env_file() -> None:
    if ENV_FILE.exists():
        return

    api_env = parse_env_file(ROOT / ".env.api")
    worker_env = parse_env_file(ROOT / ".env.worker")
    values = parse_env_file(AWS_DIR / ".env.production.example")
    values.update(
        {
            "POSTGRES_PASSWORD": secrets.token_hex(32),
            "AUTH_SECRET": secrets.token_hex(32),
            "MCP_API_SECRETS_JSON": api_env.get("MCP_API_SECRETS_JSON", ""),
            "AWS_REGION": region(),
            "ZEPTOMAIL_SEND_MAIL_TOKEN": worker_env.get(
                "ZEPTOMAIL_SEND_MAIL_TOKEN", ""
            ),
            "EMAIL_FROM": worker_env.get("EMAIL_FROM", ""),
        }
    )
    validate_settings(values)
    write_env_file(values)
    print(
        "Created deploy/aws/.env.production with fresh database/auth secrets and "
        "the existing development ZeptoMail and MCP credentials."
    )


def update_public_endpoint(public_ip: str, app_url: str) -> str:
    values = parse_env_file(ENV_FILE)
    values["PUBLIC_IP"] = public_ip
    values["APP_URL"] = app_url
    values["AWS_REGION"] = region()
    write_env_file(values)
    return app_url


def validate_settings(values: dict[str, str]) -> None:
    required = (
        "POSTGRES_PASSWORD",
        "AUTH_SECRET",
        "MCP_API_SECRETS_JSON",
        "ZEPTOMAIL_SEND_MAIL_TOKEN",
        "EMAIL_FROM",
    )
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise RuntimeError(
            f"Missing required production settings: {', '.join(missing)}"
        )

    if any("replace-with" in values[key] for key in required):
        raise RuntimeError(
            "Replace the example production credentials before deploying."
        )
    try:
        mcp_secrets = json.loads(values["MCP_API_SECRETS_JSON"])
    except json.JSONDecodeError as error:
        raise RuntimeError("MCP_API_SECRETS_JSON must contain valid JSON.") from error
    if not isinstance(mcp_secrets, dict) or not mcp_secrets:
        raise RuntimeError(
            "MCP_API_SECRETS_JSON must contain at least one business key."
        )


def stack_outputs() -> dict[str, str]:
    response = aws(
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        stack_name(),
        "--query",
        "Stacks[0].Outputs",
        "--output",
        "json",
        capture=True,
    )
    return {item["OutputKey"]: item["OutputValue"] for item in json.loads(response)}


def ensure_stack() -> None:
    print(f"Creating or updating AWS stack {stack_name()} in {region()}...")
    aws(
        "cloudformation",
        "deploy",
        "--template-file",
        str(STACK_TEMPLATE),
        "--stack-name",
        stack_name(),
        "--capabilities",
        "CAPABILITY_IAM",
        "--no-fail-on-empty-changeset",
    )

    vpc_id = aws(
        "ec2",
        "describe-security-groups",
        "--group-ids",
        stack_outputs()["SecurityGroupId"],
        "--query",
        "SecurityGroups[0].VpcId",
        "--output",
        "text",
        capture=True,
    )
    group_id = aws(
        "ec2",
        "describe-security-groups",
        "--filters",
        "Name=group-name,Values=CloudFront-VPCOrigins-Service-SG",
        f"Name=vpc-id,Values={vpc_id}",
        "--query",
        "SecurityGroups[0].GroupId",
        "--output",
        "text",
        capture=True,
    )
    aws(
        "cloudformation",
        "deploy",
        "--template-file",
        str(STACK_TEMPLATE),
        "--stack-name",
        stack_name(),
        "--capabilities",
        "CAPABILITY_IAM",
        "--parameter-overrides",
        f"CloudFrontSecurityGroupId={group_id}",
        "--no-fail-on-empty-changeset",
    )


def wait_for_instance(instance_id: str) -> None:
    print("Waiting for EC2 and Systems Manager to become ready...")
    deadline = time.monotonic() + INSTANCE_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if instance_state(instance_id) == "running":
            online = aws(
                "ssm",
                "describe-instance-information",
                "--filters",
                f"Key=InstanceIds,Values={instance_id}",
                "--query",
                "InstanceInformationList[0].PingStatus",
                "--output",
                "text",
                capture=True,
            )
            if online == "Online":
                return
        time.sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError("The EC2 instance did not become available in Systems Manager.")


def create_source_archive() -> Path:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    files = result.stdout.decode().split("\0")
    with tempfile.NamedTemporaryFile(
        prefix="welio-release-", suffix=".tar.gz", delete=False
    ) as temporary_archive:
        archive_path = Path(temporary_archive.name)

    with tarfile.open(archive_path, "w:gz") as archive:
        for filename in files:
            if not filename:
                continue
            path = ROOT / filename
            if not path.exists() or is_excluded(path):
                continue
            archive.add(path, arcname=filename, recursive=False)
    return archive_path


def is_excluded(path: Path) -> bool:
    relative_path = path.relative_to(ROOT)
    if any(part in EXCLUDED_PATH_PARTS for part in relative_path.parts):
        return True
    return bool(path.name.startswith(".env") and not path.name.endswith(".example"))


def send_ssm_command(instance_id: str, commands: list[str]) -> str:
    return aws(
        "ssm",
        "send-command",
        "--instance-ids",
        instance_id,
        "--document-name",
        "AWS-RunShellScript",
        "--comment",
        "Welio demo deployment",
        "--parameters",
        json.dumps(
            {"commands": commands, "executionTimeout": [str(COMMAND_TIMEOUT_SECONDS)]}
        ),
        "--query",
        "Command.CommandId",
        "--output",
        "text",
        capture=True,
    )


def wait_for_command(instance_id: str, command_id: str) -> str:
    deadline = time.monotonic() + COMMAND_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        result = aws(
            "ssm",
            "get-command-invocation",
            "--command-id",
            command_id,
            "--instance-id",
            instance_id,
            "--output",
            "json",
            capture=True,
            check=False,
        )
        if result:
            invocation = json.loads(result)
            status = invocation.get("Status")
            if status in {"Success", "Cancelled", "TimedOut", "Failed"}:
                output = invocation.get("StandardOutputContent", "").strip()
                errors = invocation.get("StandardErrorContent", "").strip()
                if output:
                    print(output)
                if status != "Success":
                    raise RuntimeError(
                        errors or f"Remote deployment ended with {status}."
                    )
                return output
        time.sleep(POLL_INTERVAL_SECONDS)
    raise RuntimeError("The remote command did not finish before the timeout.")


def run_remote(instance_id: str, commands: list[str]) -> str:
    command_id = send_ssm_command(instance_id, commands)
    return wait_for_command(instance_id, command_id)


def deploy() -> None:
    initialize_env_file()
    validate_settings(parse_env_file(ENV_FILE))
    ensure_stack()

    outputs = stack_outputs()
    public_ip = outputs["PublicIp"]
    instance_id = outputs["InstanceId"]
    update_public_endpoint(public_ip, outputs["AppUrl"])
    ensure_instance_online(instance_id)

    publish_release(outputs, ENV_FILE)


def check_public_health(app_url: str) -> None:
    for path in ("/readyz", "/api/health", "/sign-in"):
        for attempt in range(6):
            try:
                with urllib.request.urlopen(app_url + path, timeout=20) as response:
                    if response.status != 200:
                        raise RuntimeError(f"Health check failed: {path}")
                break
            except (OSError, urllib.error.URLError):
                if attempt == 5:
                    raise RuntimeError(
                        f"Public health check failed: {app_url}{path}"
                    ) from None
                time.sleep(POLL_INTERVAL_SECONDS)


def publish_release(outputs: dict[str, str], env_file: Path | None = None) -> None:
    instance_id = outputs["InstanceId"]
    app_url = outputs["AppUrl"]
    release_id = f"{time.strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(4)}"
    artifact_prefix = f"s3://{outputs['ArtifactBucketName']}/releases/{release_id}"
    release_dir = f"/opt/welio/releases/{release_id}"
    archive_path = create_source_archive()
    try:
        aws(
            "s3",
            "cp",
            str(archive_path),
            f"{artifact_prefix}/source.tar.gz",
            "--sse",
            "AES256",
        )
        commands = [
            "set -eu",
            "umask 077",
            f"mkdir -p {release_dir}",
            f"aws s3 cp {artifact_prefix}/source.tar.gz /tmp/welio-{release_id}.tar.gz",
            f"tar -xzf /tmp/welio-{release_id}.tar.gz -C {release_dir} --no-same-owner",
            f"rm -f /tmp/welio-{release_id}.tar.gz",
        ]
        if env_file is not None:
            aws(
                "s3",
                "cp",
                str(env_file),
                f"{artifact_prefix}/runtime.env",
                "--sse",
                "AES256",
            )
            commands.append(
                f"aws s3 cp {artifact_prefix}/runtime.env {release_dir}/runtime.env"
            )
        commands.append(f"bash {release_dir}/deploy/aws/release.sh")
        print(f"Deploying release {release_id}...")
        run_remote(instance_id, commands)
        try:
            check_public_health(app_url)
        except RuntimeError:
            run_remote(
                instance_id, ["bash /opt/welio/current/deploy/aws/release.sh rollback"]
            )
            raise
        print(f"Welio is deployed at {app_url}")
        print(f"MCP endpoint: {app_url}/api/mcp/<business-slug>")
    finally:
        archive_path.unlink(missing_ok=True)
        try:
            aws("s3", "rm", f"{artifact_prefix}/source.tar.gz")
            if env_file is not None:
                aws("s3", "rm", f"{artifact_prefix}/runtime.env")
        except RuntimeError as error:
            print(f"Temporary deployment files will expire automatically: {error}")


def require_stack() -> dict[str, str]:
    outputs = stack_outputs()
    current_instance = outputs.get("InstanceId")
    if not current_instance:
        raise RuntimeError(
            f"AWS stack {stack_name()} does not exist; run `make aws-up` first."
        )
    return outputs


def instance_state(current_instance: str) -> str:
    return aws(
        "ec2",
        "describe-instances",
        "--instance-ids",
        current_instance,
        "--query",
        "Reservations[0].Instances[0].State.Name",
        "--output",
        "text",
        capture=True,
    )


def ensure_instance_online(current_instance: str) -> None:
    if instance_state(current_instance) == "stopped":
        aws("ec2", "start-instances", "--instance-ids", current_instance)
    wait_for_instance(current_instance)


def operate(action: str) -> None:
    outputs = require_stack()
    current_instance = outputs["InstanceId"]
    app_url = outputs["AppUrl"]
    if action == "status":
        print(f"EC2: {instance_state(current_instance)}\nApp: {app_url}")
        return
    if action == "stop":
        aws("ec2", "stop-instances", "--instance-ids", current_instance)
        print("EC2 is stopping. Its EBS data and Elastic IP remain allocated.")
        return
    if action == "start":
        ensure_instance_online(current_instance)
    elif instance_state(current_instance) != "running":
        raise RuntimeError("EC2 is not running. Use `make aws-start` first.")

    compose_arguments = {
        "start": "up -d --wait",
        "down": "down",
        "logs": "logs --tail=100 --no-color",
    }
    run_remote(
        current_instance,
        [
            "set -eu",
            "cd /opt/welio/current",
            (
                "docker compose --env-file runtime.env "
                f"-f deploy/aws/compose.yaml {compose_arguments[action]}"
            ),
        ],
    )
    if action == "start":
        print(f"Welio is running at {app_url}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=("deploy", "release", "start", "stop", "down", "logs", "status"),
    )
    arguments = parser.parse_args()
    try:
        if arguments.action == "deploy":
            deploy()
        elif arguments.action == "release":
            publish_release(require_stack())
        else:
            operate(arguments.action)
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"AWS {arguments.action} failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
