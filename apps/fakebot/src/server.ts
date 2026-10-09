import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseTelegramHtml } from './html.js';

/**
 * A local stand-in for the Telegram Bot API (D-039): `sendMessage` and `getMe`, the same answers as
 * Telegram (ok, 429 with retry_after, 403 "bot was blocked by the user", 400 for bad HTML), and a
 * page that shows every message "sent". For development, the demo and tests only: it never talks
 * to Telegram, and it is never deployed.
 */
export type SentMessage = {
  message_id: number;
  chat_id: string;
  text: string;
  /** The text a person would see (entities decoded, tags removed). */
  plain: string;
  parse_mode: string | null;
  reply_markup: unknown;
  date: number;
};

export type Failure = { status: 429 | 403 | 400 | 500; retryAfter?: number; description?: string };

export type FakeTelegram = {
  url: string;
  messages: SentMessage[];
  /** Number of sendMessage calls, including refused ones. */
  calls: number;
  /** The next `count` sendMessage calls fail like this (any chat). */
  failNext(count: number, failure: Failure): void;
  /** Every message to this chat gets 403, like a user who blocked the bot. */
  blockChat(chatId: string | number): void;
  clear(): void;
  close(): Promise<void>;
};

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
  const queue: Failure[] = [];
  const blocked = new Set<string>();
  let calls = 0;
  let nextId = 1;

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
    if (method !== 'sendMessage')
      return reply(res, 404, {
        ok: false,
        error_code: 404,
        description: 'Not Found: method not found',
      });
    calls++;
    const body = await readJson(req);
    const chatId = String(body.chat_id ?? '');
    const text = typeof body.text === 'string' ? body.text : '';
    const queued = queue.shift();
    if (queued) return fail(res, queued);
    if (blocked.has(chatId)) return fail(res, { status: 403 });
    if (!chatId || !text)
      return fail(res, { status: 400, description: 'Bad Request: chat_id and text are required' });
    const parseMode = typeof body.parse_mode === 'string' ? body.parse_mode : null;
    let plain = text;
    if (parseMode === 'HTML') {
      const parsed = parseTelegramHtml(text);
      if (!parsed.ok) return fail(res, { status: 400, description: parsed.description });
      plain = parsed.plain;
    } else if ([...text].length > 4096) {
      return fail(res, { status: 400, description: 'Bad Request: message is too long' });
    }
    const msg: SentMessage = {
      message_id: nextId++,
      chat_id: chatId,
      text,
      plain,
      parse_mode: parseMode,
      reply_markup: body.reply_markup ?? null,
      date: Math.floor(Date.now() / 1000),
    };
    messages.push(msg);
    reply(res, 200, {
      ok: true,
      result: {
        message_id: msg.message_id,
        chat: { id: Number(chatId) },
        date: msg.date,
        text: plain,
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

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(url.pathname);
    const done = (err: unknown) =>
      reply(res, 400, { ok: false, error_code: 400, description: `Bad Request: ${String(err)}` });
    if (m && req.method === 'POST') return void botMethod(req, res, m[1]!, m[2]!).catch(done);
    if (url.pathname === '/__control' && req.method === 'POST')
      return void control(req, res).catch(done);
    if (url.pathname === '/__messages') return reply(res, 200, { messages });
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return void res.end(page(messages, opts.appUrl));
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
    failNext(count, failure) {
      for (let i = 0; i < count; i++) queue.push(failure);
    },
    blockChat(chatId) {
      blocked.add(String(chatId));
    },
    clear() {
      messages.length = 0;
      queue.length = 0;
      blocked.clear();
      calls = 0;
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

/** What a person would see in Telegram, newest first. Everything is escaped: nothing here runs. */
function page(messages: SentMessage[], appUrl: string | undefined): string {
  const items = [...messages]
    .reverse()
    .map(
      (m) =>
        `<li><div class="meta">#${m.message_id} · chat ${esc(m.chat_id)} · ${new Date(
          m.date * 1000,
        ).toLocaleTimeString(
          'ru-RU',
        )}</div><div class="text">${esc(m.plain)}</div>${buttons(m.reply_markup, m.chat_id, appUrl)}</li>`,
    )
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3"><title>Сообщения бота (локальная имитация)</title>
<style>body{font:16px system-ui,sans-serif;margin:0;padding:16px;background:#f2f2f7;color:#111}h1{font-size:20px}
ul{list-style:none;padding:0;max-width:560px}li{background:#fff;border-radius:12px;padding:12px;margin:0 0 10px}
.meta{color:#888;font-size:13px;margin-bottom:6px}.text{white-space:pre-wrap}.btn{display:inline-block;margin-top:8px;padding:6px 12px;border-radius:8px;background:#e8f0fe;color:#1a73e8;text-decoration:none}</style>
</head><body><h1>Сообщения бота</h1><p>Локальная имитация Telegram: эти сообщения никуда не отправлены. Страница обновляется сама.</p>
${items ? `<ul>${items}</ul>` : '<p><b>Пока сообщений нет.</b> Запустите таймер в режиме готовки.</p>'}</body></html>`;
}
