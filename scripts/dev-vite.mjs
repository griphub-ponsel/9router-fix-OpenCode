import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiPort = process.env.API_PORT || '20129';
const clientPort = process.env.PORT || '20127';
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await run(process.execPath, ['scripts/build-server.mjs']);

const children = [
  spawn(process.execPath, ['dist-server/index.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: apiPort, HOSTNAME: process.env.API_HOSTNAME || '127.0.0.1' },
  }),
  spawn(process.execPath, [vite, '--host', process.env.VITE_HOST || '127.0.0.1', '--port', clientPort], {
    stdio: 'inherit',
    env: { ...process.env, API_PORT: apiPort },
  }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  Promise.all(children.map((child) => new Promise((resolve) => child.once('exit', resolve)))).then(() => process.exit(exitCode));
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop());
for (const child of children) child.once('exit', (code, signal) => {
  if (!stopping) {
    console.error(`Development ${signal ? `received ${signal}` : `exited with ${code}`}`);
    stop(code || 1);
  }
});
