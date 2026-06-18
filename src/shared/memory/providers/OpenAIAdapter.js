/**
 * OpenAI/GPT Provider Adapter
 * Formats memories for OpenAI API (messages format)
 */

const ProviderAdapter = require('./ProviderAdapter');

class OpenAIAdapter extends ProviderAdapter {
  /**
   * Inject memories into OpenAI prompt context
   * Memories added as additional system/instruction messages
   */
  injectMemories(memories, context = {}) {
    if (!memories || memories.length === 0) {
      return '';
    }

    const blocks = [];
    
    // Group memories by type for better organization
    const grouped = this.groupByType(memories);
    
    for (const [type, items] of Object.entries(grouped)) {
      if (items.length > 0) {
        blocks.push(this.formatMemoryBlock(type, items));
      }
    }

    // Join with clear separators
    const content = blocks.join('\n\n---\n\n');
    
    return `# Context & Knowledge Base\n\n${content}`;
  }

  /**
   * Format memory block by type
   */
  formatMemoryBlock(type, memories) {
    const titles = memories.map(m => m.title).join(', ');
    const contents = memories.map((m, i) => 
      `${i + 1}. ${m.content}${m.summary ? `\n   Summary: ${m.summary}` : ''}`
    ).join('\n');

    return `## ${this.formatTypeTitle(type)} (${memories.length})\nContext from: ${titles}\n\n${contents}`;
  }

  /**
   * Format human-readable type title
   */
  formatTypeTitle(type) {
    const titles = {
      conversation: 'Conversation Context',
      user_pref: 'User Preferences',
      project: 'Project Context',
      agent: 'Agent Information',
      episodic: 'Past Experiences',
      semantic: 'Facts & Knowledge',
      procedural: 'Workflows & Patterns'
    };
    
    return titles[type] || type;
  }

  /**
   * Group memories by type
   */
  groupByType(memories) {
    return memories.reduce((acc, memory) => {
      const type = memory.type;
      if (!acc[type]) acc[type] = [];
      acc[type].push(memory);
      return acc;
    }, {});
  }

  getName() {
    return 'openai';
  }

  /**
   * Format memory for OpenAI message system
   * Creates a dedicated message block
   */
  createMessageBlock(memories) {
    const content = this.injectMemories(memories);
    
    return {
      role: 'system',
      content
    };
  }

  /**
   * Get injection priority (where to insert in message array)
   * Returns index after system instructions
   */
  getInsertPosition(messages) {
    // Find first non-system message
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role !== 'system') {
        return i;
      }
    }
    return 0;
  }
}

module.exports = OpenAIAdapter;
