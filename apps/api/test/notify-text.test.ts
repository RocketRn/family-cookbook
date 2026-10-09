import { describe, expect, it } from 'vitest';
import { cleanText, escapeHtml, isolate, truncate } from '../src/notify/text.js';

/** Bot message text from user content (D-039): escaped for HTML, cleaned, cut safely. */
describe('text for bot messages', () => {
  it('escapes everything HTML parse mode treats as markup', () => {
    expect(escapeHtml('<a href="x">&amp;</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;amp;&lt;/a&gt;',
    );
    expect(escapeHtml('*_[]()~`>#+-=|{}.!')).toBe('*_[]()~`&gt;#+-=|{}.!');
  });

  it('removes control characters and direction overrides, keeps emoji and real text', () => {
    expect(cleanText('Пирог\u0007\u001B[31m\r\n красный\t ')).toBe('Пирог[31m красный');
    expect(cleanText('Пирог \u202Eйынтарбо\u202C текст \u2066x\u2069')).toBe(
      'Пирог йынтарбо текст x',
    );
    expect(cleanText('👨‍👩‍👧‍👦 ❤️ עוגה')).toBe('👨‍👩‍👧‍👦 ❤️ עוגה');
    expect(cleanText('\u200F\u200E')).toBe('');
  });

  it('cuts on a character boundary, never inside an emoji or a flag', () => {
    expect(truncate('Шарлотка', 20)).toBe('Шарлотка');
    expect(truncate('Шарлотка', 5)).toBe('Шарл…');
    expect(truncate('👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦', 2)).toBe('👨‍👩‍👧‍👦…');
    expect(truncate('🇸🇪🇺🇦🇸🇪', 2)).toBe('🇸🇪…');
  });

  it('isolates user text so right-to-left words cannot reorder the sentence around them', () => {
    expect(isolate('עוגת תפוחים')).toBe('\u2068עוגת תפוחים\u2069');
  });
});
