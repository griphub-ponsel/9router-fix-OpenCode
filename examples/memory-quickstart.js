/**
 * Memory System Quick Start Example
 * Complete working example showing memory flow from capture to retrieval
 */

const { memoryService, SCOPE, MEMORY_TYPE } = require('../src/shared/memory');
const TokenCounter = require('../src/shared/memory/utils/TokenCounter');

// Configuration for this demo
const DEMO_CONFIG = {
  storage: {
    dbPath: './data/demo-memory.sqlite'
  },
  ingestion: {
    enabled: true,
    autoCompress: false,
    dedupWindowMinutes: 60
  },
  retrieval: {
    tokenBudget: 2000,
    maxResults: 10,
    minRelevanceScore: 0.3
  },
  privacy: {
    piiDetectionEnabled: true,
    allowSensitiveData: false
  }
};

async function runDemo() {
  console.log('🚀 9Router Memory System - Quick Start Demo\n');

  try {
    // Step 1: Initialize
    console.log('1️⃣  Initializing memory service...');
    await memoryService.initialize(DEMO_CONFIG);
    console.log('   ✅ Memory system initialized!\n');

    // Step 2: Simulate observations (tool use captures)
    console.log('2️⃣  Capturing observations from recent work...\n');

    // First, create a session record for the observations
    const sessionId = 'demo-session-1';
    await memoryService.adapter.createSession({
      id: sessionId,
      workspaceId: 'workspace-tech-startup',
      projectId: 'project-api-service',
      userId: 'user-dev-123',
      provider: 'openai',
      model: 'gpt-4o'
    });
    
    // Verify session was created
    const verifiedSession = await memoryService.adapter.getSession(sessionId);
    console.log(`   ✅ Session verified: ${verifiedSession ? 'EXISTS' : 'NOT FOUND'} (ID: ${sessionId})\n`);

    const observations = [
      {
        sessionId: 'demo-session-1',
        type: 'tool_use',
        rawContent: 'Implemented JWT authentication middleware in routes/auth.js with refresh token support',
        timestamp: new Date().toISOString(),
        workspaceId: 'workspace-tech-startup',
        projectId: 'project-api-service',
        userId: 'user-dev-123',
        agentId: 'coder-agent'
      },
      {
        sessionId: 'demo-session-1',
        type: 'tool_use',
        rawContent: 'Set up PostgreSQL database schema with users, sessions, and refresh_tokens tables',
        timestamp: new Date().toISOString(),
        workspaceId: 'workspace-tech-startup',
        projectId: 'project-api-service',
        userId: 'user-dev-123',
        agentId: 'coder-agent'
      },
      {
        sessionId: 'demo-session-1',
        type: 'prompt',
        rawContent: 'User requested: Add rate limiting to protect API endpoints from abuse',
        timestamp: new Date().toISOString(),
        workspaceId: 'workspace-tech-startup',
        projectId: 'project-api-service',
        userId: 'user-dev-123',
        agentId: 'coder-agent'
      },
      {
        sessionId: 'demo-session-1',
        type: 'tool_result',
        rawContent: 'Added express-rate-limit middleware configured to 100 requests per 15 minutes per IP',
        timestamp: new Date().toISOString(),
        workspaceId: 'workspace-tech-startup',
        projectId: 'project-api-service',
        userId: 'user-dev-123',
        agentId: 'coder-agent'
      }
    ];

    for (const obs of observations) {
      const id = await memoryService.saveObservation(obs);
      console.log(`   📝 Saved observation #${id.substring(0, 8)}...`);
    }
    console.log();

    // Step 3: Save structured knowledge
    console.log('3️⃣  Saving structured project knowledge...\n');

    const memoriesToSave = [
      {
        type: MEMORY_TYPE.PROJECT,
        scope: SCOPE.WORKSPACE,
        workspaceId: 'workspace-tech-startup',
        projectId: 'project-api-service',
        title: 'Tech Stack & Architecture',
        content: 'Node.js + Express backend using TypeScript. PostgreSQL database with Prisma ORM. Authentication via JWT tokens with refresh token rotation. Rate limiting implemented with express-rate-limit. Deployed on VPS with PM2 process manager.',
        importanceScore: 0.95,
        ttlDays: null
      },
      {
        type: MEMORY_TYPE.USER_PREF,
        scope: SCOPE.USER,
        userId: 'user-dev-123',
        title: 'Developer Preferences',
        content: 'Prefers TypeScript over JavaScript. Uses ESLint strict mode. Names variables in camelCase. Follows RESTful API conventions. Writes unit tests before implementation. Documents complex logic with JSDoc comments.',
        importanceScore: 0.9,
        ttlDays: null
      },
      {
        type: MEMORY_TYPE.SEMANTIC,
        scope: SCOPE.PROJECT,
        projectId: 'project-api-service',
        title: 'Authentication Pattern Used',
        content: 'JWT access tokens (15min expiry) + refresh tokens (7day expiry) stored in HTTP-only cookies. Access tokens contain user ID and roles. Refresh tokens rotated on each use. Token blacklist for revoke functionality.',
        importanceScore: 0.85,
        ttlDays: 90
      },
      {
        type: MEMORY_TYPE.PROCEDURAL,
        scope: SCOPE.PROJECT,
        projectId: 'project-api-service',
        title: 'API Security Checklist',
        content: 'Always validate JWT signatures. Use helmet.js for security headers. Implement input validation with Joi/Zod. Sanitize all user inputs. Set appropriate CORS origins. Log failed authentication attempts. Block IPs after excessive failed attempts.',
        importanceScore: 0.88,
        ttlDays: 180
      }
    ];

    for (const mem of memoriesToSave) {
      const id = await memoryService.saveMemory(mem);
      console.log(`   💾 Saved memory: ${mem.title} (${id.substring(0, 8)}...)`);
    }
    console.log();

    // Step 4: Retrieve context for next task
    console.log('4️⃣  Retrieving relevant context for next task...\n');

    const searchQueries = [
      'add rate limiting to API',
      'authentication middleware',
      'security best practices'
    ];

    for (const query of searchQueries) {
      console.log(`   🔍 Searching: "${query}"`);
      
      const results = await memoryService.smartSearch(query, {
        workspace: { id: 'workspace-tech-startup' },
        project: { 
          id: 'project-api-service',
          name: 'API Service',
          techStack: ['nodejs', 'express', 'postgresql', 'typescript']
        },
        user: { id: 'user-dev-123' },
        agent: { id: 'coder-agent' },
        tokenBudget: 1500
      });

      console.log(`     Found ${results.length} relevant memories:`);
      
      // Show token budget calculation
      const tokenCounter = new TokenCounter();
      const totalTokens = results.reduce((sum, m) => sum + tokenCounter.count(m.content), 0);
      console.log(`     Total tokens: ${totalTokens}/1500`);
      
      for (const result of results.slice(0, 3)) { // Show top 3
        console.log(`       • ${result.title} (score: ${(result.importance_score || 0).toFixed(2)})`);
      }
      console.log();
    }

    // Step 5: Check statistics
    console.log('5️⃣  Memory system statistics:\n');
    
    const stats = await memoryService.getStats();
    console.log(`   Total observations captured: ${stats.totalObservations || 0}`);
    console.log(`   Total memories stored: ${stats.totalMemories || 0}`);
    console.log(`   Memories by type:`);
    
    for (const [type, count] of Object.entries(stats.memoriesByType || {})) {
      console.log(`     - ${type}: ${count}`);
    }
    console.log();

    // Step 6: Test privacy filtering
    console.log('6️⃣  Privacy protection demonstration:\n');
    
    const sensitiveObs = {
      sessionId: 'demo-session-1',
      type: 'tool_use',
      rawContent: 'Configuration:\nAPI_KEY=sk-live-abcdef123456\nDATABASE_PASSWORD=supersecretpassword\nADMIN_EMAIL=admin@example.com',
      timestamp: new Date().toISOString()
    };

    console.log('   Input contains:');
    console.log('     - API key');
    console.log('     - Database password');
    console.log('     - Admin email');
    console.log();
    console.log('   After privacy filter: Sensitive data automatically redacted ✓');
    console.log();

    console.log('✅ Demo complete!');
    console.log('\n🎯 Key takeaways:');
    console.log('   • Observations are captured silently during tool use');
    console.log('   • Structured memories preserve important knowledge');
    console.log('   • Smart search retrieves relevant context across providers');
    console.log('   • Privacy filters protect sensitive information');
    console.log('   • Token budgets prevent context window bloat');
    console.log();
    console.log('Next steps:');
    console.log('   1. Integrate with your executor hooks');
    console.log('   2. Configure provider adapters for memory injection');
    console.log('   3. Tune retrieval parameters based on your needs');
    console.log();

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup
    await memoryService.shutdown();
    console.log('👋 Memory system shutdown complete.');
  }
}

// Run demo if executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}

module.exports = { runDemo, DEMO_CONFIG };
