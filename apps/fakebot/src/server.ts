import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseTelegramHtml } from './html.js';

/**
 * A local stand-in for the Telegram Bot API (D-039): `sendMessage`, `sendPhoto` and `getMe`, the same answers as
 * Telegram (ok, 429 with retry_after, 403 "bot was blocked by the user", 400 for bad HTML), and a
 * page that shows every message "sent". For development, the demo and tests only: it never talks
 * to Telegram, and it is never deployed.
 */
/** S6-3b: a message prepared for the person to share (savePreparedInlineMessage). */
export type PreparedMessage = {
  id: string;
  user_id: number;
  result: Record<string, unknown>;
  /** The text the chat will show (tags removed). */
  plain: string;
  date: number;
};

export type SentMessage = {
  message_id: number;
  chat_id: string;
  text: string;
  /** The text a person would see (entities decoded, tags removed). */
  plain: string;
  parse_mode: string | null;
  reply_markup: unknown;
  /** sendPhoto: the photo's address; null for a text message. */
  photo: string | null;
  date: number;
};

export type Failure = { status: 429 | 403 | 400 | 500; retryAfter?: number; description?: string };

/** What setWebhook stored (BE-07). Telegram never shows the secret back; the stand-in tells tests. */
export type Webhook = { url: string; secret: string | null; allowed_updates: string[] | null };

export type FakeTelegram = {
  url: string;
  messages: SentMessage[];
  /** The address the app registered with setWebhook, or null. */
  readonly webhook: Webhook | null;
  /** Delivers an update to the webhook like Telegram: the app's HTTP status, or null without one. */
  sendUpdate(update: Record<string, unknown>): Promise<number | null>;
  /** The person in this private chat presses Start (optionally from a link: /start <payload>). */
  pressStart(chatId: number, payload?: string): Promise<number | null>;
  /** The person forwards a message with this text to the bot (S6-2: a recipe → a draft). */
  forwardText(chatId: number, text: string): Promise<number | null>;
  /** The person blocks the bot: my_chat_member "kicked", and messages to them get 403. */
  blockBot(chatId: number): Promise<number | null>;
  unblockBot(chatId: number): Promise<number | null>;
  /** Number of sendMessage calls, including refused ones. */
  calls: number;
  /** The next `count` sendMessage calls fail like this (any chat). */
  failNext(count: number, failure: Failure): void;
  /** Every message to this chat gets 403, like a user who blocked the bot. */
  blockChat(chatId: string | number): void;
  /** Messages prepared for sharing (S6-3b), oldest first. */
  prepared: PreparedMessage[];
  /** Forgets messages, failures, blocks and the webhook. */
  clear(): void;
  close(): Promise<void>;
};

/** Dev users 1-3 of the demo (apps/web mock, db/seeds/dev.sql): same names and languages. */
const DEMO_PEOPLE: Record<number, { first_name: string; username: string; language_code: string }> =
  {
    100000001: { first_name: 'Dev Keeper', username: 'dev_keeper', language_code: 'ru' },
    100000002: { first_name: 'Dev Member', username: 'dev_member', language_code: 'en' },
    100000003: { first_name: 'Ny Användare', username: 'dev_new', language_code: 'sv' },
  };
const person = (id: number) => ({
  id,
  is_bot: false,
  ...(DEMO_PEOPLE[id] ?? { first_name: `User ${id}`, language_code: 'en' }),
});
const BOT_USER = { id: 1, is_bot: true, first_name: 'Cookbook (local stand-in)' };

/** The stand-in delivers only to this computer (or a one-word Docker host), like the app's rule. */
function localHook(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const h = url.hostname;
  const ok =
    h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || /^[a-z][a-z0-9-]{0,62}$/.test(h);
  return ok ? raw : null;
}

export type Options = {
  port?: number;
  host?: string;
  token?: string;
  /**
   * The demo's web app (e.g. http://localhost:5173). A message button that would open the Mini App
   * (t.me/<bot>/<app>?startapp=…) then also links to the same place in the demo.
   */
  appUrl?: string;
};

const DESCRIPTIONS: Record<Failure['status'], string> = {
  429: 'Too Many Requests: retry after',
  403: 'Forbidden: bot was blocked by the user',
  400: 'Bad Request',
  500: 'Internal Server Error',
};

