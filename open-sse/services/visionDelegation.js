/**
 * Vision delegation for models whose upstream API rejects image inputs even
 * though the model family is otherwise capable (e.g. xAI Grok Composer/Build
 * via the SuperGrok OAuth Responses API).
 *
 * Background: xAI gates image input by model at the API level. `grok-4.x`
 * accepts `input_image`, but the coding-optimized variants (`grok-composer-*`,
 * `grok-build-*`, `grok-code-*`) return:
 *   400 { "error": "Invalid request content: Image inputs are not supported by this model." }
 * The official Grok Build CLI still lets these models "see" images because it
 * delegates image understanding to a vision-capable sibling and feeds the
 * resulting text back into the coding model. This module replicates that.
 *
 * This file is intentionally pure (no executor/handler imports) so it stays
 * free of circular dependencies. The actual sibling model call is orchestrated
 * by the caller (chatCore), which already owns credentials + dispatch.
 */

// Provider → vision-capable sibling model used to describe images.
const VISION_SIBLINGS = {
  "xai-oauth": "grok-4.3",
};

// Per-provider matcher for models that need delegation (API rejects raw images).
const DELEGATION_MODEL_PATTERNS = {
  "xai-oauth": /composer|build|grok-code/i,
};

const IMAGE_PART_TYPES = new Set(["image_url", "image", "input_image"]);

/**
 * Whether a model needs image understanding delegated to a sibling because its
 * own upstream API rejects image inputs.
 */
export function needsVisionDelegation(provider, model) {
  const pattern = DELEGATION_MODEL_PATTERNS[provider];
  if (!pattern) return false;
  return pattern.test(String(model || ""));
}

/** Vision-capable sibling model id for a provider, or null. */
export function getVisionSibling(provider) {
  return VISION_SIBLINGS[provider] || null;
}

/** True if the request body carries any image content parts. */
export function bodyHasImages(body) {
  return collectImageParts(body).length > 0;
}

/**
 * Collect normalized image references from an OpenAI chat-format body.
 * Returns [{ url, detail }]. Supports `image_url` (string or {url}) and
 * Responses-style `input_image`.
 */
export function collectImageParts(body) {
  const images = [];
  const scanContent = (content) => {
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (!part || !IMAGE_PART_TYPES.has(part.type)) continue;
      let url = "";
      let detail = "auto";
      if (part.type === "image_url") {
        url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url || "";
        detail = (typeof part.image_url === "object" && part.image_url?.detail) || "auto";
      } else if (part.type === "input_image") {
        url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url || part.file_id || "";
        detail = part.detail || "auto";
      } else if (part.type === "image") {
        // Claude-style { source: { type:"base64", media_type, data } }
        const src = part.source;
        if (src?.type === "base64" && src.data) url = `data:${src.media_type || "image/png"};base64,${src.data}`;
        else if (typeof src?.url === "string") url = src.url;
      }
      if (url) images.push({ url, detail });
    }
  };
  if (Array.isArray(body?.messages)) {
    for (const msg of body.messages) scanContent(msg.content);
  }
  if (Array.isArray(body?.input)) {
    for (const item of body.input) scanContent(item.content);
  }
  return images;
}

/**
 * Replace every image content part in the body with a single text marker.
 * Mutates body in place. Text-only parts are preserved.
 *
 * @param {object} body
 * @param {string} markerText - text injected where the image(s) were.
 */
export function replaceImagesWithText(body, markerText) {
  const rewriteContent = (content) => {
    if (!Array.isArray(content)) return content;
    let hadImage = false;
    const kept = [];
    for (const part of content) {
      if (part && IMAGE_PART_TYPES.has(part.type)) {
        hadImage = true;
        continue;
      }
      kept.push(part);
    }
    if (!hadImage) return content;
    // Choose the text shape matching sibling parts (input_text for Responses-style)
    const usesInputText = kept.some((p) => p?.type === "input_text");
    kept.push({ type: usesInputText ? "input_text" : "text", text: markerText });
    return kept;
  };
  if (Array.isArray(body?.messages)) {
    for (const msg of body.messages) {
      const next = rewriteContent(msg.content);
      if (next !== msg.content) msg.content = next;
    }
  }
  if (Array.isArray(body?.input)) {
    for (const item of body.input) {
      const next = rewriteContent(item.content);
      if (next !== item.content) item.content = next;
    }
  }
  return body;
}

/**
 * Build a minimal OpenAI chat-completions body that asks a vision sibling to
 * describe the given images factually for a downstream coding assistant.
 */
export function buildVisionProbeBody(siblingModel, images) {
  const content = [
    {
      type: "text",
      text:
        "You are a vision relay for a coding assistant that cannot see images. " +
        "Describe the attached image(s) thoroughly and factually: transcribe any " +
        "visible text/code verbatim, describe UI elements, diagrams, errors, and " +
        "layout. Be concise but complete. Output only the description.",
    },
    ...images.map((img) => ({
      type: "image_url",
      image_url: { url: img.url, detail: img.detail || "auto" },
    })),
  ];
  return {
    model: siblingModel,
    stream: false,
    messages: [{ role: "user", content }],
  };
}

/**
 * Format the delegated description (or a graceful fallback note) as the text
 * marker injected into the original request.
 */
export function formatVisionMarker(description, { count = 1, delegated = true, sibling = "" } = {}) {
  const plural = count > 1 ? `${count} images` : "an image";
  if (delegated && description) {
    return (
      `[Image understanding relayed via ${sibling}. The user attached ${plural}. ` +
      `Description follows]\n${description}`
    );
  }
  return (
    `[The user attached ${plural}, but this model cannot process images directly. ` +
    `Ask the user to describe it, or switch to a vision model such as grok-4.3.]`
  );
}
