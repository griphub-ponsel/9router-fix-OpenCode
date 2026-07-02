// Replicate exactly what 9router sends upstream for xog/composer, print raw upstream reply.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { translateRequest } from "../open-sse/translator/index.js";

const auth = JSON.parse(readFileSync(join(homedir(), ".grok", "auth.json"), "utf8"));
const token = Object.values(auth)[0].key;

const clientBody = {
  model: "grok-composer-2.5-fast",
  stream: true,
  messages: [{ role: "user", content: "Say hello in one word" }],
};

// openai -> openai-responses, same as chatCore does for xai-oauth
const translated = translateRequest("openai", "openai-responses", "grok-composer-2.5-fast", structuredClone(clientBody), true, {}, "xai-oauth");

// xai-oauth executor transformRequest quirks
const body = { ...translated, model: "grok-composer-2.5-fast" };
if (body.max_tokens !== undefined && body.max_output_tokens === undefined) body.max_output_tokens = body.max_tokens;
delete body.max_tokens;
delete body.max_completion_tokens;
if (typeof body.instructions === "string" && body.instructions.trim() === "") delete body.instructions;

console.log("=== SENT BODY ===");
console.log(JSON.stringify(body, null, 2).slice(0, 1200));

const res = await fetch("https://api.x.ai/v1/responses", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
console.log("\n=== HTTP", res.status, "===");
const text = await res.text();
console.log(text.slice(0, 2000));
