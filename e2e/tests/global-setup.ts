import { api, BOT, botAction, KEEPER, MARK, MEMBER, WEB, type DevUser } from './stack';

const DEFAULT_PREFS = { timers: true, cooked: true, new_recipe: false, mute_social: false };

async function reachable(url: string) {
  try {
    return (await fetch(url)).status < 500;
  } catch {
    return false;
  }
}

/** Deletes the recipes earlier runs left behind (their titles start with the mark), and stops their timers. */
export async function tidy(user: DevUser) {
  let cursor: string | null = null;
  const leftovers: string[] = [];
  do {
    const page: { items: Array<{ id: string; title: string }>; next_cursor: string | null } =
      await api(user, 'GET', `/recipes?scope=mine&limit=50${cursor ? `&cursor=${cursor}` : ''}`);
    leftovers.push(...page.items.filter((r) => r.title.startsWith(MARK)).map((r) => r.id));
    cursor = page.next_cursor;
  } while (cursor);
  for (const id of leftovers) await api(user, 'DELETE', `/recipes/${id}`);
  // Timers an interrupted run left running.
  const { timers } = await api<{ timers: Array<{ id: string; status: string }> }>(
    user,
    'GET',
    '/timers?active=1',
  );
  for (const t of timers.filter((x) => x.status === 'running'))
    await api(user, 'DELETE', `/timers/${t.id}`);
}

export default async function globalSetup() {
  if (!(await reachable(`${WEB}/api/health`)) || !(await reachable(`${BOT}/__messages`)))
    throw new Error(
      `The demo is not running at ${WEB} (bot stand-in ${BOT}). Start it first: pnpm demo ` +
        '(docs/RUN-LOCALLY.ru.md). Other addresses: E2E_WEB_URL and E2E_BOT_URL.',
    );
  // Each run starts from the seeded state of the two people: their language, default
  // notifications, and the bot started (not blocked) in their chats.
  for (const user of [KEEPER, MEMBER]) {
    await api(user, 'PATCH', '/me', { ui_lang: user.lang, notify_prefs: DEFAULT_PREFS });
    await botAction('unblock', user.chat);
    await botAction('start', user.chat);
    await tidy(user);
  }
}
