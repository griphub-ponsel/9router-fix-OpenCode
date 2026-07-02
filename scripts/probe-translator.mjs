// Direct probe: feed the exact upstream Responses-API SSE events through the
// translateResponse pipeline (openai-responses -> openai) to find where text is lost.
import { translateResponse, initState } from "../open-sse/translator/index.js";

const FROM = "openai-responses"; // upstream format (xai-oauth transport)
const TO = "openai";             // client format (VS Code chat completions)

const events = [
  // Exact xAI at-capacity error event (flat shape, no data.error wrapper)
  { sequence_number: 0, type: "error", code: null, message: "The model is currently at capacity due to high demand. Please try again in a few minutes.", param: null },
];

const state = initState ? initState() : {};
for (const ev of events) {
  const out = translateResponse(FROM, TO, ev, state);
  const shown = out == null ? "null" : JSON.stringify(out);
  console.log(`${ev.type.padEnd(38)} -> ${shown.slice(0, 220)}`);
}
// flush
const flush = translateResponse(FROM, TO, null, state);
console.log(`FLUSH${" ".repeat(33)} -> ${JSON.stringify(flush)?.slice(0, 220)}`);
