#!/usr/bin/env node

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_WAIT_MS = 30000;

export function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error(`Invalid argument: ${name || '(missing)'}`);
    values[name.slice(2)] = value;
  }
  const config = {
    parentPid: Number.parseInt(values['parent-pid'], 10),
    entry: resolve(values.entry || ''),
    port: Number.parseInt(values.port, 10),
    hostname: values.hostname || '0.0.0.0',
    cwd: resolve(values.cwd || process.cwd()),
    logDir: resolve(values['log-dir'] || resolve(values.cwd || process.cwd(), '.logs')),
  };
  if (!Number.isInteger(config.parentPid) || config.parentPid < 1) throw new Error('Invalid parent PID');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid port');
  if (!existsSync(config.entry)) throw new Error(`Server entry not found: ${config.entry}`);
  return config;
}

export async function waitFor(predicate, timeoutMs = DEFAULT_WAIT_MS, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  return false;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isHealthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function runRestart(config) {
  mkdirSync(config.logDir, { recursive: true });
  const restartLog = resolve(config.logDir, 'restart.log');
  const serverLog = resolve(config.logDir, 'server.log');
  const log = (message) => appendFileSync(restartLog, `[${new Date().toISOString()}] ${message}\n`);

  log(`Waiting for PID ${config.parentPid} to exit`);
  const stopped = await waitFor(() => !isProcessAlive(config.parentPid), 15000);
  if (!stopped) throw new Error(`Server PID ${config.parentPid} did not exit`);

  const outputFd = openSync(serverLog, 'a');
  let child;
  try {
    child = spawn(process.execPath, [config.entry], {
      cwd: config.cwd,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', outputFd, outputFd],
      env: {
        ...process.env,
        PORT: String(config.port),
        HOSTNAME: config.hostname,
        NINEROUTER_SUPERVISED: '0',
        NINEROUTER_RESTARTED: '1',
      },
    });
    await new Promise((resolvePromise, reject) => {
      child.once('spawn', resolvePromise);
      child.once('error', reject);
    });
    child.unref();
  } finally {
    closeSync(outputFd);
  }

  log(`Started replacement PID ${child.pid} on port ${config.port}`);
  const healthy = await waitFor(() => isHealthy(config.port), DEFAULT_WAIT_MS, 250);
  if (!healthy) throw new Error(`Replacement PID ${child.pid} did not become healthy`);
  log(`Replacement PID ${child.pid} is healthy`);
  return child.pid;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runRestart(parseArgs(process.argv.slice(2))).catch((error) => {
    const fallbackLog = resolve(process.cwd(), '.logs', 'restart.log');
    mkdirSync(dirname(fallbackLog), { recursive: true });
    appendFileSync(fallbackLog, `[${new Date().toISOString()}] Restart failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}