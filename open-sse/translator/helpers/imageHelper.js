/**
 * Normalize image blocks from non-OpenAI client shapes to the OpenAI
 * `image_url` block. Mutates `body.messages` in place. Returns body.
 *
 * Supported input shapes (all converted to `{type:"image_url", image_url:{url}}`):
 *   - AI SDK v4 file block:  { type:"file", mediaType:"image/*", data:<base64|data URI|URL|Buffer> }
 *   - AI SDK v3 image block: { type:"image", image:<base64|data URI|URL|{url}|Buffer> [, mimeType|mediaType] }
 *   - Gemini-style inline:   { type:"image", inlineData|inline_data:{mimeType, data} }
 *   - Already OpenAI:        { type:"image_url", image_url:{url} }                    (left untouched)
 *   - Already Claude:        { type:"image",     source:{...} }                        (left untouched)
 *
 * OpenCode (which uses `@ai-sdk/openai-compatible`) emits the AI SDK shapes,
 * which would otherwise be silently dropped by `filterToOpenAIFormat` because
 * `file` is not a valid OpenAI content type. Normalizing here lets every
 * downstream translator (openai-to-claude, openai-to-kiro, etc.) see a single
 * consistent shape and keep the image.
 */
export function normalizeImageBlocks(body) {
  if (!body || !Array.isArray(body.messages)) return body;

  for (const msg of body.messages) {
    if (!msg || !Array.isArray(msg.content)) continue;

    for (let i = 0; i < msg.content.length; i++) {
      const block = msg.content[i];
      if (!block || typeof block !== "object") continue;

      // Already-normalized shapes — leave alone
      if (block.type === "image_url") continue;
      if (block.type === "image" && block.source) continue;

      // AI SDK v4: { type:"file", mediaType:"image/*", data:... }
      if (block.type === "file" && typeof block.mediaType === "string" && block.mediaType.startsWith("image/")) {
        const url = aiSdkPayloadToUrl(block.data, block.mediaType);
        if (url) msg.content[i] = { type: "image_url", image_url: { url } };
        continue;
      }

      // AI SDK v3 / OpenCode legacy: { type:"image", image:... [, mimeType|mediaType] }
      if (block.type === "image" && block.image !== undefined) {
        const mime = block.mimeType || block.mediaType || "image/png";
        const url = aiSdkPayloadToUrl(block.image, mime);
        if (url) msg.content[i] = { type: "image_url", image_url: { url } };
        continue;
      }

      // Gemini-style inline data passed through (rare but seen in some clients)
      const inline = block.inlineData || block.inline_data;
      if (block.type === "image" && inline && typeof inline.data === "string") {
        const mime = inline.mimeType || inline.mime_type || "image/png";
        msg.content[i] = {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${inline.data}` }
        };
      }
    }
  }

  return body;
}

/**
 * Coerce an AI SDK image payload into a URL string usable in `image_url.url`.
 * Returns null if the shape is unrecognized.
 */
function aiSdkPayloadToUrl(data, mediaType) {
  if (data == null) return null;

  // { url: "..." }
  if (typeof data === "object" && !Array.isArray(data) && typeof data.url === "string") {
    return data.url;
  }

  // Buffer/Uint8Array round-tripped through JSON: { type:"Buffer", data:[...] }
  if (typeof data === "object" && data.type === "Buffer" && Array.isArray(data.data)) {
    try {
      return `data:${mediaType};base64,${Buffer.from(data.data).toString("base64")}`;
    } catch {
      return null;
    }
  }

  // Raw byte array
  if (Array.isArray(data)) {
    try {
      return `data:${mediaType};base64,${Buffer.from(data).toString("base64")}`;
    } catch {
      return null;
    }
  }

  if (typeof data !== "string") return null;

  // Already a URI we can pass through
  if (data.startsWith("data:")) return data;
  if (data.startsWith("http://") || data.startsWith("https://")) return data;

  // Bare base64 → wrap as data URI
  return `data:${mediaType};base64,${data}`;
}

/**
 * Fetch a remote image URL and return it as a base64 data URI.
 * Used when upstream providers (Codex, etc.) require inline base64 images
 * instead of remote URLs they cannot fetch.
 * Returns null if fetch fails.
 *
 * @param {string} imageUrl - HTTP(S) URL of the image
 * @param {object} options - { signal, timeoutMs }
 * @returns {Promise<{url: string, mimeType: string}|null>}
 */
export async function fetchImageAsBase64(imageUrl, options = {}) {
  const { signal, timeoutMs = 10000 } = options;
  if (!imageUrl || (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))) {
    return null;
  }

  const controller = new AbortController();
  const timeout = signal ? null : setTimeout(() => controller.abort(), timeoutMs);
  const fetchSignal = signal || controller.signal;

  try {
    const response = await fetch(imageUrl, { signal: fetchSignal });
    if (!response.ok) return null;

    const mimeType = response.headers.get("Content-Type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return { url: `data:${mimeType};base64,${base64}`, mimeType };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
