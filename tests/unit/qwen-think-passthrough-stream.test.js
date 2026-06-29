import { describe, expect, it } from "vitest";

import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

async function runPassthrough(provider, input) {
  const encoder = new TextEncoder();
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const output = source.pipeThrough(
    createPassthroughStreamWithLogger(provider, null, "qwen-test"),
  );

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function parseOpenAIChunks(sseText) {
  const chunks = [];
  for (const line of sseText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      chunks.push(JSON.parse(payload));
    } catch {
      // Ignore malformed lines in test parser.
    }
  }
  return chunks;
}

describe("Qwen passthrough think-tag compatibility", () => {
  it("converts split <think> blocks to reasoning_content and keeps visible text clean", async () => {
    const sse = [
      `data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "<th" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "ink>rahasia " }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "jangan bocor</thi" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "nk>Visible" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}`,
      "",
    ].join("\n");

    const output = await runPassthrough("qwen", sse);
    const chunks = parseOpenAIChunks(output);

    const content = chunks.map(c => c.choices?.[0]?.delta?.content || "").join("");
    const reasoning = chunks.map(c => c.choices?.[0]?.delta?.reasoning_content || "").join("");

    expect(output).not.toContain("<think>");
    expect(output).not.toContain("</think>");
    expect(content).toBe("Visible");
    expect(reasoning).toBe("rahasia jangan bocor");
    expect(output).toContain("data: [DONE]");
  });

  it("does not sanitize think tags for non-qwen providers", async () => {
    const sse = [
      `data: ${JSON.stringify({ id: "chatcmpl-2", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-2", choices: [{ index: 0, delta: { content: "<think>raw</think>text" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ id: "chatcmpl-2", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}`,
      "",
    ].join("\n");

    const output = await runPassthrough("openai", sse);
    const chunks = parseOpenAIChunks(output);
    const content = chunks.map(c => c.choices?.[0]?.delta?.content || "").join("");

    expect(content).toContain("<think>raw</think>text");
  });
});
