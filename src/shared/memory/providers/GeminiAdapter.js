/**
 * Google Gemini Provider Adapter
 * Formats memories for Gemini API (context format)
 */

const ProviderAdapter = require('./ProviderAdapter');

class GeminiAdapter extends ProviderAdapter {
  /**
   * Inject memories into Gemini context
   * Uses developer message style with clear sections
   */
  injectMemories(memories, context = {}) {
    if (!memories || memories.length === 0) {
      return '';
    }

    const lines = [];
    
    // Add header
    lines.push('## Project Context & Memory');
    lines.push('');
    
    // Organize by scope importance
    const sorted = this.sortByImportance(memories);
    
    for (const memory of sorted) {
      lines.push(this.formatMemoryLine(memory));
    }
    
    return lines.join('\n').trim();
  }

  /**
   * Format single memory line
   */
  formatMemoryLine(memory) {
    const prefix = this.getScopeIcon(memory.scope);
    const typeLabel = this.formatTypeLabel(memory.type);
    
    return `${prefix} **[${typeLabel}]** ${memory.title}\n${memory.content}`;
  }

  /**
   * Get scope icon/emoji
   */
  getScopeIcon(scope) {
    const icons = {
      global: '🌐',
      workspace: '📁',
      project: '📊',
      session: '💬',
      agent: '🤖',
      user: '👤'
    };
    
    return icons[scope] || '•';
  }

  /**
   * Format type label
   */
  formatTypeLabel(type) {
    const labels = {
      conversation: 'Conversation',
      user_pref: 'Preference',
      project: 'Project Info',
      agent: 'Agent Data',
      episodic: 'Experience',
      semantic: 'Fact',
      procedural: 'Workflow'
    };
    
    return labels[type] || type;
  }

  /**
   * Sort memories by importance and recency
   */
  sortByImportance(memories) {
    return [...memories].sort((a, b) => {
      // Primary: importance score
      if (b.importance_score !== a.importance_score) {
        return b.importance_score - a.importance_score;
      }
      
      // Secondary: recency
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  /**
   * Build full system message for Gemini
   */
  buildContext(basePrompt, memories) {
    const memorySection = this.injectMemories(memories);
    
    if (!memorySection) {
      return basePrompt;
    }
    
    return `${basePrompt}\n\n---\n\n${memorySection}`;
  }

  getName() {
    return 'gemini';
  }

  /**
   * Check token limit warnings
   * Gemini has specific limits per request
   */
  checkTokenLimit(promptTokens, memoryTokens, maxTokens = 128000) {
    const total = promptTokens + memoryTokens;
    
    if (total > maxTokens * 0.9) {
      return {
        exceeds: true,
        remaining: maxTokens - total,
        warning: `Memory injection will use ${((memoryTokens / maxTokens) * 100).toFixed(1)}% of context window`
      };
    }
    
    return {
      exceeds: false,
      remaining: maxTokens - total
    };
  }
}

module.exports = GeminiAdapter;
