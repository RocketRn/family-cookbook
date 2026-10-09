import { startFakeTelegram } from './server.js';

// `pnpm --filter @cookbook/fakebot dev`: the stand-in for the demo (scripts/demo.sh starts it).
// Only on this computer (127.0.0.1); the page at / shows the messages the worker "sent".
const port = Number(process.env.FAKEBOT_PORT ?? 8081);
const bot = await startFakeTelegram({ port, host: '127.0.0.1' });
console.log(JSON.stringify({ level: 'info', msg: 'Telegram stand-in listening', url: bot.url }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void bot.close().then(() => process.exit(0)));
}
