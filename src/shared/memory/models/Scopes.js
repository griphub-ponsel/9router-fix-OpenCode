/**
 * Memory Scope Constants
 */
const SCOPE = {
  GLOBAL: 'global',           // Available to all users/workspaces
  WORKSPACE: 'workspace',     // Scoped to workspace
  PROJECT: 'project',         // Scoped to specific project
  SESSION: 'session',         // Scoped to single session
  AGENT: 'agent',             // Scoped to specific agent/role
  USER: 'user'                // Scoped to individual user
};

/**
 * Memory Type Constants
 */
const MEMORY_TYPE = {
  CONVERSATION: 'conversation',  // Conversation context and flow
  USER_PREF: 'user_pref',        // User preferences and coding style
  PROJECT: 'project',            // Project structure and tech stack
  AGENT: 'agent',                // Agent-specific context and role
  EPISODIC: 'episodic',          // Task execution history
  SEMANTIC: 'semantic',          // Facts and knowledge
  PROCEDURAL: 'procedural'       // Patterns and workflows
};

/**
 * Memory Access Level
 */
const ACCESS_LEVEL = {
  PRIVATE: 'private',
  SHARED: 'shared',
  PUBLIC: 'public'
};

module.exports = {
  SCOPE,
  MEMORY_TYPE,
  ACCESS_LEVEL
};
