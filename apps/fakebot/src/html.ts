/**
 * Telegram's "HTML" parse mode, checked the way the Bot API does it: only the documented tags,
 * properly nested; every `<`, `>` and `&` that is not part of a tag or an entity must be escaped.
 * A message that breaks this is refused with 400 "can't parse entities", so a test that sends
 * unescaped user text through the stand-in fails just as it would against Telegram.
 * One pass over the text (linear time).
 */
const TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'span',
  'tg-spoiler',
  'tg-emoji',
  'a',
  'code',
  'pre',
  'blockquote',
]);
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };

/** Telegram's limit for a message text, counted after entities are decoded. */
export const MAX_TEXT = 4096;

export type Parsed = { ok: true; plain: string } | { ok: false; description: string };

export function parseTelegramHtml(text: string): Parsed {
  const stack: string[] = [];
  let plain = '';
  let i = 0;
  const bad = (why: string): Parsed => ({
    ok: false,
    description: `Bad Request: can't parse entities: ${why} at byte offset ${i}`,
  });
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '<') {
      const close = text.indexOf('>', i);
      if (close < 0) return bad('unclosed start tag');
      const inner = text.slice(i + 1, close);
      if (inner.startsWith('/')) {
        const name = inner.slice(1).trim().toLowerCase();
        if (stack.pop() !== name) return bad(`unmatched end tag "${name}"`);
      } else {
        const name = (/^[a-z-]+/i.exec(inner)?.[0] ?? '').toLowerCase();
        if (!TAGS.has(name)) return bad(`unsupported start tag "${name}"`);
        if (inner.includes('<')) return bad('unexpected "<" in a tag');
        stack.push(name);
      }
      i = close + 1;
    } else if (ch === '&') {
      const end = text.indexOf(';', i);
      const body = end > i && end - i <= 10 ? text.slice(i + 1, end) : null;
      let decoded: string | null = null;
      if (body !== null) {
        if (body in NAMED) decoded = NAMED[body]!;
        else if (/^#\d{1,7}$/.test(body)) decoded = String.fromCodePoint(Number(body.slice(1)));
        else if (/^#x[0-9a-f]{1,6}$/i.test(body))
          decoded = String.fromCodePoint(parseInt(body.slice(2), 16));
      }
      if (decoded === null) return bad('character "&" must be escaped as &amp;');
      plain += decoded;
      i = end + 1;
    } else if (ch === '>') {
      return bad('character ">" must be escaped as &gt;');
    } else {
      plain += ch;
      i++;
    }
  }
  if (stack.length) return bad(`unclosed tag "${stack[stack.length - 1]}"`);
  if ([...plain].length > MAX_TEXT)
    return { ok: false, description: 'Bad Request: message is too long' };
  return { ok: true, plain };
}
