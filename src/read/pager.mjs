import { codePoints } from '../context/budget.mjs';

/**
 * Split stored text by codepoints. Byte spans stay UTF-8; page offsets are
 * codepoints, and both fields are never mixed in one number.
 */
export function pageText(text, { path = 'text', offset = 0, maxChars = 8000 } = {}) {
  const points = Array.from(String(text));
  const total = points.length;
  const start = Math.min(Math.max(0, offset), total);
  const end = Math.min(total, start + Math.max(1, maxChars));
  return {
    path,
    offset: start,
    total_chars: total,
    text: points.slice(start, end).join(''),
    fragment_complete: end >= total,
  };
}

export function nextPageOffset(fragment) {
  if (!fragment || fragment.fragment_complete) return null;
  return fragment.offset + codePoints(fragment.text);
}
