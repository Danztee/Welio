import { spawn, execFileSync } from "node:child_process";
import { watch, readFileSync, writeFileSync, existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const command = process.argv[2] ?? "dev";
if (!["dev", "setup", "doctor"].includes(command))
  throw new Error("Expected dev, setup, or doctor");
function run(tool, args, options = {}) {
  return execFileSync(tool, args, { stdio: "inherit", ...options });
}
function prerequisites() {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Node.js 24 is required");
  const version = (tool, args) =>
    run(tool, args, { encoding: "utf8", stdio: "pipe" }).trim();
  if (!version("pnpm", ["--version"]).startsWith("11."))
    throw new Error("pnpm 11 is required");
  const required = readFileSync("go.mod", "utf8")
    .match(/^go (\d+)\.(\d+)/m)
    .slice(1)
    .map(Number);
  const actual = version("go", ["env", "GOVERSION"])
    .match(/go(\d+)\.(\d+)/)
    .slice(1)
    .map(Number);
  if (
    actual[0] < required[0] ||
    (actual[0] === required[0] && actual[1] < required[1])
  )
    throw new Error(`Go ${required.join(".")} or newer is required`);
  version("docker", ["compose", "version"]);
  version("docker", ["info"]);
}
function configuredPort(role, fallback) {
  const source = readFileSync(`.env.${role}`, "utf8");
  const configured = source.match(/^HTTP_ADDR=(.*)$/m)?.[1]?.trim();
  const address = (configured || fallback).replace(/^(['"])(.*)\1$/, "$2");
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Invalid HTTP_ADDR in .env.${role}`);
  return port;
}
async function doctor() {
  prerequisites();
  for (const role of ["api", "worker", "web"]) {
    if (!existsSync(`.env.${role}`))
      throw new Error(`Missing .env.${role}; run make setup`);
  }
  const source = readFileSync(".env.api", "utf8");
  if (
    !/^AUTH_SECRET=.+/m.test(source) ||
    source.includes("replace-with-at-least-32-random-bytes")
  )
    throw new Error("Set a random AUTH_SECRET in .env.api");
  const ports = [
    ["web", 3000],
    ["api", configuredPort("api", ":8081")],
    ["worker", configuredPort("worker", "127.0.0.1:8082")],
    ["database", 5461],
  ];
  for (const [service, port] of ports) {
    const active = await Promise.all(
      ["127.0.0.1", "::1"].map(
        (host) =>
          new Promise((resolve) => {
            const socket = createConnection({ host, port });
            const finish = (value) => {
              socket.destroy();
              resolve(value);
            };
            socket.once("connect", () => finish(true));
            socket.once("error", () => finish(false));
            socket.setTimeout(500, () => finish(false));
          }),
      ),
    );
    if (!active.some(Boolean)) continue;
    if (command === "dev" && service !== "database")
      throw new Error(
        `Port ${port} for ${service} is already in use. Stop it or choose a free HTTP_ADDR in .env.${service} before make dev.`,
      );
    console.log(
      `Port ${port} for ${service} is in use; expected if the development service is running.`,
    );
  }
  console.log("Development prerequisites are ready.");
}
if (command === "setup") {
  prerequisites();
  for (const role of ["api", "worker", "web"]) {
    const target = `.env.${role}`;
    if (existsSync(target)) {
      console.log(`Preserving ${target}`);
      continue;
    }
    let source = readFileSync(`${target}.example`, "utf8");
    if (role === "api")
      source = source.replace(
        "replace-with-at-least-32-random-bytes",
        randomBytes(48).toString("hex"),
      );
    writeFileSync(target, source, { flag: "wx", mode: 0o600 });
    console.log(`Created ${target}`);
  }
  run("go", ["mod", "download"]);
  run("pnpm", ["install", "--frozen-lockfile"], { cwd: "web" });
  console.log("Setup complete. Run make dev.");
  process.exit(0);
}
if (command === "doctor") {
  await doctor();
  process.exit(0);
}
const children = new Set();
const services = new Map();
const watchers = [];
let stopping = false;
let rebuildTimer;
let rebuilding = false;
let rebuildAgain = false;
const directory = await mkdtemp(join(tmpdir(), "welio-dev-"));
const binary = join(directory, "welio");

function start(label, command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  children.add(child);
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => {
      console.log(`[${label}] ${line}`);
    });
  }
  child.on("error", (error) => {
    console.error(`[${label}] ${error.message}`);
  });
  child.on("close", () => children.delete(child));
  return child;
}

function completion(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited with ${signal ?? code}`));
    });
  });
}

function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const closed = new Promise((resolve) => child.once("close", resolve));
  signalGroup(child, "SIGTERM");
  const force = setTimeout(() => signalGroup(child, "SIGKILL"), 5_000);
  await closed;
  clearTimeout(force);
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  clearTimeout(rebuildTimer);
  for (const watcher of watchers) watcher.close();
  await Promise.all([...children].map(stop));
  await rm(directory, { recursive: true, force: true });
  process.exit(code);
}

function startService(name) {
  const child = start(name, "make", ["--no-print-directory", name], {
    env: { ...process.env, WELIO_DEV_BINARY: binary },
  });
  services.set(name, child);
  child.once("close", (code) => {
    if (!stopping && services.get(name) === child) {
      console.error(`[dev] ${name} stopped unexpectedly`);
      void shutdown(code || 1);
    }
  });
}

async function rebuild() {
  if (stopping) return;
  if (rebuilding) {
    rebuildAgain = true;
    return;
  }
  rebuilding = true;
  try {
    await completion(
      start("build", "go", ["build", "-o", binary, "./cmd/welio"]),
    );
    if (stopping) return;
    const previous = [services.get("api"), services.get("worker")].filter(
      Boolean,
    );
    services.delete("api");
    services.delete("worker");
    await Promise.all(previous.map(stop));
    if (!stopping) {
      startService("api");
      startService("worker");
    }
  } catch (error) {
    console.error(
      `[build] ${error.message}; services keep the last successful build`,
    );
    if (services.size === 0) throw error;
  } finally {
    rebuilding = false;
    if (rebuildAgain && !stopping) {
      rebuildAgain = false;
      void rebuild();
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => void shutdown(signal === "SIGINT" ? 130 : 143));
}

try {
  await doctor();
  await completion(
    start("database", "docker", [
      "compose",
      "-f",
      "docker-compose.dev.yml",
      "-p",
      "welio-dev",
      "up",
      "-d",
      "--wait",
      "postgres",
    ]),
  );
  await completion(
    start("migrate", "make", ["--no-print-directory", "migrate"]),
  );
  await rebuild();
  if (!stopping) {
    startService("web");
    for (const path of ["cmd", "internal"]) {
      watchers.push(
        watch(path, { recursive: true }, (_event, name) => {
          if (!name || !/\.go$/.test(name)) return;
          clearTimeout(rebuildTimer);
          rebuildTimer = setTimeout(() => void rebuild(), 300);
        }),
      );
    }
    console.log(
      "[dev] API, worker and web are running. Go changes rebuild services; Next.js reloads web changes. Ctrl+C stops all three. PostgreSQL remains available for the next run.",
    );
  }
} catch (error) {
  console.error(`[dev] ${error.message}`);
  await shutdown(1);
}
