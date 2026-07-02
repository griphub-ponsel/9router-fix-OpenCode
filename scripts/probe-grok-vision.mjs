// Probe: does grok-composer-2.5-fast accept input_image on api.x.ai vs cli-chat-proxy.grok.com?
// Reads token from Grok CLI auth.json. Never prints the token.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const auth = JSON.parse(readFileSync(join(homedir(), ".grok", "auth.json"), "utf8"));
const entry = Object.values(auth)[0];
const token = entry?.key || entry?.access_token || entry?.accessToken || (typeof entry === "string" ? entry : null);
if (!token) {
  console.log("keys in entry:", entry && typeof entry === "object" ? Object.keys(entry) : typeof entry);
  process.exit(1);
}

// 1x1 red pixel PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const MODEL = process.argv[2] || "grok-composer-2.5-fast";

const body = {
  model: MODEL,
  stream: false,
  input: [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "What color is this image? Answer with one word." },
        { type: "input_image", image_url: `data:image/png;base64,${PNG}`, detail: "auto" },
      ],
    },
  ],
};

async function probe(name, url) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-grok-client-version": "0.2.54",
        "x-grok-client-surface": "grok-cli",
        "User-Agent": "grok-cli/0.2.54",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`\n=== ${name} → HTTP ${res.status}`);
    console.log(text.slice(0, 600));
  } catch (e) {
    console.log(`\n=== ${name} → FETCH ERROR: ${e.message}`);
  }
}

await probe("api.x.ai", "https://api.x.ai/v1/responses");
await probe("cli-chat-proxy.grok.com", "https://cli-chat-proxy.grok.com/v1/responses");
