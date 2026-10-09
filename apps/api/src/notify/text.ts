/**
 * Text that goes into a bot message (D-039). User content (recipe titles, timer labels) is never
 * put into a message as it is: it is cleaned, cut on a character boundary, escaped for Telegram's
 * HTML parse mode, and isolated so right-to-left text cannot reorder the sentence around it.
 */

/** Telegram's HTML parse mode: these four are the only characters with a meaning. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

/**
 * Removes control characters and invisible direction controls (which can make text display
 * reversed, a known spoofing trick), keeps emoji and every script; all whitespace becomes single
 * spaces (titles and labels are one line).
 */
export function cleanText(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    const direction =
      c === 0x061c ||
      c === 0x200e ||
      c === 0x200f ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2066 && c <= 0x2069) ||
      c === 0xfeff;
    if (control) out += c === 0x09 || c === 0x0a || c === 0x0d ? ' ' : '';
    else if (!direction) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** At most `max` visible characters (grapheme clusters: an emoji family or a flag is one). */
export function truncate(s: string, max: number): string {
  const parts: string[] = [];
  for (const { segment } of segmenter.segment(s)) {
    parts.push(segment);
    if (parts.length > max) return parts.slice(0, max - 1).join('') + '…';
  }
  return s;
}

/** Unicode "first strong isolate": the text keeps its own direction without affecting the rest. */
export const isolate = (s: string): string => `\u2068${s}\u2069`;
