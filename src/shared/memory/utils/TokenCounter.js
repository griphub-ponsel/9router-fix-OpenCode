/**
 * Token Counter Utility
 * Estimates token counts for text content
 */

class TokenCounter {
  constructor(options = {}) {
    this.options = {
      // Approximate: ~1.3 tokens per word for English
      wordsToTokensRatio: options.wordsToTokensRatio || 1.3,
      
      // Character threshold for quick estimate (no regex)
      fastMode: options.fastMode !== false,
      
      // Specific patterns to count differently
      codeBlocks: options.codeBlocks !== false,
      
      // Language-specific multipliers
      language: options.language || 'en'
    };
    
    this.languageMultipliers = {
      en: 1.0,
      es: 0.95,
      fr: 1.0,
      de: 1.05,
      ja: 0.7,  // CJK typically fewer characters per token
      zh: 0.65,
      ko: 0.75
    };
  }

  /**
   * Count tokens using fast approximation
   * @param {string} text - Input text
   * @returns {number} Estimated token count
   */
  count(text) {
    if (!text || text.length === 0) return 0;

    if (this.options.fastMode) {
      return this.fastCount(text);
    }

    return this.accurateCount(text);
  }

  /**
   * Fast estimation using character count
   * Accuracy: ±20% for typical text
   */
  fastCount(text) {
    const chars = text.length;
    // Rough estimate: 4 characters ≈ 1 token
    return Math.ceil(chars / 4);
  }

  /**
   * More accurate counting using word splitting
   * Accuracy: ±10% for typical text
   */
  accurateCount(text) {
    // Split by whitespace and count
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    
    let totalTokens = 0;
    for (const word of words) {
      totalTokens += this.countWord(word);
    }

    // Apply language multiplier
    const multiplier = this.languageMultipliers[this.options.language] || 1.0;
    totalTokens *= multiplier;

    return Math.ceil(totalTokens);
  }

  /**
   * Count tokens for a single word/token
   */
  countWord(token) {
    const len = token.length;

    if (len <= 4) {
      return 1; // Short tokens = 1 token
    } else if (len <= 16) {
      return Math.ceil(len / 4); // Medium tokens
    } else {
      return Math.ceil(len / 8) + 2; // Long tokens sublinear
    }
  }

  /**
   * Count tokens for multiple texts with context tracking
   * Useful for calculating memory injection budgets
   */
  countBatch(texts, options = {}) {
    const results = [];
    let runningTotal = 0;

    for (let i = 0; i < texts.length; i++) {
      const count = this.count(texts[i]);
      
      results.push({
        index: i,
        tokens: count,
        cumulative: count
      });

      runningTotal += count;
    }

    results.push({
      total: runningTotal,
      average: texts.length > 0 ? Math.round(runningTotal / texts.length) : 0
    });

    return results;
  }

  /**
   * Calculate remaining budget after current content
   * @param {string} currentContent - Current context/prompt
   * @param {number} maxBudget - Maximum allowed tokens
   * @returns {number} Remaining tokens available
   */
  calculateRemaining(currentContent, maxBudget) {
    const used = this.count(currentContent);
    return Math.max(0, maxBudget - used);
  }

  /**
   * Truncate text to fit within token budget
   * Preserves sentence boundaries where possible
   */
  truncateToFit(text, maxTokens) {
    if (!text) return '';
    
    const currentTokens = this.count(text);
    if (currentTokens <= maxTokens) return text;

    // Split into sentences
    const sentences = text.split(/(?<=[.!?])\s+/);
    let result = '';
    let usedTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.count(sentence);
      
      if (usedTokens + sentenceTokens <= maxTokens) {
        result += sentence + ' ';
        usedTokens += sentenceTokens;
      } else {
        break;
      }
    }

    return result.trim();
  }

  /**
   * Check if content exceeds budget
   */
  exceedsBudget(text, maxTokens) {
    return this.count(text) > maxTokens;
  }
}

module.exports = TokenCounter;
