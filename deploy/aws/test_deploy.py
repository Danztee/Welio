import contextlib
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import deploy as deployment


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.env_file = self.root / ".env.production"
        for name, value in (("ROOT", self.root), ("ENV_FILE", self.env_file)):
            override = patch.object(deployment, name, value)
            override.start()
            self.addCleanup(override.stop)

    def test_archive_includes_working_files_without_secrets_or_build_artifacts(self):
        files = [
            "README.md",
            "internal/app/app.go",
            "deploy/aws/deploy.py",
            "web/src/new.ts",
            ".env.api.example",
            ".env.api",
            "deploy/aws/.env.production",
            "web/node_modules/package/index.js",
            "web/.next-build/server.js",
            ".kiro/settings/cli.json",
            "_bg/.kiro/settings/cli.json",
            "bin/welio",
        ]
        for name in files:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture")
        # Tracked files can include deleted paths during an uncommitted cleanup.
        listed = "\0".join([*files, "deleted.go", ""]).encode()
        with patch.object(deployment.subprocess, "run") as run:
            run.return_value.stdout = listed
            archive_path = deployment.create_source_archive()
        self.addCleanup(archive_path.unlink)
        with tarfile.open(archive_path) as archive:
            self.assertEqual(set(archive.getnames()), set(files[:5]))

    def test_env_round_trip_preserves_quoted_json_and_private_permissions(self):
        values = {
            "AUTH_SECRET": "test-secret",
            "MCP_API_SECRETS_JSON": json.dumps({"business": "test#secret"}),
            "COOKIE_DOMAIN": "",
        }
        deployment.write_env_file(values)
        self.assertEqual(deployment.parse_env_file(self.env_file), values)
        self.assertEqual(self.env_file.stat().st_mode & 0o777, 0o600)

    def test_existing_production_secrets_are_preserved(self):
        self.env_file.write_text("AUTH_SECRET=existing\n")
        deployment.initialize_env_file()
        self.assertEqual(self.env_file.read_text(), "AUTH_SECRET=existing\n")

    def test_missing_dev_credentials_do_not_create_a_production_file(self):
        (self.root / ".env.api").write_text("MCP_API_SECRETS_JSON={}\n")
        (self.root / ".env.worker").write_text("")
        with self.assertRaisesRegex(
            RuntimeError, "Missing required production settings"
        ):
            deployment.initialize_env_file()
        self.assertFalse(self.env_file.exists())

    def test_first_deploy_uses_template_defaults_and_generates_private_secrets(self):
        (self.root / ".env.api").write_text(
            'MCP_API_SECRETS_JSON=\'{"business":"token"}\'\n'
        )
        (self.root / ".env.worker").write_text(
            "ZEPTOMAIL_SEND_MAIL_TOKEN=mail-token\nEMAIL_FROM=Welio <hello@example.test>\n"
        )
        defaults = deployment.parse_env_file(
            deployment.AWS_DIR / ".env.production.example"
        )
        with contextlib.redirect_stdout(io.StringIO()):
            deployment.initialize_env_file()
        values = deployment.parse_env_file(self.env_file)
        for key in ("BEDROCK_MODEL_ID", "AI_DAILY_CALL_LIMIT", "MCP_ALLOWED_ORIGINS"):
            self.assertEqual(values[key], defaults[key])
        self.assertEqual(values["ZEPTOMAIL_SEND_MAIL_TOKEN"], "mail-token")
        self.assertEqual(
            json.loads(values["MCP_API_SECRETS_JSON"]), {"business": "token"}
        )
        self.assertEqual(len(values["AUTH_SECRET"]), 64)
        self.assertNotEqual(values["AUTH_SECRET"], values["POSTGRES_PASSWORD"])
        self.assertEqual(self.env_file.stat().st_mode & 0o777, 0o600)

    def test_aws_failure_preserves_the_actual_service_error(self):
        with patch.object(deployment.subprocess, "run") as run:
            run.return_value.returncode = 1
            run.return_value.stderr = "AccessDenied: cloudformation:DescribeStacks"
            with self.assertRaisesRegex(RuntimeError, "AccessDenied"):
                deployment.aws("cloudformation", "describe-stacks", capture=True)

    def test_endpoint_update_preserves_runtime_secrets(self):
        deployment.write_env_file({"AUTH_SECRET": "existing", "PUBLIC_IP": "old"})
        url = deployment.update_public_endpoint(
            "203.0.113.10", "https://example.cloudfront.net"
        )
        values = deployment.parse_env_file(self.env_file)
        self.assertEqual(url, "https://example.cloudfront.net")
        self.assertEqual(values["APP_URL"], url)
        self.assertEqual(values["AUTH_SECRET"], "existing")

    def test_logs_and_down_do_not_start_a_stopped_host(self):
        for action in ("logs", "down"):
            with (
                self.subTest(action=action),
                patch.object(
                    deployment,
                    "require_stack",
                    return_value={
                        "InstanceId": "i-demo",
                        "AppUrl": "https://example.cloudfront.net",
                    },
                ),
                patch.object(deployment, "instance_state", return_value="stopped"),
                patch.object(deployment, "aws") as aws,
                patch.object(deployment, "run_remote") as remote,
            ):
                with self.assertRaisesRegex(RuntimeError, "EC2 is not running"):
                    deployment.operate(action)
                aws.assert_not_called()
                remote.assert_not_called()

    def test_failed_remote_command_surfaces_its_error(self):
        invocation = json.dumps(
            {"Status": "Failed", "StandardErrorContent": "migration failed"}
        )
        with (
            patch.object(deployment, "aws", return_value=invocation),
            self.assertRaisesRegex(RuntimeError, "migration failed"),
        ):
            deployment.wait_for_command("i-demo", "command-id")

    def test_public_health_failure_restores_previous_release_without_uploading_secrets(
        self,
    ):
        archive = self.root / "source.tar.gz"
        archive.write_bytes(b"archive")
        outputs = {
            "InstanceId": "i-demo",
            "AppUrl": "https://example.cloudfront.net",
            "ArtifactBucketName": "releases-test",
        }
        with (
            patch.object(deployment, "create_source_archive", return_value=archive),
            patch.object(deployment, "aws") as aws,
            patch.object(deployment, "run_remote") as remote,
            patch.object(
                deployment, "check_public_health", side_effect=RuntimeError("unhealthy")
            ),
            contextlib.redirect_stdout(io.StringIO()),
            self.assertRaisesRegex(RuntimeError, "unhealthy"),
        ):
            deployment.publish_release(outputs)
        self.assertEqual(remote.call_count, 2)
        self.assertEqual(
            remote.call_args.args[1],
            ["bash /opt/welio/current/deploy/aws/release.sh rollback"],
        )
        uploads = [call for call in aws.call_args_list if call.args[:2] == ("s3", "cp")]
        self.assertEqual(len(uploads), 1)
        self.assertEqual(uploads[0].args[2], str(archive))
        self.assertFalse(archive.exists())

    def test_successful_release_checks_health_without_rollback(self):
        archive = self.root / "source.tar.gz"
        archive.write_bytes(b"archive")
        outputs = {
            "InstanceId": "i-demo",
            "AppUrl": "https://example.cloudfront.net",
            "ArtifactBucketName": "releases-test",
        }
        with (
            patch.object(deployment, "create_source_archive", return_value=archive),
            patch.object(deployment, "aws"),
            patch.object(deployment, "run_remote") as remote,
            patch.object(deployment, "check_public_health") as health,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            deployment.publish_release(outputs)
        remote.assert_called_once()
        health.assert_called_once_with(outputs["AppUrl"])
        self.assertFalse(archive.exists())

    def test_status_only_reads_the_host(self):
        with (
            patch.object(
                deployment,
                "require_stack",
                return_value={
                    "InstanceId": "i-demo",
                    "AppUrl": "https://example.cloudfront.net",
                },
            ),
            patch.object(deployment, "instance_state", return_value="stopped"),
            patch.object(deployment, "run_remote") as remote,
            contextlib.redirect_stdout(io.StringIO()) as output,
        ):
            deployment.operate("status")
        self.assertIn("EC2: stopped", output.getvalue())
        remote.assert_not_called()


if __name__ == "__main__":
    unittest.main()
