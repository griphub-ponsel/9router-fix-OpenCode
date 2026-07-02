// Probe: what raw SSE event types does the xAI Responses API emit for composer?
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const auth = JSON.parse(readFileSync(join(homedir(), ".grok", "auth.json"), "utf8"));
const token = Object.values(auth)[0].key;

const body = {
  model: process.argv[2] || "grok-composer-2.5-fast",
  stream: true,
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Say hello in one word." }] }],
};

const res = await fetch("https://api.x.ai/v1/responses", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
console.log("HTTP", res.status);
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = "";
const types = new Map();
let sample = [];
let outText = "";
let emptyDeltas = 0;
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split("\n");
  buf = lines.pop();
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const p = line.slice(5).trim();
    if (!p || p === "[DONE]") continue;
    try {
      const j = JSON.parse(p);
      const t = j.type || "?";
      types.set(t, (types.get(t) || 0) + 1);
      if (t === "response.output_text.delta") {
        if (!j.delta) emptyDeltas++;
        outText += j.delta || "";
      }
      if (sample.length < 8) sample.push(p.slice(0, 300));
    } catch {}
  }
}
console.log("event types:", Object.fromEntries(types));
console.log("empty output deltas:", emptyDeltas);
console.log("output text length:", outText.length);
console.log("output text (first 400):", JSON.stringify(outText.slice(0, 400)));
