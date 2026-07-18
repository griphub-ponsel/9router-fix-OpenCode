import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createServer } from './index.js';

test('serves the SPA for frontend routes without falling back for API routes', async (t) => {
  const workingDirectory = await mkdtemp(join(tmpdir(), '9router-spa-'));
  const originalDirectory = process.cwd();
  await mkdir(join(workingDirectory, 'dist', 'assets'), { recursive: true });
  await writeFile(join(workingDirectory, 'dist', 'index.html'), '<!doctype html><title>9Router SPA</title>');
  await writeFile(join(workingDirectory, 'dist', 'assets', 'app.js'), 'console.log("app")');
  process.chdir(workingDirectory);

  let securityChecks = 0;
  const server = createServer({
    securityMiddleware: (request, response, next) => {
      securityChecks += 1;
      if (request.headers['x-test-deny'] === '1') return response.status(401).json({ error: 'denied' });
      return next();
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    process.chdir(originalDirectory);
    await rm(workingDirectory, { recursive: true, force: true });
  });

  for (const pathname of ['/', '/landing', '/dashboard', '/dashboard/providers/example']) {
    const response = await fetch(`${origin}${pathname}`);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(await response.text(), /9Router SPA/);
  }
  const head = await fetch(`${origin}/dashboard`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /^text\/html/);

  const asset = await fetch(`${origin}/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/);

  for (const pathname of ['/assets/missing.js', '/images/missing.png']) {
    const missingAsset = await fetch(`${origin}${pathname}`, { headers: { accept: '*/*' } });
    assert.equal(missingAsset.status, 404, pathname);
    assert.match(missingAsset.headers.get('content-type'), /^application\/json/);
  }

  for (const pathname of ['/api/not-real', '/v1/not-real', '/v1beta/not-real', '/mcp/not-real']) {
    const response = await fetch(`${origin}${pathname}`);
    assert.equal(response.status, 404, pathname);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await response.json(), { error: 'Not found' });
  }

  const methodMismatch = await fetch(`${origin}/dashboard`, { method: 'POST' });
  assert.equal(methodMismatch.status, 404);
  assert.match(methodMismatch.headers.get('content-type'), /^application\/json/);

  for (const pathname of ['/dashboard', '/assets/app.js']) {
    const denied = await fetch(`${origin}${pathname}`, { headers: { 'x-test-deny': '1' } });
    assert.equal(denied.status, 401, `${pathname} must pass through security middleware`);
    assert.deepEqual(await denied.json(), { error: 'denied' });
  }
  assert.ok(securityChecks >= 2);
});
