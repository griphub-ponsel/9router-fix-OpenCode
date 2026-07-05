// Quick manual smoke test for Headroom /v1/compress.
// Sends a deliberately bloated conversation and prints the before/after token
// + byte savings so the benefit is visible. Run: node scripts/headroom-smoke.mjs
const URL = process.env.HEADROOM_URL || "http://127.0.0.1:8787";

const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

// Build a chunky, repetitive conversation (the kind that eats context).
const bigToolOutput = Array.from({ length: 40 }, (_, i) =>
  `[row ${i}] service=api-gateway status=200 latency_ms=${100 + i} region=ap-southeast-1 trace_id=abc${i}def user=anon path=/v1/健orders retries=0 cache=HIT bytes=${2048 + i}`
).join("\n");

const messages = [
  { role: "system", content: "You are a helpful assistant. Be concise." },
  { role: "user", content: "Here are the logs from the last deploy, analyze them:\n\n" + bigToolOutput },
  { role: "assistant", content: "Understood. The logs show 40 successful requests, all HTTP 200, latency between 100-139ms, cache hits throughout. No retries or errors." },
  { role: "user", content: "Now here are the same logs again for the second region:\n\n" + bigToolOutput },
  { role: "assistant", content: "Same healthy pattern for the second region: all 200s, cache hits, low latency, no retries." },
  { role: "user", content: "And a third batch, please keep tracking:\n\n" + bigToolOutput },
  { role: "user", content: "Summarize the overall health." },
];

const payload = {
  messages,
  model: "claude-3-5-sonnet-20241022",
  config: { compress_user_messages: true },
};

const beforeBytes = bytes(messages);

const res = await fetch(`${URL}/v1/compress`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

if (!res.ok) {
  console.error(`compress failed: HTTP ${res.status}`, await res.text());
  process.exit(1);
}

const data = await res.json();
const afterBytes = bytes(data.messages);

console.log("=== Headroom compress result ===");
console.log("messages before:", messages.length, "| after:", data.messages?.length);
console.log("payload bytes  before:", beforeBytes, "| after:", afterBytes,
  `(${(((beforeBytes - afterBytes) / beforeBytes) * 100).toFixed(1)}% smaller)`);
if (data.stats) {
  console.log("proxy stats:", JSON.stringify(data.stats, null, 2));
}
