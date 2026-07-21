import assert from 'node:assert/strict';
import test from 'node:test';
import { sortConnections } from './sortConnections.js';

test('groups quota tracker connections by provider before pagination', () => {
  const connections = [
    { id: 'codex-b', provider: 'codex', priority: 1 },
    { id: 'github-a', provider: 'github', priority: 1 },
    { id: 'codex-a', provider: 'codex', priority: 2 },
    { id: 'antigravity-a', provider: 'antigravity', priority: 1 },
  ];

  const sorted = sortConnections(connections, 'provider', [
    'antigravity',
    'codex',
    'github',
  ]);
  const providers = sorted.map((connection) => connection.provider);

  for (let index = 1; index < providers.length; index += 1) {
    const previousProvider = providers[index - 1];
    const currentProvider = providers[index];
    const previousProviderAppearsAgain = providers.slice(index + 1).includes(previousProvider);
    assert.equal(
      previousProvider !== currentProvider && previousProviderAppearsAgain,
      false,
      `${previousProvider} connections should remain contiguous`,
    );
  }
});
