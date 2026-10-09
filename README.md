# Family Cookbook (Telegram Mini App)

A shared family cookbook that runs inside Telegram. Product spec: [`docs/PRD.md`](docs/PRD.md) (the single source of truth), original brief: [`docs/BRIEF.md`](docs/BRIEF.md). Decisions and open assumptions: [`docs/DECISIONS.md`](docs/DECISIONS.md), [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md). Sprint reports: [`docs/sprints/`](docs/sprints/).

## Layout

| Path                        | What                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| `apps/api`                  | Fastify REST API (Node 24, TypeScript, plain-SQL migrations, Postgres + RLS) |
| `apps/worker`               | Timer and outbox worker, a separate process (skeleton in Sprint 1)           |
| `apps/web`                  | React 18 + Vite Mini App (i18next, TanStack Query, Zustand)                  |
| `packages/recipe-core`      | Pure TypeScript parsing and recalculation library (empty until Sprint 2)     |
| `db/migrations`, `db/seeds` | SQL migrations (`NNNN_name.up.sql` / `.down.sql`) and dev seed data          |

## Requirements

Node 24 LTS (see `.nvmrc`), pnpm 10, and Postgres 15+ (via Docker Compose, or your own).

## Quick start

```bash
pnpm install
cp .env.example .env          # fake dev values; no real bot token is needed
docker compose up -d          # Postgres 15 (dev + test databases) and S3-compatible storage
pnpm db:migrate               # apply migrations and create the API's restricted database user
pnpm db:seed                  # dev users, a book and a few recipes
pnpm dev                      # API :3000, web :5173, worker
```

Open <http://localhost:5173>. Outside Telegram the web app uses a **mock Telegram provider** (development only): it signs a fresh `initData` with a fake dev token at every start, so sign-in works end to end without a bot. Useful URL parameters:

- `?devUser=1|2|3`: seeded keeper (ru), seeded member (en), a new user without a book (sv)
- `?theme=dark|light`: force the theme
- `?startapp=join_devinvitecode`: simulate a deep link

Without Docker, use any Postgres 15+ you control: create a user `cookbook` (password `cookbook`, with the CREATEROLE right) that owns the databases `cookbook` and `cookbook_test`. If port 5432 is already taken, start Docker with `POSTGRES_PORT=55432 docker compose up -d` and change the port in `.env`.

### Two database users (why there are two URLs)

- `MIGRATION_DATABASE_URL` is the owner (`cookbook`). Only `db:migrate`, `db:seed` and `db:reset` use it.
- `DATABASE_URL` is what the API logs in as (`cookbook_api`). `pnpm db:migrate` creates it from this URL. It owns nothing and can only act through the restricted roles `cookbook_app` (everything a user does, filtered by row-level security) and `cookbook_system` (sign-in and membership changes, limited by column grants). The API refuses to start if this user is a superuser, owns tables or could bypass row-level security. See `docs/DECISIONS.md` D-013.

## Commands

```bash
pnpm typecheck     # all packages
pnpm lint          # ESLint + Prettier check
pnpm i18n:check    # key completeness of the 4 UI locales
pnpm test          # all tests (needs Postgres, see below)
pnpm build
pnpm check:bundle  # after build: the production bundle has no dev mock or fake token
pnpm db:migrate | pnpm --filter @cookbook/api db:rollback | db:reset | pnpm db:seed
```

### Tests and the database

API tests connect the app under test through `DATABASE_URL` (the restricted API user) and set up the schema and fixtures through `MIGRATION_DATABASE_URL` (the owner). `.env.test` points both at `cookbook_test` on `localhost:5432`; CI overrides them and runs the suite on Postgres 15 and 16. The suite **drops and recreates the schema**, so it refuses to run unless the database name contains `test`.

## Configuration

All variables are documented in [`.env.example`](.env.example) and validated at startup (the API exits with a clear message if something is missing or inconsistent). In production `BOT_TOKEN` is the real token; `ALLOW_DEV_INIT_DATA=true` is rejected unless `NODE_ENV=development`.

## Conventions

TypeScript strict everywhere; conventional commits; no hard-coded UI strings (enforced by ESLint `react/jsx-no-literals`, locales checked in CI); no LLM/AI calls for parsing or anywhere else in the MVP.
