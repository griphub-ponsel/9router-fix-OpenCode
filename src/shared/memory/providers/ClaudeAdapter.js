/**
 * Anthropic/Claude Provider Adapter
 * Formats memories for Claude API (system prompt)
 */

const ProviderAdapter = require('./ProviderAdapter');

class ClaudeAdapter extends ProviderAdapter {
  /**
   * Inject memories into Claude system prompt
   * Systems are prepended to conversation context
   */
  injectMemories(memories, context = {}) {
    if (!memories || memories.length === 0) {
      return '';
    }

    const sections = [];
    
    // Always put high-priority memories first
    const priorityMemories = memories.filter(m => m.importance_score > 0.7);
    const standardMemories = memories.filter(m => m.importance_score <= 0.7);
    
    if (priorityMemories.length > 0) {
      sections.push(this.formatSection('Important Context', priorityMemories));
    }
    
    if (standardMemories.length > 0) {
      sections.push(this.formatSection('Additional Knowledge', standardMemories));
    }

    return sections.join('\n\n');
  }

  /**
   * Format section of memories
   */
  formatSection(title, memories) {
    let content = `### ${title}\n\n`;
    
    for (const memory of memories) {
      content += `<memory type="${memory.type}" importance="${memory.importance_score}">\n`;
      content += `${memory.content}`;
      
      if (memory.summary) {
        content += `\n<summary>${memory.summary}</summary>\n`;
      }
      
      content += '</memory>\n\n';
    }
    
    return content.trim();
  }

  /**
   * Build complete system prompt with memories
   */
  buildSystemPrompt(basePrompt, memories) {
    const memoryContext = this.injectMemories(memories);
    
    if (!memoryContext) {
      return basePrompt;
    }
    
    return `${basePrompt}\n\n${memoryContext}`;
  }

  /**
   * Get injection format for developer message
   */
  getDeveloperMessageStyle() {
    return 'structured_xml'; // Use XML-like tags for clarity
  }

  getName() {
    return 'claude';
  }

  /**
   * Calculate token cost estimate for memories
   * Claude uses similar counting to OpenAI
   */
  estimateTokenCost(memories) {
    let totalTokens = 0;
    
    for (const memory of memories) {
      // Rough estimate: ~1.3 tokens per word
      const words = memory.content.trim().split(/\s+/).length;
      totalTokens += Math.ceil(words * 1.3);
      
      // Add overhead for XML tags and formatting
      totalTokens += 5; // Approximate tag overhead per memory
    }
    
    return totalTokens;
  }
}

module.exports = ClaudeAdapter;
