const THINK_OPEN_TAGS = ["<thinking>", "<think>"];
const THINK_CLOSE_TAGS = ["</thinking>", "</think>"];
const THINK_ALL_TAGS = [...THINK_OPEN_TAGS, ...THINK_CLOSE_TAGS];
const MAX_TAG_LEN = THINK_ALL_TAGS.reduce((max, tag) => Math.max(max, tag.length), 0);

function findNextTag(haystackLower, start, tags) {
  let bestIndex = -1;
  let bestTag = "";

  for (const tag of tags) {
    const idx = haystackLower.indexOf(tag, start);
    if (idx === -1) continue;
    if (bestIndex === -1 || idx < bestIndex) {
      bestIndex = idx;
      bestTag = tag;
    }
  }

  if (bestIndex === -1) return null;
  return { index: bestIndex, tag: bestTag };
}

function findTagCarry(input) {
  const maxLen = Math.min(MAX_TAG_LEN - 1, input.length);
  for (let len = maxLen; len > 0; len--) {
    const suffix = input.slice(-len).toLowerCase();
    if (THINK_ALL_TAGS.some(tag => tag.startsWith(suffix))) {
      return input.slice(-len);
    }
  }
  return "";
}

/**
 * Split text into visible content and hidden reasoning using <think>/<thinking> tags.
 * Works across chunk boundaries by carrying partial tags in state.thinkTagCarry.
 */
export function splitThinkTaggedContent(chunk, state) {
  if (!state || typeof state !== "object") {
    throw new TypeError("splitThinkTaggedContent requires a state object");
  }

  if (typeof chunk !== "string" || chunk.length === 0) {
    return { content: "", reasoning: "" };
  }

  let input = `${state.thinkTagCarry || ""}${chunk}`;
  state.thinkTagCarry = "";

  const tailCarry = findTagCarry(input);
  if (tailCarry) {
    input = input.slice(0, -tailCarry.length);
    state.thinkTagCarry = tailCarry;
  }

  const inputLower = input.toLowerCase();
  let cursor = 0;
  let content = "";
  let reasoning = "";

  while (cursor < input.length) {
    if (state.inThinking) {
      const closeTag = findNextTag(inputLower, cursor, THINK_CLOSE_TAGS);
      if (!closeTag) {
        reasoning += input.slice(cursor);
        break;
      }
      reasoning += input.slice(cursor, closeTag.index);
      cursor = closeTag.index + closeTag.tag.length;
      state.inThinking = false;
      continue;
    }

    const openTag = findNextTag(inputLower, cursor, THINK_OPEN_TAGS);
    const closeTag = findNextTag(inputLower, cursor, THINK_CLOSE_TAGS);

    if (!openTag && !closeTag) {
      content += input.slice(cursor);
      break;
    }

    let nextTag = openTag;
    let isClosing = false;
    if (closeTag && (!nextTag || closeTag.index < nextTag.index)) {
      nextTag = closeTag;
      isClosing = true;
    }

    content += input.slice(cursor, nextTag.index);
    cursor = nextTag.index + nextTag.tag.length;

    if (!isClosing) {
      state.inThinking = true;
    }
  }

  return { content, reasoning };
}

export function shouldSplitThinkTags(provider, model) {
  const normalized = `${provider || ""}/${model || ""}`.toLowerCase();
  return /qwen|kimi|deepseek|glm|minimax|mimo/.test(normalized);
}
