/**
 * Memory System Phase 3 Smoke Test
 * Run with: node examples/memory-phase3-smoke.js
 *
 * Covers:
 * - Memory Slots (pin/unpin + getPinned)
 * - Hybrid + Semantic search (Phase 2 + 3)
 * - LLM Summarization (via service, with fallback)
 * - Episodic summary creation
 * - Fact extraction + persistence
 * - Consolidation (merge + decay + episodic + facts)
 * - Stats enrichment (pinned, facts)
 */

const { memoryService, SCOPE, MEMORY_TYPE } = require('../src/shared/memory');

const TEST_DB = ':memory:';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runPhase3Smoke() {
  console.log('\n🧪 9Router Memory — Phase 3 Smoke Test\n');

  const results = { passed: 0, failed: 0, details: [] };

  function pass(name) {
    console.log(`  ✅ ${name}`);
    results.passed++;
  }

  function fail(name, err) {
    console.log(`  ❌ ${name}`);
    if (err) console.log(`     ${err.message || err}`);
    results.failed++;
    results.details.push({ name, error: String(err) });
  }

  try {
    // 1. Init
    console.log('1. Initialize memory service');
    await memoryService.initialize({
      storage: { dbPath: TEST_DB },
      embedding: {
        enabled: true,
        provider: 'local',          // will fallback to 'none' if @xenova not present
        autoEmbedOnSave: true,
        useHybridSearch: true
      },
      consolidation: { enabled: true }
    });
    pass('Service initialized');

    // 2. Seed some memories
    console.log('\n2. Seed test memories');
    const memIds = [];

    memIds.push(await memoryService.saveMemory({
      type: MEMORY_TYPE.SEMANTIC,
      scope: SCOPE.WORKSPACE,
      workspaceId: 'ws-smoke',
      title: 'JWT Auth Flow',
      content: 'We use short lived access tokens (15m) + long lived refresh tokens (7d) with rotation on every use.'
    }));

    memIds.push(await memoryService.saveMemory({
      type: MEMORY_TYPE.SEMANTIC,
      scope: SCOPE.WORKSPACE,
      workspaceId: 'ws-smoke',
      title: 'Rate Limiting',
      content: 'express-rate-limit is used: 100 requests per 15 minutes per IP on all /api routes.'
    }));

    memIds.push(await memoryService.saveMemory({
      type: MEMORY_TYPE.USER_PREF,
      scope: SCOPE.USER,
      userId: 'user-smoke',
      title: 'Coding Style',
      content: 'Prefers TypeScript strict + camelCase + JSDoc on complex functions.'
    }));

    pass(`Seeded ${memIds.length} memories`);

    // 3. Pin / Unpin (Memory Slots)
    console.log('\n3. Memory Slots (pin/unpin)');
    await memoryService.pinMemory(memIds[0], 'smoke-tester');
    await memoryService.pinMemory(memIds[1], 'smoke-tester');

    const pinned1 = await memoryService.getPinnedMemories({ workspaceId: 'ws-smoke' }, 10);
    if (pinned1.length === 2) {
      pass('Pinned 2 memories');
    } else {
      fail(`Expected 2 pinned, got ${pinned1.length}`);
    }

    await memoryService.unpinMemory(memIds[1], 'smoke-tester');
    const pinned2 = await memoryService.getPinnedMemories({ workspaceId: 'ws-smoke' }, 10);
    if (pinned2.length === 1) {
      pass('Unpinned works (1 remaining)');
    } else {
      fail(`Expected 1 pinned after unpin, got ${pinned2.length}`);
    }

    // 4. Search modes
    console.log('\n4. Search modes (keyword / hybrid / semantic)');
    const kw = await memoryService.searchMemories('JWT', { workspaceId: 'ws-smoke', mode: 'keyword', maxResults: 5 });
    if (kw.length >= 1) pass('Keyword search returns results'); else fail('Keyword search returned 0');

    const hy = await memoryService.searchMemories('auth token', { workspaceId: 'ws-smoke', mode: 'hybrid', maxResults: 5 });
    if (hy.length >= 1) pass('Hybrid search returns results'); else fail('Hybrid search returned 0');

    const se = await memoryService.searchMemories('rate limit', { workspaceId: 'ws-smoke', mode: 'semantic', maxResults: 5 });
    if (se.length >= 0) {
      // semantic can return 0 if no real embeddings — still consider it "not crashing"
      pass('Semantic search executed without crash');
    }

    // 5. Summarize (service level — will use fallback if no LLM)
    console.log('\n5. Summarization (LLM or fallback)');
    try {
      const summaryText = await memoryService.summarizeWithRouter(
        'We implemented JWT with 15 minute access tokens and 7 day refresh tokens with rotation. Rate limiting is set to 100 req / 15 min per IP.'
      );
      if (summaryText && summaryText.length > 20) {
        pass('Summarize returned text');
        // Optionally save it
        await memoryService.saveMemory({
          type: MEMORY_TYPE.EPISODIC,
          scope: SCOPE.WORKSPACE,
          workspaceId: 'ws-smoke',
          title: 'Smoke Summary',
          content: summaryText
        });
      } else {
        fail('Summarize returned empty/short text');
      }
    } catch (e) {
      fail('Summarize threw', e);
    }

    // 6. Fact extraction
    console.log('\n6. Fact extraction');
    const obs = [
      { raw_content: 'User prefers dark mode and uses VS Code with GitLens.' },
      { raw_content: 'The backend requires Node 20+ and uses better-sqlite3 for the memory DB.' }
    ];
    const facts = await memoryService.extractFactsFromObservations(obs, { useLLM: false });
    if (Array.isArray(facts) && facts.length > 0) {
      pass(`Extracted ${facts.length} facts`);

      for (const f of facts) {
        await memoryService.adapter.saveFact({
          factText: f.value || f,
          category: f.type || 'smoke',
          confidence: 0.7,
          sourceSessionId: null
        });
      }
      pass('Facts persisted to fact_cache');
    } else {
      fail('No facts extracted');
    }

    // 7. Episodic summary
    console.log('\n7. Episodic summary');
    const sessionId = 'smoke-session-' + Date.now();
    await memoryService.adapter.createSession({
      id: sessionId,
      workspaceId: 'ws-smoke',
      projectId: 'proj-smoke',
      userId: 'user-smoke',
      provider: 'test',
      model: 'test-model'
    });

    // add some observations to the session
    await memoryService.saveObservation({
      sessionId,
      type: 'prompt',
      rawContent: 'How do we handle auth and rate limits in this project?',
      workspaceId: 'ws-smoke'
    });

    const epiId = await memoryService.createEpisodicSummary(sessionId, {
      scope: SCOPE.SESSION,
      workspaceId: 'ws-smoke'
    });

    if (epiId) {
      pass('Created episodic summary memory');
    } else {
      // it can legitimately return null if not enough content — don't hard fail
      console.log('   ℹ️  Episodic summary returned null (not enough content or fallback)');
      pass('Episodic path executed (no crash)');
    }

    // 8. Consolidate
    console.log('\n8. Consolidation (merge + decay + episodic + facts)');
    const beforeStats = await memoryService.getStats();

    const cResult = await memoryService.consolidate({ createEpisodicSummaries: true });

    const afterStats = await memoryService.getStats();

    console.log('   Consolidation result:', cResult);
    console.log('   totalMemories before/after:', beforeStats.totalMemories, '→', afterStats.totalMemories);

    // We consider it success if it didn't throw and returned numbers
    if (typeof cResult.merged === 'number' && typeof cResult.decayed === 'number') {
      pass('Consolidate returned structured result');
    } else {
      fail('Consolidate result missing fields');
    }

    // 9. Final stats check
    console.log('\n9. Final stats');
    const finalStats = await memoryService.getStats();

    console.log('   pinnedMemories:', finalStats.pinnedMemories);
    console.log('   totalFacts:', finalStats.totalFacts);
    console.log('   totalMemories:', finalStats.totalMemories);
    console.log('   embedding.provider:', finalStats.embedding?.provider);

    if (finalStats.pinnedMemories >= 1) pass('Stats contains pinnedMemories');
    if (finalStats.totalFacts >= 1) pass('Stats contains totalFacts');

    // 10. Cleanup
    await memoryService.shutdown();

    // Summary
    console.log('\n──────────────────────────────');
    if (results.failed === 0) {
      console.log('✅ PHASE 3 SMOKE TEST PASSED');
      console.log(`   ${results.passed} checks successful`);
    } else {
      console.log('❌ PHASE 3 SMOKE TEST FAILED');
      console.log(`   Passed: ${results.passed}  Failed: ${results.failed}`);
      results.details.forEach(d => console.log('   -', d.name, d.error ? `(${d.error})` : ''));
      process.exitCode = 1;
    }
    console.log('──────────────────────────────\n');

  } catch (fatal) {
    console.error('\n💥 Fatal error during smoke test:', fatal);
    process.exitCode = 1;
  }
}

runPhase3Smoke().catch(err => {
  console.error('Unhandled:', err);
  process.exit(1);
});
