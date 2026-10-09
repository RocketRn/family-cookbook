import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseTelegramHtml, startFakeTelegram, type FakeTelegram } from '../src/index.js';

describe('HTML parse mode, checked like the Bot API', () => {
  it('accepts escaped text and the documented tags', () => {
    expect(parseTelegramHtml('<b>Готово</b> &lt;b&gt; &amp; &quot;x&quot; &#9200;')).toEqual({
      ok: true,
      plain: 'Готово <b> & "x" ⏰',
    });
    expect(parseTelegramHtml('<a href="https://t.me/x">open</a>')).toMatchObject({ ok: true });
  });

  it.each([
    ['a raw <', 'Пирог <script>'],
    ['a raw &', 'соль & перец'],
    ['a raw >', 'a > b'],
    ['an unknown tag', '<img src=x>'],
    ['an unclosed tag', '<b>жирный'],
    ['a wrong end tag', '<b>x</i>'],
  ])('refuses %s', (_why, text) => {
    expect(parseTelegramHtml(text)).toMatchObject({ ok: false });
  });

  it('refuses a text over 4096 characters after decoding', () => {
    expect(parseTelegramHtml('я'.repeat(4096))).toMatchObject({ ok: true });
    expect(parseTelegramHtml('я'.repeat(4097))).toEqual({
      ok: false,
      description: 'Bad Request: message is too long',
    });
  });
});

describe('the stand-in server', () => {
  let bot: FakeTelegram;
  beforeAll(async () => {
    bot = await startFakeTelegram({ token: '123:fake' });
  });
  afterAll(() => bot.close());
  beforeEach(() => bot.clear());

  const send = (body: object, token = '123:fake') =>
    fetch(`${bot.url}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('records a message and answers like Telegram', async () => {
    const res = await send({ chat_id: 42, text: '<b>Hi</b>', parse_mode: 'HTML' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      result: { message_id: 1, chat: { id: 42 } },
    });
    expect(bot.messages).toEqual([expect.objectContaining({ chat_id: '42', plain: 'Hi' })]);
    const page = await (await fetch(bot.url)).text();
    expect(page).toContain('Hi');
  });

  it('refuses a wrong token, bad HTML, and simulates 429 and 403', async () => {
    expect((await send({ chat_id: 1, text: 'x' }, '999:other')).status).toBe(401);
    const bad = await send({ chat_id: 1, text: 'a & b', parse_mode: 'HTML' });
    expect(bad.status).toBe(400);
    bot.failNext(1, { status: 429, retryAfter: 7 });
    const limited = await send({ chat_id: 1, text: 'x' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error_code: 429, parameters: { retry_after: 7 } });
    bot.blockChat(5);
    expect((await send({ chat_id: 5, text: 'x' })).status).toBe(403);
    expect((await send({ chat_id: 6, text: 'x' })).status).toBe(200);
    expect(bot.calls).toBe(4);
  });

  it('can be controlled over HTTP (for the demo)', async () => {
    await fetch(`${bot.url}/__control`, {
      method: 'POST',
      body: JSON.stringify({ failNext: { status: 429, retryAfter: 3, count: 1 }, block: 77 }),
    });
    expect((await send({ chat_id: 1, text: 'x' })).status).toBe(429);
    expect((await send({ chat_id: 77, text: 'x' })).status).toBe(403);
  });

  it('in the demo, a message button opens the app at that step (a local link instead of t.me)', async () => {
    const demo = await startFakeTelegram({ appUrl: 'http://localhost:5173' });
    try {
      const post = (body: object) =>
        fetch(`${demo.url}/bot1:x/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const button = (url: string) => ({ inline_keyboard: [[{ text: 'Открыть шаг', url }]] });
      await post({
        chat_id: 100000002,
        text: 'a',
        reply_markup: button('https://t.me/bot/cook?startapp=cook_0123abcd_2'),
      });
      await post({
        chat_id: 1,
        text: 'b',
        reply_markup: button('https://t.me/bot/cook?startapp="><script>x</script>'),
      });
      const page = await (await fetch(demo.url)).text();
      expect(page).toContain(
        'href="http://localhost:5173/?devUser=2&amp;startapp=cook_0123abcd_2"',
      );
      expect(page).not.toContain('<script>x');
      expect(page.match(/<a /g)).toHaveLength(1); // the odd payload stays plain text
    } finally {
      await demo.close();
    }
  });

  it('the page escapes what it shows', async () => {
    await send({ chat_id: 1, text: '&lt;script&gt;alert(1)&lt;/script&gt;', parse_mode: 'HTML' });
    const page = await (await fetch(bot.url)).text();
    expect(page).not.toContain('<script>alert');
    expect(page).toContain('&lt;script&gt;alert(1)');
  });
});
