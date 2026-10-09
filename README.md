# Family Cookbook (Telegram Mini App)

A shared family cookbook that runs inside Telegram. Product spec: [`docs/PRD.md`](docs/PRD.md) (the single source of truth), original brief: [`docs/BRIEF.md`](docs/BRIEF.md). Decisions and open assumptions: [`docs/DECISIONS.md`](docs/DECISIONS.md), [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md). Sprint reports: [`docs/sprints/`](docs/sprints/).

## Layout

| Path                        | What                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| `apps/api`                  | Fastify REST API (Node 20, TypeScript, plain-SQL migrations, Postgres + RLS) |
| `apps/worker`               | Timer and outbox worker, a separate process (skeleton in Sprint 1)           |
| `apps/web`                  | React 18 + Vite Mini App (i18next, TanStack Query, Zustand)                  |
| `packages/recipe-core`      | Pure TypeScript parsing and recalculation library (empty until Sprint 2)     |
| `db/migrations`, `db/seeds` | SQL migrations (`NNNN_name.up.sql` / `.down.sql`) and dev seed data          |

## Requirements

Node 20+, pnpm 10, and Postgres 15+ (via Docker Compose, or your own).

## Quick start

```bash
pnpm install
cp .env.example .env          # fake dev values; no real bot token is needed
docker compose up -d          # Postgres (dev + test databases) and MinIO
pnpm db:migrate               # apply migrations
pnpm db:seed                  # dev users, a book and a few recipes
pnpm dev                      # API :3000, web :5173, worker
```

Open <http://localhost:5173>. Outside Telegram the web app uses a **mock Telegram provider** (development only): it signs a fresh `initData` with a fake dev token at every start, so sign-in works end to end without a bot. Useful URL parameters:

- `?devUser=1|2|3`: seeded keeper (ru), seeded member (en), a new user without a book (sv)
- `?theme=dark|light`: force the theme
- `?startapp=join_devinvitecode`: simulate a deep link

Without Docker, point `DATABASE_URL` at any Postgres you control (create `cookbook` and `cookbook_test` databases).

## Commands

```bash
pnpm typecheck     # all packages
pnpm lint          # ESLint + Prettier check
pnpm i18n:check    # key completeness of the 4 UI locales
pnpm test          # all tests (needs Postgres, see below)
pnpm build
pnpm db:migrate | pnpm --filter @cookbook/api db:rollback | db:reset | pnpm db:seed
```

### Tests and the database

API tests read the database from `DATABASE_URL`. `.env.test` defaults to `postgres://cookbook:cookbook@localhost:5432/cookbook_test`; CI overrides it with a GitHub Actions service container. The suite **drops and recreates the schema**, so it refuses to run unless the database name contains `test`.

## Configuration

All variables are documented in [`.env.example`](.env.example) and validated at startup (the API exits with a clear message if something is missing or inconsistent). In production `BOT_TOKEN` is the real token; `ALLOW_DEV_INIT_DATA=true` is rejected unless `NODE_ENV=development`.

## Conventions

TypeScript strict everywhere; conventional commits; no hard-coded UI strings (enforced by ESLint `react/jsx-no-literals`, locales checked in CI); no LLM/AI calls for parsing or anywhere else in the MVP.
