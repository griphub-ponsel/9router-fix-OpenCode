import { describe, expect, it } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";

describe("OpenAI to Claude loose tool shape", () => {
  it("unwraps a function tool without an explicit parent type", () => {
    const result = openaiToClaudeRequest("claude-sonnet-5", {
      messages: [{ role: "user", content: "hello" }],
      tools: [{ function: { name: "echo", parameters: { type: "object" } } }],
    }, false);

    expect(result.tools).toEqual([
      expect.objectContaining({ name: "echo", input_schema: { type: "object" } }),
    ]);
  });
});
