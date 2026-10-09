# Family Cookbook (Telegram Mini App)

A shared family cookbook that runs inside Telegram. Product spec: [`docs/PRD.md`](docs/PRD.md) (the single source of truth), original brief: [`docs/BRIEF.md`](docs/BRIEF.md). Decisions and open assumptions: [`docs/DECISIONS.md`](docs/DECISIONS.md), [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md). Sprint reports: [`docs/sprints/`](docs/sprints/).

## Layout

| Path                        | What                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| `apps/api`                  | Fastify REST API (Node 24, TypeScript, plain-SQL migrations, Postgres + RLS) |
| `apps/worker`               | Background worker, a separate process (Sprint 2: removes unused photos)      |
| `apps/web`                  | React 18 + Vite Mini App (i18next, TanStack Query, Zustand)                  |
| `packages/recipe-core`      | Pure TypeScript units, recalculation, smart rounding and number formatting   |
| `db/migrations`, `db/seeds` | SQL migrations (`NNNN_name.up.sql` / `.down.sql`) and dev seed data          |

## Local demo (one command)

For a visual look at the app on your own computer: Ubuntu, Docker, Node 24.

```bash
pnpm demo          # checks prerequisites, starts Postgres + S3, migrates, seeds, publishes a demo
                   # recipe with photos, starts API + worker + web, opens http://localhost:5173/?devUser=1
pnpm demo:stop     # stops everything, keeps the data
pnpm demo:reset    # deletes all demo data (asks first)
```

Step-by-step guide for a first-time terminal user (Russian): [`docs/RUN-LOCALLY.ru.md`](docs/RUN-LOCALLY.ru.md).

- The demo uses only fake local values: the dev bot token and the dev S3 keys. Every port listens on 127.0.0.1.
- Ports are `DEMO_WEB_PORT` (5173), `DEMO_API_PORT` (3000), `POSTGRES_PORT` (5432) and `S3_PORT` (8333). They are remembered in `.demo/ports.env`.
- Logs are in `.demo/logs/`.
- The demo runs as its own Docker Compose project (`cookbook-demo`), separate from `docker compose up`.

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
node scripts/demo-recipe.mjs  # optional: publish a demo recipe with photos (Sprint 2 demo)
```

Open <http://localhost:5173>. Outside Telegram the web app uses a **mock Telegram provider** (development only): it signs a fresh `initData` with a fake dev token at every start, so sign-in works end to end without a bot. Useful URL parameters:

- `?devUser=1|2|3`: seeded keeper (ru), seeded member (en), a new user without a book (sv)
- `?theme=dark|light`: force the theme
- `?startapp=join_devinvitecode`: simulate a deep link

In development, Profile → **Design previews** opens the recipe editor and import review designs (UX-03). The Saved tab shows a marked sample there. Neither exists in production builds.

### Photos (S3-compatible storage)

Photos go through the S3 API only (`S3_*` in `.env.example`). Locally this is SeaweedFS from Docker Compose (S3 on port 8333, fake local keys). The API creates the bucket in development, stores each upload as a 2048 px and a 512 px JPEG without metadata, and returns links signed for one hour. The worker removes photos that no recipe uses after 24 hours. See D-026.

Without Docker, use any Postgres 15+ and any S3-compatible store you control: create a user `cookbook` (password `cookbook`, with the CREATEROLE right) that owns the databases `cookbook` and `cookbook_test`. If port 5432 is already taken, start Docker with `POSTGRES_PORT=55432 docker compose up -d` and change the port in `.env`.

### Two database users (why there are two URLs)

- `MIGRATION_DATABASE_URL` is the owner (`cookbook`). Only `db:migrate`, `db:seed` and `db:reset` use it.
- `DATABASE_URL` is what the API logs in as (`cookbook_api`). `pnpm db:migrate` creates it from this URL. It owns nothing and can only act through the restricted roles `cookbook_app` (everything a user does, filtered by row-level security) and `cookbook_system` (sign-in and membership changes, limited by column grants). The API refuses to start if this user is a superuser, owns tables or could bypass row-level security. See `docs/DECISIONS.md` D-013.

## Commands

```bash
pnpm verify        # everything CI runs, in order: typecheck, lint, i18n, build, bundle check, tests
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

The S3 contract test (`apps/api/test/s3.test.ts`) uses the SeaweedFS from Docker Compose (`S3_TEST_ENDPOINT` in `.env.test`). CI starts its own SeaweedFS and fails if the test cannot run. All other photo tests use in-memory storage.

## Configuration

All variables are documented in [`.env.example`](.env.example) and validated at startup (the API exits with a clear message if something is missing or inconsistent). In production `BOT_TOKEN` is the real token; `ALLOW_DEV_INIT_DATA=true` is rejected unless `NODE_ENV=development`.

## Conventions

TypeScript strict everywhere; conventional commits; no hard-coded UI strings (enforced by ESLint `react/jsx-no-literals`, locales checked in CI); no LLM/AI calls for parsing or anywhere else in the MVP.
