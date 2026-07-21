import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { NextResponse } from 'next/server';

const RESTART_EXIT_CODE = 75;
const restartState = globalThis.__9routerRestartState || { scheduled: false };
globalThis.__9routerRestartState = restartState;

function scheduleExit() {
  setTimeout(() => process.exit(RESTART_EXIT_CODE), 750);
}

async function spawnRestartHelper() {
  const cwd = process.cwd();
  const helper = resolve(cwd, 'scripts', 'restart-server.mjs');
  const entry = resolve(process.argv[1] || resolve(cwd, 'dist-server', 'index.js'));
  if (!existsSync(helper)) throw new Error(`Restart helper not found: ${helper}`);
  if (!existsSync(entry)) throw new Error(`Server entry not found: ${entry}`);

  const child = spawn(process.execPath, [
    helper,
    '--parent-pid', String(process.pid),
    '--entry', entry,
    '--port', String(process.env.PORT || 20128),
    '--hostname', process.env.HOSTNAME || '0.0.0.0',
    '--cwd', cwd,
    '--log-dir', resolve(cwd, '.logs'),
  ], {
    cwd,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  await new Promise((resolvePromise, reject) => {
    child.once('spawn', resolvePromise);
    child.once('error', reject);
  });
  child.unref();
  return child.pid;
}

export async function POST() {
  if (restartState.scheduled) {
    return NextResponse.json({ success: false, message: 'Restart already in progress' }, { status: 409 });
  }
  if (process.env.NINEROUTER_LIVE_DEV === '1') {
    return NextResponse.json({ success: false, message: 'Restart is managed by the development runner' }, { status: 409 });
  }

  try {
    restartState.scheduled = true;
    // Vite dev supervisor (scripts/dev-vite.mjs): exit only — parent rebuilds API
    // and keeps the public Vite port alive so Tailscale Funnel does not go dark.
    const devSupervisor = process.env.NINEROUTER_DEV_SUPERVISOR === '1';
    const supervised = process.env.NINEROUTER_SUPERVISED === '1' || devSupervisor;
    const helperPid = supervised ? null : await spawnRestartHelper();
    scheduleExit();
    return NextResponse.json({
      success: true,
      message: 'Restart scheduled',
      mode: devSupervisor ? 'dev-supervisor' : supervised ? 'supervised' : 'detached-helper',
      helperPid,
    });
  } catch (error) {
    restartState.scheduled = false;
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}