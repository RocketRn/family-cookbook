import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { devInitData } from '../../scripts/lib/dev-init-data.mjs';

/**
 * Where the demo stack runs (scripts/demo.sh). E2E_WEB_URL and E2E_BOT_URL win; otherwise the
 * ports the last `pnpm demo` remembered in .demo/ports.env; otherwise the demo's defaults.
 */
function savedPort(key: string): string | undefined {
  try {
    const env = readFileSync(new URL('../../.demo/ports.env', import.meta.url), 'utf8');
    return new RegExp(`^${key}=(\\d+)$`, 'm').exec(env)?.[1];
  } catch {
    return undefined;
  }
}
export const WEB = process.env.E2E_WEB_URL ?? `http://localhost:${savedPort('WEB_PORT') ?? 5173}`;
export const BOT = process.env.E2E_BOT_URL ?? `http://127.0.0.1:${savedPort('BOT_PORT') ?? 8081}`;

/** The seeded dev users (db/seeds/dev.sql): 1 is the book's keeper (Russian), 2 a member (English). */
export const KEEPER = { key: '1', chat: '100000001', lang: 'ru' } as const;
export const MEMBER = { key: '2', chat: '100000002', lang: 'en' } as const;
export type DevUser = typeof KEEPER | typeof MEMBER;

/** Every recipe a test creates starts with this, so a run can tidy up after itself. */
export const MARK = 'E2E ·';
export const title = (name: string) => `${MARK} ${name} ${Date.now().toString(36).slice(-5)}`;

/** The API as a dev user, through the web server's /api proxy (setup and checks only). */
export async function api<T = unknown>(
  user: DevUser,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${WEB}/api${path}`, {
    method,
    headers: {
      Authorization: `tma ${devInitData(user.key)}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

export type BotMessage = {
  message_id: number;
  chat_id: string;
  plain: string;
  photo: string | null;
  reply_markup: { inline_keyboard: Array<Array<{ text: string; url: string }>> } | null;
};

/** What the Telegram stand-in received (apps/fakebot). */
export async function botMessages(): Promise<BotMessage[]> {
  return ((await (await fetch(`${BOT}/__messages`)).json()) as { messages: BotMessage[] }).messages;
}
export const lastMessageId = async () => (await botMessages()).at(-1)?.message_id ?? 0;

/** Waits for a bot message to `chat` newer than `after` that contains `text`. */
export async function botMessage(
  chat: string,
  after: number,
  text: string | RegExp,
  timeoutMs = 15_000,
): Promise<BotMessage> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = (await botMessages()).find(
      (m) =>
        m.chat_id === chat &&
        m.message_id > after &&
        (typeof text === 'string' ? m.plain.includes(text) : text.test(m.plain)),
    );
    if (found) return found;
    if (Date.now() > until)
      throw new Error(`No bot message to ${chat} with ${String(text)} in ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Presses a button on the stand-in page's "write to the bot" panel, as a demo user. */
export async function botAction(action: 'start' | 'block' | 'unblock', chat: string) {
  const res = await fetch(`${BOT}/__${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ chat }),
    redirect: 'manual',
  });
  if (res.status !== 303) throw new Error(`stand-in /__${action} -> ${res.status}`);
}

/** A plain PNG of one colour (no image library needed), e.g. a 4000 px "phone photo". */
export function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
