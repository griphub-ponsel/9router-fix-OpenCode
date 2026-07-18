import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRewrites, createRouteDiscovery } from './route-discovery.js';

test('applies next.config rewrite order exactly', () => {
  assert.equal(applyRewrites('/v1/v1/chat/completions'), '/api/v1/chat/completions');
  assert.equal(applyRewrites('/codex/anything'), '/api/v1/responses');
  assert.equal(applyRewrites('/v1beta/models/x'), '/api/v1beta/models/x');
  assert.equal(applyRewrites('/unrelated'), '/unrelated');
});

test('matches exact, dynamic, and catchall routes', async () => {
  const discovery = createRouteDiscovery([
    { file: 'exact', pathname: '/api/items/new', load: async () => ({}) },
    { file: 'dynamic', pathname: '/api/items/[id]', load: async () => ({}) },
    { file: 'catchall', pathname: '/api/files/[...path]', load: async () => ({}) },
  ]);
  assert.deepEqual((await discovery.match('/api/items/new')).params, {});
  assert.deepEqual((await discovery.match('/api/items/a%20b')).params, { id: 'a b' });
  assert.deepEqual((await discovery.match('/api/files/a/b')).params, { path: ['a', 'b'] });
});
