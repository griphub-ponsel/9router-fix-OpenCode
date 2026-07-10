import { describe, expect, it } from "vitest";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("VolcEngine Ark Kimi output cap", () => {
  it("clamps all OpenAI output token fields to 32768", () => {
    const body = {
      max_tokens: 262144,
      max_completion_tokens: 65536,
      max_output_tokens: 40000,
    };
    stripUnsupportedParams("volcengine-ark", "kimi-k2.7-code", body);
    expect(body).toEqual({
      max_tokens: 32768,
      max_completion_tokens: 32768,
      max_output_tokens: 32768,
    });
  });

  it("does not raise lower values or affect other providers", () => {
    const low = { max_tokens: 1024 };
    stripUnsupportedParams("volcengine-ark", "kimi-k2.7", low);
    expect(low.max_tokens).toBe(1024);
    const other = { max_tokens: 262144 };
    stripUnsupportedParams("kimi", "kimi-k2.7", other);
    expect(other.max_tokens).toBe(262144);
  });
});