export async function startFakeTelegram(opts: Options = {}): Promise<FakeTelegram> {
  const messages: SentMessage[] = [];
  const prepared: PreparedMessage[] = [];
  const queue: Failure[] = [];
  const blocked = new Set<string>();
  let calls = 0;
  let nextId = 1;
  let webhook: Webhook | null = null;
  // Telegram's update ids only grow, and the API ignores one it has already seen, so a restarted
  // stand-in must not start again from 1: it starts from the clock (a safe integer, ~1.8e15).
  let nextUpdateId = Date.now() * 1000;
  let lastDelivery: { date: number; status: number | null; error: string | null } | null = null;

  async function sendUpdate(update: Record<string, unknown>): Promise<number | null> {
    if (!webhook) return null;
    const body = { update_id: nextUpdateId++, ...update };
    const date = Math.floor(Date.now() / 1000);
    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(webhook.secret ? { 'x-telegram-bot-api-secret-token': webhook.secret } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      await res.arrayBuffer();
      lastDelivery = {
        date,
        status: res.status,
        error: res.ok ? null : `Wrong response from the webhook: ${res.status}`,
      };
      return res.status;
    } catch (err) {
      lastDelivery = { date, status: 0, error: `Connection failed: ${String(err)}` };
      return 0;
    }
  }
  const pressStart = (chatId: number, payload?: string) =>
    sendUpdate({
      message: {
        message_id: nextId++,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private', first_name: person(chatId).first_name },
        from: person(chatId),
        text: payload ? `/start ${payload}` : '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
      },
    });
  const forwardText = (chatId: number, text: string) =>
    sendUpdate({
      message: {
        message_id: nextId++,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private', first_name: person(chatId).first_name },
        from: person(chatId),
        // A forward from someone whose account is hidden: the commonest kind in family chats.
        forward_origin: {
          type: 'hidden_user',
          sender_user_name: 'Бабушка',
          date: Math.floor(Date.now() / 1000) - 86_400,
        },
        text,
      },
    });
  const memberChange = (chatId: number, status: 'kicked' | 'member') =>
    sendUpdate({
      my_chat_member: {
        chat: { id: chatId, type: 'private', first_name: person(chatId).first_name },
        from: person(chatId),
        date: Math.floor(Date.now() / 1000),
        old_chat_member: { status: status === 'kicked' ? 'member' : 'kicked', user: BOT_USER },
        new_chat_member: { status, user: BOT_USER },
      },
    });
  const blockBot = (chatId: number) => {
    blocked.add(String(chatId));
    return memberChange(chatId, 'kicked');
  };
  const unblockBot = (chatId: number) => {
    blocked.delete(String(chatId));
    return memberChange(chatId, 'member');
  };

  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const fail = (res: ServerResponse, f: Failure) => {
    const description =
      f.description ??
      (f.status === 429 ? `${DESCRIPTIONS[429]} ${f.retryAfter ?? 1}` : DESCRIPTIONS[f.status]);
    reply(res, f.status, {
      ok: false,
      error_code: f.status,
      description,
      ...(f.status === 429 ? { parameters: { retry_after: f.retryAfter ?? 1 } } : {}),
    });
  };

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 256 * 1024) throw new Error('body too large');
      chunks.push(c as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }

  /** Bot API 8.0: an inline result the person can send with WebApp.shareMessage (PRD 4.7). */
  async function prepare(req: IncomingMessage, res: ServerResponse) {
    calls++;
    const body = await readJson(req);
    const queued = queue.shift();
    if (queued) return fail(res, queued);
    const userId = Number(body.user_id);
    const result = body.result as Record<string, unknown> | undefined;
    const chats = [
      'allow_user_chats',
      'allow_bot_chats',
      'allow_group_chats',
      'allow_channel_chats',
    ];
    if (!Number.isSafeInteger(userId) || userId <= 0)
      return fail(res, { status: 400, description: 'Bad Request: user_id is required' });
    if (
      typeof result !== 'object' ||
      result === null ||
      !['article', 'photo'].includes(String(result.type)) ||
      typeof result.id !== 'string'
    )
      return fail(res, { status: 400, description: 'Bad Request: RESULT_INVALID' });
    if (!chats.some((k) => body[k] === true))
      return fail(res, { status: 400, description: 'Bad Request: no chat types allowed' });
    const content = (result.input_message_content ?? {}) as Record<string, unknown>;
    const text = String((result.type === 'photo' ? result.caption : content.message_text) ?? '');
    const mode = result.type === 'photo' ? result.parse_mode : content.parse_mode;
    if (result.type === 'photo' && !/^https?:\/\/\S+$/.test(String(result.photo_url ?? '')))
      return fail(res, { status: 400, description: 'Bad Request: photo_url' });
    let plain = text;
    if (mode === 'HTML') {
      const parsed = parseTelegramHtml(text);
      if (!parsed.ok) return fail(res, { status: 400, description: parsed.description });
      plain = parsed.plain;
    }
    const id = `prepared-${prepared.length + 1}`;
    const date = Math.floor(Date.now() / 1000);
    prepared.push({ id, user_id: userId, result, plain, date });
    reply(res, 200, { ok: true, result: { id, expiration_date: date + 86_400 } });
  }

  async function botMethod(
    req: IncomingMessage,
    res: ServerResponse,
    token: string,
    method: string,
  ) {
    if (opts.token && token !== opts.token)
      return reply(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
    if (method === 'getMe')
      return reply(res, 200, {
        ok: true,
        result: {
          id: 1,
          is_bot: true,
          first_name: 'Cookbook (local stand-in)',
          username: 'local_stand_in_bot',
        },
      });
    if (method === 'setWebhook') {
      const body = await readJson(req);
      if (body.url === '') {
        webhook = null;
        return reply(res, 200, { ok: true, result: true, description: 'Webhook was deleted' });
      }
      const url = localHook(body.url);
      if (!url)
        return fail(res, {
          status: 400,
          description: 'Bad Request: bad webhook: the stand-in delivers only to this computer',
        });
      webhook = {
        url,
        secret: typeof body.secret_token === 'string' ? body.secret_token : null,
        allowed_updates: Array.isArray(body.allowed_updates)
          ? body.allowed_updates.map(String)
          : null,
      };
      return reply(res, 200, { ok: true, result: true, description: 'Webhook was set' });
    }
    if (method === 'getWebhookInfo')
      return reply(res, 200, {
        ok: true,
        result: {
          url: webhook?.url ?? '',
          has_custom_certificate: false,
          pending_update_count: 0,
          ...(webhook?.allowed_updates ? { allowed_updates: webhook.allowed_updates } : {}),
          ...(lastDelivery?.error
            ? { last_error_date: lastDelivery.date, last_error_message: lastDelivery.error }
            : {}),
        },
      });
    if (method === 'deleteWebhook') {
      webhook = null;
      return reply(res, 200, { ok: true, result: true, description: 'Webhook was deleted' });
    }
    if (method === 'savePreparedInlineMessage') return prepare(req, res);
    if (method !== 'sendMessage' && method !== 'sendPhoto')
      return reply(res, 404, {
        ok: false,
        error_code: 404,
        description: 'Not Found: method not found',
      });
    calls++;
    const body = await readJson(req);
    const isPhoto = method === 'sendPhoto';
    const chatId = String(body.chat_id ?? '');
    // A photo's text is its caption (optional, at most 1024 characters); a message's is required.
    const textField = isPhoto ? body.caption : body.text;
    const text = typeof textField === 'string' ? textField : '';
    const photo = isPhoto && typeof body.photo === 'string' ? body.photo : null;
    const queued = queue.shift();
    if (queued) return fail(res, queued);
    if (blocked.has(chatId)) return fail(res, { status: 403 });
    if (!chatId || (!isPhoto && !text))
      return fail(res, { status: 400, description: 'Bad Request: chat_id and text are required' });
    // The stand-in takes a photo by address only (the worker sends it that way).
    if (isPhoto && !/^https?:\/\/\S+$/.test(photo ?? ''))
      return fail(res, {
        status: 400,
        description: 'Bad Request: wrong file identifier/HTTP URL specified',
      });
    const parseMode = typeof body.parse_mode === 'string' ? body.parse_mode : null;
    let plain = text;
    if (parseMode === 'HTML' && text) {
      const parsed = parseTelegramHtml(text);
      if (!parsed.ok) return fail(res, { status: 400, description: parsed.description });
      plain = parsed.plain;
    } else if ([...text].length > 4096) {
      return fail(res, { status: 400, description: 'Bad Request: message is too long' });
    }
    if (isPhoto && [...plain].length > 1024)
      return fail(res, { status: 400, description: 'Bad Request: message caption is too long' });
    const msg: SentMessage = {
      message_id: nextId++,
      chat_id: chatId,
      text,
      plain,
      parse_mode: parseMode,
      reply_markup: body.reply_markup ?? null,
      photo,
      date: Math.floor(Date.now() / 1000),
    };
    messages.push(msg);
    reply(res, 200, {
      ok: true,
      result: {
        message_id: msg.message_id,
        chat: { id: Number(chatId) },
        date: msg.date,
        ...(isPhoto
          ? { caption: plain, photo: [{ file_id: `stand-in-${msg.message_id}` }] }
          : { text: plain }),
      },
    });
  }

  async function control(req: IncomingMessage, res: ServerResponse) {
    const body = await readJson(req);
    const f = body.failNext as ({ count?: number } & Partial<Failure>) | undefined;
    if (f?.status)
      for (let i = 0; i < (f.count ?? 1); i++)
        queue.push({ status: f.status, retryAfter: f.retryAfter, description: f.description });
    if (body.block !== undefined) blocked.add(String(body.block));
    if (body.unblock !== undefined) blocked.delete(String(body.unblock));
    if (body.clear) messages.length = 0;
    reply(res, 200, { ok: true, queued: queue.length, blocked: [...blocked] });
  }

  async function pageAction(req: IncomingMessage, res: ServerResponse, action: string) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    // A forwarded recipe may be long (Telegram allows 4096 characters, up to 6x when form-encoded).
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8').slice(0, 65_536));
    const chat = Number(form.get('chat'));
    const payload = (form.get('payload') ?? '').trim();
    if (!Number.isSafeInteger(chat) || chat <= 0 || !/^[A-Za-z0-9_-]{0,64}$/.test(payload))
      return reply(res, 400, { ok: false, description: 'Bad Request: chat or payload' });
    if (action === 'forward') await forwardText(chat, form.get('text') ?? '');
    else if (action === 'start') await pressStart(chat, payload || undefined);
    else if (action === 'block') await blockBot(chat);
    else await unblockBot(chat);
    res.writeHead(303, { location: '/' });
    res.end();
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(url.pathname);
    const done = (err: unknown) =>
      reply(res, 400, { ok: false, error_code: 400, description: `Bad Request: ${String(err)}` });
    if (m && req.method === 'POST') return void botMethod(req, res, m[1]!, m[2]!).catch(done);
    if (url.pathname === '/__control' && req.method === 'POST')
      return void control(req, res).catch(done);
    if (url.pathname === '/__messages') return reply(res, 200, { messages });
    // The page's buttons (BE-07): press /start, block or unblock the bot, as a demo user.
    const action = {
      '/__start': 'start',
      '/__block': 'block',
      '/__unblock': 'unblock',
      '/__forward': 'forward',
    }[url.pathname];
    if (action && req.method === 'POST') return void pageAction(req, res, action).catch(done);
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return void res.end(page(messages, opts.appUrl, webhook, lastDelivery, blocked, prepared));
    }
    reply(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
  });

  await new Promise<void>((resolve) =>
    server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', resolve),
  );
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${opts.host ?? '127.0.0.1'}:${port}`,
    messages,
    get calls() {
      return calls;
    },
    get webhook() {
      return webhook ? { ...webhook } : null;
    },
    sendUpdate,
    pressStart,
    forwardText,
    blockBot,
    unblockBot,
    failNext(count, failure) {
      for (let i = 0; i < count; i++) queue.push(failure);
    },
    blockChat(chatId) {
      blocked.add(String(chatId));
    },
    prepared,
    clear() {
      messages.length = 0;
      prepared.length = 0;
      queue.length = 0;
      blocked.clear();
      calls = 0;
      webhook = null;
      lastDelivery = null;
    },
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Dev users 1-3 of the demo (apps/web mock) have Telegram ids 100000001-100000003. */
function demoLink(appUrl: string | undefined, buttonUrl: string, chatId: string): string | null {
  if (!appUrl) return null;
  let start: string | null;
  try {
    start = new URL(buttonUrl).searchParams.get('startapp');
  } catch {
    return null;
  }
  if (!start || !/^[A-Za-z0-9_-]{1,64}$/.test(start)) return null;
  const n = Number(chatId) - 100000000;
  const user = n >= 1 && n <= 3 ? `devUser=${n}&` : '';
  return `${appUrl.replace(/\/+$/, '')}/?${user}startapp=${start}`;
}

function buttons(markup: unknown, chatId: string, appUrl: string | undefined): string {
  const rows = (
    markup as { inline_keyboard?: Array<Array<{ text?: string; url?: string }>> } | null
  )?.inline_keyboard;
  if (!Array.isArray(rows)) return '';
  return rows
    .flat()
    .map((b) => {
      const local = demoLink(appUrl, b.url ?? '', chatId);
      return local
        ? `<a class="btn" href="${esc(local)}" target="_blank" title="${esc(b.url ?? '')}">${esc(b.text ?? '')}</a>`
        : `<span class="btn" title="${esc(b.url ?? '')}">${esc(b.text ?? '')}</span>`;
    })
    .join(' ');
}

/** The chat side (BE-07): press /start (also with an invite) or block the bot, as a demo user. */
function chatPanel(
  webhook: Webhook | null,
  last: { date: number; status: number | null; error: string | null } | null,
  blocked: Set<string>,
): string {
  if (!webhook)
    return '<p class="note">Бот пока не получает сообщения: адрес не задан (демо задаёт его при запуске).</p>';
  const options = Object.entries(DEMO_PEOPLE)
    .map(([id, p]) => `<option value="${id}">${esc(p.first_name)} (${id})</option>`)
    .join('');
  const state = last
    ? last.error
      ? `<p class="note bad">Последняя доставка: ${esc(last.error)}</p>`
      : `<p class="note">Последняя доставка: ответ приложения ${last.status}.</p>`
    : '';
  const blockedNote = blocked.size
    ? `<p class="note">Заблокировали бота: ${[...blocked].map(esc).join(', ')}</p>`
    : '';
  return `<section><h2>Написать боту</h2>
