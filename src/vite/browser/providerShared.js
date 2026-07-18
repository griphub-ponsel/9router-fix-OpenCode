export function mapStainlessOs() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  if (/mac/i.test(platform)) return 'MacOS';
  if (/win/i.test(platform)) return 'Windows';
  if (/linux/i.test(platform)) return 'Linux';
  return `Other::${platform || 'browser'}`;
}

export function mapStainlessArch() {
  return 'other::browser';
}

export const ANTHROPIC_API_VERSION = '2023-06-01';

export const CLAUDE_API_HEADERS = {
  'Anthropic-Version': ANTHROPIC_API_VERSION,
  'Anthropic-Beta': 'claude-code-20250219,interleaved-thinking-2025-05-14',
};

export const CLAUDE_CLI_SPOOF_HEADERS = {
  'Anthropic-Version': ANTHROPIC_API_VERSION,
  'Anthropic-Beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28',
  'Anthropic-Dangerous-Direct-Browser-Access': 'true',
  'User-Agent': 'claude-cli/2.1.92 (external, sdk-cli)',
  'X-App': 'cli',
  'X-Stainless-Helper-Method': 'stream',
  'X-Stainless-Retry-Count': '0',
  'X-Stainless-Runtime-Version': 'v24.14.0',
  'X-Stainless-Package-Version': '0.80.0',
  'X-Stainless-Runtime': 'browser',
  'X-Stainless-Lang': 'js',
  'X-Stainless-Arch': mapStainlessArch(),
  'X-Stainless-Os': mapStainlessOs(),
  'X-Stainless-Timeout': '600',
};

export const KIMI_CODING_BASE_URL = 'https://api.kimi.com/coding/v1/messages';
export const OPENAI_COMPAT_BASE = 'https://api.openai.com/v1';
export const ANTHROPIC_COMPAT_BASE = 'https://api.anthropic.com/v1';
export const ANTIGRAVITY_IDE_VERSION = '2.1.1';
export const ANTIGRAVITY_IDE_BASE_URL = 'https://cloudcode-pa.googleapis.com';
export const ANTIGRAVITY_IDE_USER_AGENT = `antigravity/ide/${ANTIGRAVITY_IDE_VERSION} darwin/arm64`;

export const ANTIGRAVITY_OAUTH_CLIENT = {
  clientId: '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-K58FWR486LdLJmLB8sXC4z6qDAf',
};

export const GOOGLE_OAUTH_CLIENT = {
  clientId: '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com',
  clientSecret: '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',
};
