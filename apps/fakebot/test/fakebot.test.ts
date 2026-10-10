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

/**
 * BE-07 (Sprint 5): the stand-in also plays Telegram's side of the webhook, so /start and
 * "blocked the bot" can be tried in the demo and tested without Telegram.
 */
describe('the stand-in as the sender of updates (webhook)', () => {
  let bot: FakeTelegram;
  let received: Array<{ secret: string | undefined; body: Record<string, unknown> }>;
  let hook: import('node:http').Server;
  let hookUrl: string;
  let answer = 200;

  beforeAll(async () => {
    const { createServer } = await import('node:http');
    hook = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push({
          secret: req.headers['x-telegram-bot-api-secret-token'] as string | undefined,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        });
        res.writeHead(answer).end('{}');
      });
    });
    await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
    hookUrl = `http://127.0.0.1:${(hook.address() as import('node:net').AddressInfo).port}/bot/webhook`;
    bot = await startFakeTelegram({ token: '123:fake' });
  });
  afterAll(async () => {
    await bot.close();
    await new Promise((r) => hook.close(r));
  });
  beforeEach(() => {
    bot.clear();
    received = [];
    answer = 200;
  });

  const call = async (method: string, body: object = {}) =>
    (await (
      await fetch(`${bot.url}/bot123:fake/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json()) as { ok: boolean; result?: Record<string, unknown>; description?: string };

  it('takes setWebhook, shows it in getWebhookInfo without the secret, and forgets it on deleteWebhook', async () => {
    expect(
      await call('setWebhook', {
        url: hookUrl,
        secret_token: 'local-secret-0123456789',
        allowed_updates: ['message', 'my_chat_member'],
      }),
    ).toMatchObject({ ok: true, result: true });
    expect(bot.webhook).toEqual({
      url: hookUrl,
      secret: 'local-secret-0123456789',
      allowed_updates: ['message', 'my_chat_member'],
    });
    const info = await call('getWebhookInfo');
    expect(info.result).toMatchObject({ url: hookUrl, pending_update_count: 0 });
    expect(JSON.stringify(info)).not.toContain('local-secret');
    expect(await call('deleteWebhook')).toMatchObject({ ok: true, result: true });
    expect(bot.webhook).toBeNull();
    expect((await call('getWebhookInfo')).result).toMatchObject({ url: '' });
  });

  it('delivers updates only to this computer', async () => {
    for (const url of ['https://example.com/hook', 'http://10.0.0.5/hook', 'not a url']) {
      expect(await call('setWebhook', { url }), url).toMatchObject({ ok: false });
    }
    expect(bot.webhook).toBeNull();
  });

  it('presses /start for a chat (with an invite), with the secret and a new update_id each time', async () => {
    await call('setWebhook', { url: hookUrl, secret_token: 'local-secret-0123456789' });
    expect(await bot.pressStart(100000002, 'join_Ab3dE5')).toBe(200);
    expect(await bot.pressStart(100000001)).toBe(200);
    expect(received).toHaveLength(2);
    expect(received[0]!.secret).toBe('local-secret-0123456789');
    const [a, b] = received.map((r) => r.body);
    expect(a).toMatchObject({
      message: {
        chat: { id: 100000002, type: 'private' },
        from: { id: 100000002, is_bot: false, first_name: 'Dev Member', language_code: 'en' },
        text: '/start join_Ab3dE5',
      },
    });
    expect(b).toMatchObject({ message: { text: '/start', from: { first_name: 'Dev Keeper' } } });
    expect(b!.update_id).toBe((a!.update_id as number) + 1);
  });

  it('a restarted stand-in numbers its updates above the earlier ones (found by the browser tests)', async () => {
    // Telegram's update ids only grow, and the API ignores one it has seen. A stand-in that
    // started again from 1 had its /start and block presses ignored after every demo restart.
    await call('setWebhook', { url: hookUrl, secret_token: 'local-secret-0123456789' });
    await bot.pressStart(100000001);
    const before = received[0]!.body!.update_id as number;
    const again = await startFakeTelegram({ token: '123:fake' });
    try {
      await fetch(`${again.url}/bot123:fake/setWebhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: hookUrl, secret_token: 'local-secret-0123456789' }),
      });
      await again.pressStart(100000001);
    } finally {
      await again.close();
    }
    const after = received[1]!.body!.update_id as number;
    expect(after).toBeGreaterThan(before);
    expect(Number.isSafeInteger(after)).toBe(true);
  });

  it('blocking the bot sends my_chat_member and refuses messages (403); unblocking undoes both', async () => {
    await call('setWebhook', { url: hookUrl, secret_token: 'local-secret-0123456789' });
    await bot.blockBot(100000003);
    expect(received[0]!.body).toMatchObject({
      my_chat_member: {
        chat: { id: 100000003, type: 'private' },
        new_chat_member: { status: 'kicked' },
      },
    });
    const refused = await fetch(`${bot.url}/bot123:fake/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: 100000003, text: 'hi' }),
    });
    expect(refused.status).toBe(403);
    await bot.unblockBot(100000003);
    expect(received[1]!.body).toMatchObject({
      my_chat_member: { new_chat_member: { status: 'member' } },
    });
  });

  it('reports what the app answered, and nothing when no webhook is set', async () => {
    expect(await bot.pressStart(100000001)).toBeNull();
    await call('setWebhook', { url: hookUrl, secret_token: 'local-secret-0123456789' });
    answer = 401;
    expect(await bot.pressStart(100000001)).toBe(401);
  });

  it('the page has buttons for /start and blocking, which post and come back', async () => {
    await call('setWebhook', { url: hookUrl, secret_token: 'local-secret-0123456789' });
    const page = await (await fetch(`${bot.url}/`)).text();
    expect(page).toContain('action="/__start"');
    expect(page).toContain('action="/__block"');
    const res = await fetch(`${bot.url}/__start`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'chat=100000002&payload=join_Ab3dE5',
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    expect(received[0]!.body).toMatchObject({ message: { text: '/start join_Ab3dE5' } });
  });

  it('forwards a recipe text to the bot, as Telegram does (S6-2)', async () => {
    await call('setWebhook', { url: hookUrl, secret_token: 'local-secret-0123456789' });
    expect(await bot.forwardText(100000002, 'Сырники\nТворог — 500 г')).toBe(200);
    expect(received[0]!.secret).toBe('local-secret-0123456789');
    expect(received[0]!.body).toMatchObject({
      message: {
        chat: { id: 100000002, type: 'private' },
        from: { id: 100000002, is_bot: false, first_name: 'Dev Member' },
        text: 'Сырники\nТворог — 500 г',
        forward_origin: { type: 'hidden_user' },
      },
    });
  });

  it('the page has a form to forward a recipe text, also a long one in Cyrillic', async () => {
    await call('setWebhook', { url: hookUrl, secret_token: 'local-secret-0123456789' });
    const page = await (await fetch(`${bot.url}/`)).text();
    expect(page).toContain('action="/__forward"');
    const long = `Шарлотка\n${'Яблоки — 4 шт.\n'.repeat(200)}`;
    const res = await fetch(`${bot.url}/__forward`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ chat: '100000001', text: long }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    expect((received[0]!.body as { message: { text: string } }).message.text).toBe(long);
  });
});

/** BE-10 (Sprint 5): the "I cooked it" message to the author is a photo with a caption. */
describe('sendPhoto', () => {
  let bot: FakeTelegram;
  beforeAll(async () => {
    bot = await startFakeTelegram({ token: '123:fake' });
  });
  afterAll(() => bot.close());
  beforeEach(() => bot.clear());
  const photo = (body: object) =>
    fetch(`${bot.url}/bot123:fake/sendPhoto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('records the photo address and the caption like a message', async () => {
    const res = await photo({
      chat_id: 7,
      photo: 'http://127.0.0.1:8333/b/media/x/full.jpg?sig',
      caption: '<b>Лена</b> приготовила',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Open', url: 'https://t.me/b/a?startapp=rc_x' }]],
      },
    });
    expect(res.status).toBe(200);
    expect(bot.messages).toEqual([
      expect.objectContaining({
        chat_id: '7',
        photo: 'http://127.0.0.1:8333/b/media/x/full.jpg?sig',
        plain: 'Лена приготовила',
      }),
    ]);
  });

  it('refuses what Telegram refuses: no usable photo address (400), a caption over 1024 (400)', async () => {
    expect((await photo({ chat_id: 7, photo: 'not-a-url', caption: 'x' })).status).toBe(400);
    expect(
      (await photo({ chat_id: 7, photo: 'http://h/p.jpg', caption: 'я'.repeat(1025) })).status,
    ).toBe(400);
    expect(bot.messages).toEqual([]);
  });

  it('a blocked chat gets 403, and queued failures apply', async () => {
    bot.blockChat(8);
    expect((await photo({ chat_id: 8, photo: 'http://h/p.jpg' })).status).toBe(403);
    bot.failNext(1, { status: 429, retryAfter: 2 });
    expect((await photo({ chat_id: 7, photo: 'http://h/p.jpg' })).status).toBe(429);
  });

  it('a text message has no photo', async () => {
    await fetch(`${bot.url}/bot123:fake/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: 7, text: 'hi' }),
    });
    expect(bot.messages[0]).toMatchObject({ photo: null });
  });
});