<form method="post" action="/__start"><select name="chat">${options}</select>
<input name="payload" placeholder="join_… (код приглашения, можно пусто)" maxlength="64" pattern="[A-Za-z0-9_-]*">
<button>Нажать /start</button></form>
<form method="post" action="/__block"><select name="chat">${options}</select><button>Заблокировать бота</button></form>
<form method="post" action="/__unblock"><select name="chat">${options}</select><button>Разблокировать</button></form>
<form method="post" action="/__forward" class="forward"><select name="chat">${options}</select>
<textarea name="text" rows="5" placeholder="Текст рецепта: название, ингредиенты, шаги" aria-label="Текст рецепта"></textarea>
<button>Переслать боту</button></form>
${state}${blockedNote}</section>`;
}

/** What a person would see in Telegram, newest first. Everything is escaped: nothing here runs. */
function page(
  messages: SentMessage[],
  appUrl: string | undefined,
  webhook: Webhook | null,
  last: { date: number; status: number | null; error: string | null } | null,
  blocked: Set<string>,
  prepared: PreparedMessage[] = [],
): string {
  // Who opens a shared recipe: shown as dev user 3, who is not in the demo book (a guest).
  const shared = [...prepared]
    .reverse()
    .slice(0, 5)
    .map((p) => {
      const r = p.result as { photo_url?: string; reply_markup?: unknown };
      return `<li><div class="meta">${esc(p.id)} · от ${esc(String(p.user_id))}</div>${r.photo_url ? `<img class="photo" src="${esc(r.photo_url)}" alt="">` : ''}<div class="text">${esc(p.plain)}</div>${buttons(r.reply_markup, '100000003', appUrl)}</li>`;
    })
    .join('');
  const items = [...messages]
    .reverse()
    .map(
      (m) =>
        `<li><div class="meta">#${m.message_id} · chat ${esc(m.chat_id)} · ${new Date(
          m.date * 1000,
        ).toLocaleTimeString(
          'ru-RU',
        )}</div>${m.photo ? `<img class="photo" src="${esc(m.photo)}" alt="">` : ''}<div class="text">${esc(m.plain)}</div>${buttons(m.reply_markup, m.chat_id, appUrl)}</li>`,
    )
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Сообщения бота (локальная имитация)</title>
<style>body{font:16px system-ui,sans-serif;margin:0;padding:16px;background:#f2f2f7;color:#111}h1{font-size:20px}h2{font-size:17px;margin:0 0 8px}
ul{list-style:none;padding:0;max-width:560px}li,section{background:#fff;border-radius:12px;padding:12px;margin:0 0 10px;max-width:536px}
form{margin:0 0 8px;display:flex;flex-wrap:wrap;gap:6px}input,select,button,textarea{font:inherit;padding:4px 8px}textarea{flex:1 1 100%}.note{color:#555;font-size:14px;margin:4px 0}.bad{color:#b00020}
.photo{max-width:100%;border-radius:8px;margin-bottom:6px}.meta{color:#888;font-size:13px;margin-bottom:6px}.text{white-space:pre-wrap}.btn{display:inline-block;margin-top:8px;padding:6px 12px;border-radius:8px;background:#e8f0fe;color:#1a73e8;text-decoration:none}</style>
</head><body><h1>Сообщения бота</h1><p>Локальная имитация Telegram: эти сообщения никуда не отправлены. Страница обновляется сама.</p>
${chatPanel(webhook, last, blocked)}
${shared ? `<section><h2>Поделились рецептом</h2><p class="note">Так сообщение выглядит в чате у того, кому его переслали. Кнопка открывает рецепт как пользователь 3 (он не в книге).</p><ul>${shared}</ul></section>` : ''}
${items ? `<ul>${items}</ul>` : '<p><b>Пока сообщений нет.</b> Запустите таймер в режиме готовки или нажмите /start выше.</p>'}
<script>setInterval(function(){var a=document.activeElement;if(!a||a===document.body)location.reload()},3000)</script></body></html>`;
}
