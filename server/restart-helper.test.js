import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const port = server.address().port;
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

test('detached restart helper starts a healthy replacement server', async (t) => {
  const workingDirectory = await mkdtemp(join(tmpdir(), '9router-restart-'));
  const entry = join(workingDirectory, 'server.mjs');
  const port = await getAvailablePort();
  await writeFile(entry, `
    import { createServer } from 'node:http';
    createServer((request, response) => {
      response.writeHead(request.url === '/api/health' ? 200 : 404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: request.url === '/api/health' }));
    }).listen(Number(process.env.PORT), '127.0.0.1');
  `);

  const helper = resolve('scripts/restart-server.mjs');
  const processResult = spawn(process.execPath, [
    helper,
    '--parent-pid', '99999999',
    '--entry', entry,
    '--port', String(port),
    '--hostname', '127.0.0.1',
    '--cwd', workingDirectory,
    '--log-dir', workingDirectory,
  ], { stdio: 'ignore' });
  const exitCode = await new Promise((resolvePromise, reject) => {
    processResult.once('error', reject);
    processResult.once('exit', resolvePromise);
  });
  assert.equal(exitCode, 0);

  const restartLog = await readFile(join(workingDirectory, 'restart.log'), 'utf8');
  const replacementPid = Number.parseInt(restartLog.match(/Started replacement PID (\d+)/)?.[1], 10);
  assert.ok(replacementPid > 0);
  t.after(async () => {
    try { process.kill(replacementPid, 'SIGTERM'); } catch { /* already stopped */ }
    await rm(workingDirectory, { recursive: true, force: true });
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});