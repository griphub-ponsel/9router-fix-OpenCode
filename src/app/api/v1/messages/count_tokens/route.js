const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

function countValueChars(value) {
  if (value == null) return 0;
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).length;
  if (Array.isArray(value)) return value.reduce((total, item) => total + countValueChars(item), 0);
  if (typeof value === "object") {
    return Object.entries(value).reduce(
      (total, [key, item]) => total + key.length + countValueChars(item),
      0
    );
  }
  return 0;
}

function countContentBlockChars(block) {
  if (block == null) return 0;
  if (typeof block === "string") return block.length;
  if (typeof block !== "object") return countValueChars(block);
  if (block.type === "text") return countValueChars(block.text);
  if (block.type === "tool_use") return countValueChars(block.name) + countValueChars(block.input);
  if (block.type === "tool_result") return countValueChars(block.content);
  if (block.type === "thinking") return countValueChars(block.thinking);
  return countValueChars(block);
}

function countMessageChars(message) {
  if (!message || typeof message !== "object") return 0;
  if (typeof message.content === "string") return message.content.length;
  if (Array.isArray(message.content)) {
    return message.content.reduce((total, block) => total + countContentBlockChars(block), 0);
  }
  return countValueChars(message.content);
}

export function estimateAnthropicInputTokens(body = {}) {
  let totalChars = countValueChars(body.system) + countValueChars(body.tools);
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    totalChars += countMessageChars(message);
  }
  return Math.ceil(totalChars / 4);
}

/**
 * POST /v1/messages/count_tokens - Mock token count response
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  const inputTokens = estimateAnthropicInputTokens(body);

  return new Response(JSON.stringify({
    input_tokens: inputTokens
  }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

