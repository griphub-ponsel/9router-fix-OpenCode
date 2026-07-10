import { describe, expect, it } from "vitest";

import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

describe("Kiro system instructions", () => {
  it("sends Claude system prompts natively and as a tagged fallback", () => {
    const result = claudeToKiroRequest("claude-opus-4-8", {
      system: "Follow repository instructions.",
      messages: [{ role: "user", content: "Fix the bug." }],
      max_tokens: 1024,
    }, true, {});

    const message = result.conversationState.currentMessage.userInputMessage;
    expect(message.modelId).toBe("claude-opus-4.8");
    expect(message.systemInstruction).toBe("Follow repository instructions.");
    expect(message.content).toContain("<instructions>\nFollow repository instructions.\n</instructions>");
  });

  it("tags OpenAI system messages before sending them as Kiro user content", () => {
    const result = openaiToKiroRequest("claude-sonnet-5", {
      messages: [
        { role: "system", content: "Use terse output." },
        { role: "user", content: "Hello" },
      ],
    }, true, {});

    const allUserContent = [
      ...result.conversationState.history,
      result.conversationState.currentMessage,
    ]
      .map((item) => item.userInputMessage?.content || "")
      .join("\n");
    expect(allUserContent).toContain("<instructions>\nUse terse output.\n</instructions>");
  });
});
