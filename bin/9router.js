#!/usr/bin/env node

const { cpSync, existsSync, mkdirSync, symlinkSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = dirname(__dirname);
const packageJson = require(join(appRoot, "package.json"));
const nextBin = join(appRoot, "node_modules", "next", "dist", "bin", "next");
const standaloneRoot = join(appRoot, ".next", "standalone");
const standaloneServer = join(standaloneRoot, "server.js");

function printHelp() {
  console.log(`9router ${packageJson.version}

Usage:
  9router [options]

Options:
  --dev             Run the Next.js development server
  -p, --port <n>    Port to listen on (default: 20128)
  -H, --host <host> Hostname to bind (default: 127.0.0.1)
  -h, --help        Show this help
  -v, --version     Show version
`);
}

function readOption(names, fallback) {
  for (const name of names) {
    const index = process.argv.indexOf(name);
    if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  }
  return fallback;
}

function runNext(args, env) {
  if (!existsSync(nextBin)) {
    console.error("9router: dependencies not found. Run `npm install` in the 9router checkout first.");
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [nextBin, ...args], {
    cwd: appRoot,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status || 0);
}

function runNodeScript(script, env) {
  const result = spawnSync(process.execPath, [script], {
    cwd: appRoot,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status || 0);
}

function ensureLinkedDirectory(source, target) {
  if (!existsSync(source) || existsSync(target)) return;

  mkdirSync(dirname(target), { recursive: true });

  try {
    symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
  } catch {
    cpSync(source, target, { recursive: true });
  }
}

function prepareStandaloneAssets() {
  ensureLinkedDirectory(join(appRoot, ".next", "static"), join(standaloneRoot, ".next", "static"));
  ensureLinkedDirectory(join(appRoot, "public"), join(standaloneRoot, "public"));
}

function build(env) {
  if (!existsSync(nextBin)) {
    console.error("9router: dependencies not found. Run `npm install` in the 9router checkout first.");
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [nextBin, "build", "--webpack"], {
    cwd: appRoot,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(packageJson.version);
  process.exit(0);
}

const port = readOption(["--port", "-p"], process.env.PORT || "20128");
const hostname = readOption(["--host", "-H"], process.env.HOSTNAME || "127.0.0.1");
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}`;
const env = {
  ...process.env,
  PORT: port,
  HOSTNAME: hostname,
  NEXT_PUBLIC_BASE_URL: baseUrl,
};

if (process.argv.includes("--dev")) {
  runNext(["dev", "--webpack", "-p", port, "-H", hostname], env);
}

if (!existsSync(join(appRoot, ".next", "BUILD_ID"))) {
  console.log("9router: production build not found, running npm run build first...");
  build(env);
}

console.log(`9router: starting dashboard at ${baseUrl}`);
if (existsSync(standaloneServer)) {
  prepareStandaloneAssets();
  runNodeScript(standaloneServer, env);
} else {
  runNext(["start", "-p", port, "-H", hostname], env);
}
