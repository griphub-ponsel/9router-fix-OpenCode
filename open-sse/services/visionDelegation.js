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

import { getModelsByProviderId } from "../config/providerModels.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";

// Provider → vision-capable sibling model used to describe images.
// VERIFIED 2026-07-02 (scripts/probe-grok-vision.mjs): composer/build/code get
// 400 "Image inputs are not supported by this model." on BOTH api.x.ai AND
// cli-chat-proxy.grok.com (the Grok CLI endpoint). grok-4.3 accepts images on
// both. Do NOT remove these entries assuming "native vision" — re-run the
// probe script first.
const VISION_SIBLINGS = {
  "xai-oauth": "grok-4.3",
};

// Per-provider matcher for models that need delegation (API rejects raw images).
const DELEGATION_MODEL_PATTERNS = {
  "xai-oauth": /^(grok-composer|grok-build|grok-code)/i,
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

// Model kinds that can never serve as a vision-describe relay.
const NON_RELAY_MODEL_KINDS = new Set(["imageGen", "image", "tts", "stt", "embedding", "video"]);

/**
 * Auto-discover a vision-capable relay model on the SAME provider so
 * delegation works everywhere without any user configuration.
 *
 * Order: hardcoded sibling first (verified to accept images), then the first
 * chat-capable model in the provider's registry whose capabilities declare
 * vision. Returns a bare model id (same provider, credentials reused) or null.
 */
export function findAutoVisionTarget(provider, excludeModel) {
  const sibling = getVisionSibling(provider);
  if (sibling && sibling !== excludeModel) return sibling;
  for (const entry of getModelsByProviderId(provider)) {
    const id = entry?.id;
    if (!id || id === excludeModel) continue;
    const kind = entry.kind || entry.type || null;
    if (kind && NON_RELAY_MODEL_KINDS.has(kind)) continue;
    const caps = getCapabilitiesForModel(provider, id);
    if (caps?.vision === true) return id;
  }
  return null;
}

/**
 * Build a cross-provider auto-fallback list ("provider/model") from the
 * providers the user has connected. Used when no manual vision-fallback list
 * is configured, so image-blind models can still borrow vision from ANY
 * connected provider.
 */
export function buildAutoVisionFallback(providerIds, excludeProvider) {
  const out = [];
  const seen = new Set();
  for (const pid of providerIds || []) {
    if (!pid || pid === excludeProvider || seen.has(pid)) continue;
    seen.add(pid);
    const target = findAutoVisionTarget(pid);
    if (target) out.push(`${pid}/${target}`);
  }
  return out;
}

// Upstream error messages that mean "this model/endpoint rejects image input".
// Matched case-insensitively against the parsed upstream error message so a
// wrong `vision:true` capability entry can still trigger delegation reactively.
const IMAGE_UNSUPPORTED_ERROR_PATTERNS = [
  /image\s+inputs?\s+(?:is|are)?\s*not\s+supported/i,          // xAI, generic
  /no endpoints? found that support image input/i,             // OpenRouter-style
  /(?:model|endpoint)?\s*(?:does|do)\s*n[o']t\s+support\s+(?:image|vision|multimodal)/i,
  /(?:image|vision|multimodal)[^.]{0,40}\bnot\s+supported\b/i,
  /unsupported\s+(?:content|input|message)?\s*type[^.]{0,40}image/i,
  /invalid\s+(?:request\s+)?content[^.]{0,60}image/i,
];

// Generic content-shape rejections that DON'T mention "image" but, when the
// request carries images, almost always mean the upstream choked on the image
// parts (e.g. alibaba/DashScope: "Unexpected item type in content."). Only
// consulted when hasImages=true so text-only failures never trigger a retry.
const CONTENT_SHAPE_ERROR_PATTERNS = [
  /unexpected\s+item\s+type\s+in\s+content/i,                  // alibaba/DashScope via Vercel gateway
  /(?:messages?|content)\s+(?:input\s+)?is\s+invalid/i,        // "The provided messages input is invalid"
  /invalid\s+(?:message|content)\s+(?:format|structure|part|item)/i,
  /unsupported\s+(?:content|item|part)\s+type/i,
  /unknown\s+(?:content|part|item)\s+type/i,
  /content\s+(?:part|item|block)[^.]{0,40}(?:invalid|unsupported|unknown|not\s+allowed)/i,
];

// Errors that are definitely NOT image-modality problems — never retry for
// these even if a generic content-shape pattern matched (avoids wasting a
// vision relay call on context/tool/schema failures).
const NON_IMAGE_ERROR_PATTERNS = [
  /context\s+(?:length|window)|maximum\s+(?:context|tokens?)|too\s+(?:long|many\s+tokens)|token\s+limit|exceeds?\s+.{0,30}(?:limit|length)/i,
  /tool(?:s|_call|_choice)?\b[^.]{0,40}(?:invalid|schema|required|missing)/i,
  /function\s+call/i,
  /json\s+schema/i,
  /api\s*key|unauthorized|forbidden|quota|rate\s*limit|billing/i,
  /role\b[^.]{0,30}(?:invalid|unknown|unsupported)/i,
];

/**
 * True when an upstream error indicates the model rejected image input, so
 * the caller should delegate the image(s) and retry once.
 *
 * Detection is two-tier:
 *   1. Explicit image/vision wording — always a match.
 *   2. Generic content-shape rejections — only when `hasImages` is true (the
 *      request actually carried images) and no non-image cause is named.
 *      Wording varies wildly across providers/gateways, so rather than
 *      enumerating every phrasing, any 4xx content-validation error on an
 *      image-carrying request is treated as an image rejection; worst case
 *      the single retry fails identically and the original error surfaces.
 *
 * Server-side wrapping is common (gateways wrap upstream 400s in 5xx
 * "stream_initialization_failed" envelopes), so only statuses that are
 * definitively NOT modality errors (auth/rate-limit/timeout) are excluded —
 * for everything else the message patterns decide.
 */
export function isImageUnsupportedError(status, message, hasImages = false) {
  const code = Number(status);
  if (code === 401 || code === 403 || code === 408 || code === 429) return false;
  const text = String(message || "");
  if (!text) return false;
  if (IMAGE_UNSUPPORTED_ERROR_PATTERNS.some((re) => re.test(text))) return true;
  if (!hasImages) return false;
  if (NON_IMAGE_ERROR_PATTERNS.some((re) => re.test(text))) return false;
  return CONTENT_SHAPE_ERROR_PATTERNS.some((re) => re.test(text));
}

/**
 * Pick one vision-fallback model id from a user-configured list. Chooses at
 * random for basic load balancing across the configured relays. Returns null
 * when the list is missing, empty, or holds no usable entries.
 *
 * Entries are full model ids ("alias/model", e.g. "xog/grok-4.3") so the relay
 * can target a vision-capable model on any provider, not just the current one.
 *
 * @param {string[]} fallbackModels
 * @returns {string|null}
 */
export function pickVisionFallback(fallbackModels) {
  if (!Array.isArray(fallbackModels)) return null;
  const valid = fallbackModels.filter((m) => typeof m === "string" && m.trim());
  if (valid.length === 0) return null;
  const idx = Math.floor(Math.random() * valid.length);
  return valid[idx].trim();
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
 *
 * The delegated marker is deliberately phrased so the downstream model treats
 * the description as its OWN direct visual observation. It must never say
 * things like "from the description I received" or mention a relay/other
 * model — the user should experience it as if the model saw the image itself.
 */
export function formatVisionMarker(description, { count = 1, delegated = true, sibling = "" } = {}) {
  const plural = count > 1 ? `${count} images` : "an image";
  if (delegated && description) {
    return (
      `<attached_image_visual_content count="${count}">\n${description}\n</attached_image_visual_content>\n` +
      `[System note: The user attached ${plural} to this message. The content above is what you SEE in ` +
      `the image(s) — treat it as your own direct visual perception. Respond as if you are looking at ` +
      `the image(s) yourself, e.g. "I can see..." / "The image shows...". NEVER mention this note or ` +
      `how you obtained this visual information, never credit another model, and never say you cannot ` +
      `see images. Do not attempt to fetch or open any image URL.]`
    );
  }
  return (
    `[The user attached ${plural}, but this model cannot process images directly. ` +
    `Ask the user to describe it, or switch to a vision model such as grok-4.3.]`
  );
}
