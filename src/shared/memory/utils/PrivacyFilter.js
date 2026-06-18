/**
 * Privacy Filter Utility
 * Detects and redacts sensitive information from text
 */

class PrivacyFilter {
  constructor(config = {}) {
    this.config = {
      enablePIIDetection: config.enablePIIDetection !== false,
      redactAPIKeys: config.redactAPIKeys !== false && config.redactApiKeys !== false,
      redactPasswords: config.redactPasswords !== false,
      redactTokens: config.redactTokens !== false,
      customPatterns: config.customPatterns || []
    };
    
    this.patterns = this.initializePatterns();
  }

  initializePatterns() {
    const patterns = [];

    // API Keys (various formats) - use 'i' flag instead of inline (?i)
    if (this.config.redactAPIKeys) {
      patterns.push({
        name: 'api_key',
        regex: new RegExp('(?:api[_-\\s]?key|apikey)\\s*(?:is|[=:])\\s*[\'\"]?([a-zA-Z0-9_\\-.]{10,})[\'\"]?', 'gi'),
        replacement: '[REDACTED_API_KEY]'
      });

      patterns.push({
        name: 'openai_api_key',
        regex: /\bsk-[a-zA-Z0-9_\-]{8,}\b/gi,
        replacement: '[REDACTED_API_KEY]'
      });
      
      patterns.push({
        name: 'secret_key',
        regex: new RegExp('(?:secret[_-]?key|secretkey)\\s*[=:]\\s*[\'"]?([a-zA-Z0-9_\\-]{20,})[\'"]?', 'gi'),
        replacement: '[REDACTED_SECRET_KEY]'
      });
    }

    // Passwords
    if (this.config.redactPasswords) {
      patterns.push({
        name: 'password',
        regex: new RegExp('password\\s*[=:]\\s*[\'"]?([^\\s\'"]{4,})[\'"]?', 'gi'),
        replacement: '[REDACTED_PASSWORD]'
      });
    }

    // Auth Tokens
    if (this.config.redactTokens) {
      patterns.push({
        name: 'labeled_token',
        regex: /\btoken\s*[=:]\s*(?:bearer\s+)?[a-zA-Z0-9_\-.]{10,}/gi,
        replacement: '[REDACTED_TOKEN]'
      });

      patterns.push({
        name: 'bearer_token',
        regex: /\bbearer\s+[a-zA-Z0-9_\-.]+/gi,
        replacement: '[REDACTED_BEARER_TOKEN]'
      });
      
      patterns.push({
        name: 'auth_token',
        regex: /\b[a-zA-Z0-9_\-]{32,}\b/gi,
        replacement: '[REDACTED_TOKEN]',
        minConfidence: 0.7 // Only flag high-length tokens
      });
    }

    // PII Patterns
    if (this.config.enablePIIDetection) {
      // SSN (US format)
      patterns.push({
        name: 'ssn',
        regex: /\b\d{3}-\d{2}-\d{4}\b/g,
        replacement: '[REDACTED_SSN]'
      });

      // Credit Card (basic pattern)
      patterns.push({
        name: 'credit_card',
        regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|6(?:011|5[0-9]{2})[0-9]{12}|3[47][0-9]{13})\b/g,
        replacement: '[REDACTED_CREDIT_CARD]'
      });

      // Email addresses (optional - can be kept)
      // Uncomment if you want to redact emails too
      /*
      patterns.push({
        name: 'email',
        regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        replacement: '[REDACTED_EMAIL]'
      });
      */
    }

    // Add custom patterns
    if (this.config.customPatterns && this.config.customPatterns.length > 0) {
      this.config.customPatterns.forEach(pattern => {
        patterns.push({
          name: pattern.name || 'custom',
          regex: new RegExp(pattern.pattern, 'gi'),
          replacement: pattern.replacement || '[REDACTED]'
        });
      });
    }

    return patterns;
  }

  /**
   * Check if content contains sensitive data
   */
  containsSensitiveData(text) {
    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Redact sensitive information from text
   */
  redact(text) {
    let result = text;
    const changes = [];

    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      const matches = result.match(pattern.regex);
      if (matches && matches.length > 0) {
        pattern.regex.lastIndex = 0;
        result = result.replace(pattern.regex, pattern.replacement);
        changes.push({
          type: pattern.name,
          count: matches.length
        });
      }
    }

    return {
      redactedText: result,
      wasRedacted: changes.length > 0,
      changes
    };
  }

  /**
   * Extract only non-sensitive parts
   */
  extractSafeContent(text) {
    const sanitized = this.redact(text);
    return sanitized.redactedText;
  }

  /**
   * Get list of detected patterns in text
   */
  detectPatterns(text) {
    const detected = [];

    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      const matches = text.match(pattern.regex);
      if (matches && matches.length > 0) {
        detected.push({
          type: pattern.name,
          count: matches.length,
          samples: matches.slice(0, 3) // Show up to 3 examples
        });
      }
    }

    return detected;
  }
}

module.exports = PrivacyFilter;
