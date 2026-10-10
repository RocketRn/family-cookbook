import { runWebhookCli } from './webhookCli.js';

// `docker compose run --rm webhook [set|info|delete]` on the server (docs/DEPLOY-GCP.ru.md 9.8);
// scripts/demo.sh runs it against the local stand-in. Settings come from the environment only.
void runWebhookCli(process.argv.slice(2), process.env, (line) => console.log(line)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
