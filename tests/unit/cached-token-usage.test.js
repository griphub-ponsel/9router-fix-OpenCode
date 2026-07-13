import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveRequestUsageMock } = vi.hoisted(() => ({
  saveRequestUsageMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: saveRequestUsageMock,
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
}));

import {
  extractUsageFromResponse,
  saveUsageStats,
} from "../../open-sse/handlers/chatCore/requestDetail.js";

describe("cached token usage persistence", () => {
  beforeEach(() => {
    saveRequestUsageMock.mockClear();
  });

  it("preserves OpenAI nested cached tokens when saving usage", () => {
    saveUsageStats({
      provider: "codex",
      model: "gpt-test",
      tokens: {
        prompt_tokens: 1200,
        completion_tokens: 80,
        prompt_tokens_details: { cached_tokens: 900 },
      },
    });

    expect(saveRequestUsageMock).toHaveBeenCalledWith(expect.objectContaining({
      tokens: expect.objectContaining({
        prompt_tokens: 1200,
        completion_tokens: 80,
        cached_tokens: 900,
      }),
    }));
  });

  it("preserves Responses API cache and reasoning details", () => {
    saveUsageStats({
      provider: "grok-cli",
      model: "grok-test",
      tokens: {
        input_tokens: 500,
        output_tokens: 40,
        input_tokens_details: { cached_tokens: 320 },
        output_tokens_details: { reasoning_tokens: 25 },
      },
    });

    expect(saveRequestUsageMock).toHaveBeenCalledWith(expect.objectContaining({
      tokens: expect.objectContaining({
        prompt_tokens: 500,
        completion_tokens: 40,
        cached_tokens: 320,
        reasoning_tokens: 25,
      }),
    }));
  });

  it("extracts cache usage from Responses and Gemini responses", () => {
    expect(extractUsageFromResponse({
      usage: {
        input_tokens: 700,
        output_tokens: 60,
        input_tokens_details: { cached_tokens: 512 },
      },
    })).toEqual(expect.objectContaining({
      prompt_tokens: 700,
      completion_tokens: 60,
      cache_read_input_tokens: 512,
    }));

    expect(extractUsageFromResponse({
      usageMetadata: {
        promptTokenCount: 300,
        candidatesTokenCount: 20,
        cachedContentTokenCount: 128,
      },
    })).toEqual(expect.objectContaining({ cached_tokens: 128 }));
  });
});