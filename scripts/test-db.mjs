// Own one disposable database and stop the entire test process group on exit.
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Expected a test command");
const container = `welio-test-${process.pid}-${Date.now()}`;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
let child;
let interrupted;
let force;
function signalGroup(signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    interrupted = signal === "SIGINT" ? 130 : 143;
    signalGroup("SIGTERM");
    if (child) force ??= setTimeout(() => signalGroup("SIGKILL"), 5_000);
  });
}
try {
  docker(
    "run",
    "-d",
    "--rm",
    "--name",
    container,
    "-p",
    "127.0.0.1::5432",
    "-e",
    "POSTGRES_USER=welio",
    "-e",
    "POSTGRES_PASSWORD=welio",
    "-e",
    "POSTGRES_DB=welio_test",
    "postgres:17-alpine",
  );
  let ready = false;
  for (let attempt = 0; attempt < 60 && !interrupted; attempt++) {
    try {
      docker(
        "exec",
        container,
        "pg_isready",
        "-U",
        "welio",
        "-d",
        "welio_test",
      );
      ready = true;
      break;
    } catch {
      await delay(1_000);
    }
  }
  if (interrupted) process.exitCode = interrupted;
  else {
    if (!ready) throw new Error("Test PostgreSQL did not start");
    const port = docker("port", container, "5432/tcp").split(":").at(-1);
    const env = {
      ...process.env,
      WELIO_TEST_DATABASE_URL: `postgres://welio:welio@127.0.0.1:${port}/welio_test?sslmode=disable`,
    };
    delete env.DATABASE_URL;
    delete env.DATABASE_URL_DIRECT;
    console.log(`Disposable test database ready on loopback port ${port}.`);
    child = spawn(command, args, { detached: true, stdio: "inherit", env });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(interrupted ?? code ?? 1));
    });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = interrupted ?? 1;
} finally {
  clearTimeout(force);
  try {
    docker("rm", "-f", container);
  } catch {
    console.error(
      `Could not remove test container ${container}; check Docker.`,
    );
    process.exitCode = 1;
  }
}
