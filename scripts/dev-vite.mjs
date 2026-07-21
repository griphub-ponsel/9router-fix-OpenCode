import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RESTART_EXIT_CODE = 75;
const apiPort = process.env.API_PORT || '20129';
const clientPort = process.env.PORT || '20127';
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

let stopping = false;
let apiChild = null;
let viteChild = null;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [apiChild, viteChild]) {
    if (child && !child.killed) child.kill('SIGTERM');
  }
  const waiters = [apiChild, viteChild]
    .filter(Boolean)
    .map((child) => new Promise((resolve) => child.once('exit', resolve)));
  Promise.all(waiters).then(() => process.exit(exitCode));
}

function startApi() {
  apiChild = spawn(process.execPath, ['dist-server/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: apiPort,
      HOSTNAME: process.env.API_HOSTNAME || '127.0.0.1',
      // Parent (this script) owns restarts: API just exits 75, we rebuild+respawn.
      // Prevents detached helper from binding bare prod server onto the wrong port
      // and killing Vite (which breaks Tailscale Funnel on the public PORT).
      NINEROUTER_DEV_SUPERVISOR: '1',
      NINEROUTER_SUPERVISED: '1',
    },
  });

  apiChild.once('exit', async (code, signal) => {
    if (stopping) return;

    // Dashboard "Restart" → exit 75: rebuild server bundle and respawn API only.
    if (code === RESTART_EXIT_CODE) {
      console.log('[dev-vite] API restart requested — rebuilding server, Vite stays up');
      try {
        await run(process.execPath, ['scripts/build-server.mjs']);
        startApi();
      } catch (error) {
        console.error(`[dev-vite] server rebuild failed: ${error.message}`);
        stop(1);
      }
      return;
    }

    console.error(`Development API ${signal ? `received ${signal}` : `exited with ${code}`}`);
    stop(code || 1);
  });
}

// Initial server build, then boot API + Vite.
await run(process.execPath, ['scripts/build-server.mjs']);

startApi();

viteChild = spawn(
  process.execPath,
  [vite, '--host', process.env.VITE_HOST || '127.0.0.1', '--port', clientPort],
  {
    stdio: 'inherit',
    env: { ...process.env, API_PORT: apiPort },
  },
);

viteChild.once('exit', (code, signal) => {
  if (stopping) return;
  console.error(`Development Vite ${signal ? `received ${signal}` : `exited with ${code}`}`);
  stop(code || 1);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
