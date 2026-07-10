#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");
const args = process.argv.slice(2);

function readOption(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const port = Number.parseInt(readOption("--port", process.env.PORT || "20128"), 10);
const hostname = readOption("--hostname", process.env.NINEROUTER_DEV_HOST || "127.0.0.1");
const bundler = args.includes("--webpack") ? "--webpack" : "--turbopack";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${port}`);
  process.exit(1);
}

if (!fs.existsSync(nextBin)) {
  console.error("Next.js is not installed. Run `npm install` first.");
  process.exit(1);
}

function getWindowsListener() {
  const script = [
    `$connection = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    "if (-not $connection) { exit 0 }",
    "$process = Get-CimInstance Win32_Process -Filter \"ProcessId = $($connection.OwningProcess)\"",
    "$parent = if ($process.ParentProcessId) { Get-CimInstance Win32_Process -Filter \"ProcessId = $($process.ParentProcessId)\" } else { $null }",
    "[PSCustomObject]@{ pid = $connection.OwningProcess; command = $process.CommandLine; parentPid = $process.ParentProcessId; parentCommand = $parent.CommandLine } | ConvertTo-Json -Compress",
  ].join("; ");

  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true },
  ).trim();

  return output ? JSON.parse(output) : null;
}

function getUnixListener() {
  let pid = "";
  try {
    pid = execFileSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], {
      encoding: "utf8",
    }).trim().split(/\s+/)[0];
  } catch {
    return null;
  }

  if (!pid) return null;
  const command = execFileSync("ps", ["-p", pid, "-o", "command="], {
    encoding: "utf8",
  }).trim();
  const parentPid = Number.parseInt(execFileSync("ps", ["-p", pid, "-o", "ppid="], {
    encoding: "utf8",
  }).trim(), 10);
  const parentCommand = parentPid
    ? execFileSync("ps", ["-p", String(parentPid), "-o", "command="], { encoding: "utf8" }).trim()
    : "";
  return { pid: Number.parseInt(pid, 10), command, parentPid, parentCommand };
}

function getListener() {
  try {
    return process.platform === "win32" ? getWindowsListener() : getUnixListener();
  } catch (error) {
    console.error(`Could not inspect port ${port}: ${error.message}`);
    process.exit(1);
  }
}

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").toLowerCase();
}

function is9RouterProcess(listener) {
  const command = `${normalize(listener?.command)} ${normalize(listener?.parentCommand)}`;
  const normalizedRoot = normalize(rootDir);
  const localRuntime = command.includes(normalizedRoot)
    && (command.includes("cli.js")
      || command.includes("custom-server.js")
      || command.includes("next/dist/bin/next")
      || command.includes("next dev"));
  const installedRuntime = command.includes("node_modules/9router/")
    && (command.includes("cli.js") || command.includes("custom-server.js"));
  return localRuntime || installedRuntime;
}

function stopListener(listener) {
  if (!listener) return;
  if (!is9RouterProcess(listener)) {
    console.error(`Port ${port} is used by another process (PID ${listener.pid}).`);
    console.error(listener.command || "Command line unavailable.");
    console.error("Stop it manually or choose another port with `--port <port>`. ");
    process.exit(1);
  }

  console.log(`Stopping old 9Router runtime on port ${port} (PID ${listener.pid})...`);
  try {
    if (process.platform === "win32") {
      const parentCommand = normalize(listener.parentCommand);
      const parentIs9Router = parentCommand.includes("cli.js")
        && (parentCommand.includes(normalize(rootDir)) || parentCommand.includes("node_modules/9router/"));
      const rootPid = parentIs9Router ? listener.parentPid : listener.pid;
      execFileSync("taskkill.exe", ["/F", "/T", "/PID", String(rootPid)], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      const parentCommand = normalize(listener.parentCommand);
      const parentIs9Router = parentCommand.includes("cli.js")
        && (parentCommand.includes(normalize(rootDir)) || parentCommand.includes("node_modules/9router/"));
      process.kill(parentIs9Router ? listener.parentPid : listener.pid, "SIGTERM");
    }
  } catch (error) {
    console.error(`Could not stop PID ${listener.pid}: ${error.message}`);
    process.exit(1);
  }
}

stopListener(getListener());

const releaseDeadline = Date.now() + 5000;
while (getListener() && Date.now() < releaseDeadline) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
}
if (getListener()) {
  console.error(`Port ${port} did not become available after stopping old 9Router.`);
  process.exit(1);
}

const memoryDbPath = process.env.MEMORY_DB_PATH
  || path.join(rootDir, "data", "9router-memory.sqlite");
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${port}`;
const child = spawn(
  process.execPath,
  [nextBin, "dev", bundler, "--port", String(port), "--hostname", hostname],
  {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: hostname,
      MEMORY_DB_PATH: memoryDbPath,
      NEXT_PUBLIC_BASE_URL: baseUrl,
      NINEROUTER_LIVE_DEV: "1",
    },
    stdio: "inherit",
  },
);

console.log(`9Router live dev: ${baseUrl}`);
console.log(`Bundler: ${bundler.slice(2)} | source HMR: on | CLI rebuild: not needed`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`Could not start Next.js: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});