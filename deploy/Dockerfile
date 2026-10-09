# syntax=docker/dockerfile:1.7
#
# Production images (docs/DEPLOY-GCP.ru.md, D-045), built on the server from this repository:
#   target app    the API and the worker (one image, two commands), and the migrations
#   target web    Caddy with the built web app: HTTPS, the static files, /api -> the API
#   target tools  everything including tests: the storage check (`compose run --rm s3check`)
# No secret is ever part of an image: settings come from deploy/gcp/.env at run time.

ARG NODE_IMAGE=node:24-alpine
ARG CADDY_IMAGE=caddy:2-alpine

# ---------------------------------------------------------------- dependencies
FROM ${NODE_IMAGE} AS deps
WORKDIR /src
# Only on networks that inspect TLS (not needed on Google Cloud): an extra CA certificate,
# passed with `--secret id=extra_ca,src=<file>`. A build secret is never stored in the image.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm install -g pnpm@10.28.0 && npm cache clean --force
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/fakebot/package.json apps/fakebot/
COPY packages/recipe-core/package.json packages/recipe-core/
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build
FROM deps AS build
COPY . .
# The web app's settings are baked into its files (they are public anyway).
ARG CSP_S3_ORIGIN=https://storage.googleapis.com
ARG VITE_BOT_USERNAME
ARG VITE_MINI_APP_SHORT_NAME
RUN pnpm --filter @cookbook/recipe-core --filter @cookbook/api --filter @cookbook/worker build \
 && CSP_S3_ORIGIN="$CSP_S3_ORIGIN" VITE_BOT_USERNAME="$VITE_BOT_USERNAME" \
    VITE_MINI_APP_SHORT_NAME="$VITE_MINI_APP_SHORT_NAME" pnpm --filter @cookbook/web build \
 # Caddy sends the same Content-Security-Policy-Report-Only as `pnpm preview` (docs/CSP.md).
 && printf 'header Content-Security-Policy-Report-Only "%s"\n' \
      "$(tr -d '\n' < apps/web/dist/csp-report-only.txt)" > apps/web/dist/csp.caddy

# ---------------------------------------------------------------- tools (checks on the server)
FROM build AS tools
ENV NODE_ENV=test
CMD ["pnpm", "--filter", "@cookbook/api", "test:s3"]

# ---------------------------------------------------------------- production dependencies only
FROM build AS prod-deps
# CI=true: pnpm may replace node_modules without asking (there is no terminal in a build).
RUN CI=true pnpm install --frozen-lockfile --prod --offline

# ---------------------------------------------------------------- app: API, worker, migrations
FROM ${NODE_IMAGE} AS app
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /src/package.json ./
COPY --from=prod-deps /src/node_modules ./node_modules
COPY --from=prod-deps /src/packages/recipe-core/package.json packages/recipe-core/
COPY --from=prod-deps /src/packages/recipe-core/dist packages/recipe-core/dist
COPY --from=prod-deps /src/apps/api/package.json apps/api/
COPY --from=prod-deps /src/apps/api/dist apps/api/dist
COPY --from=prod-deps /src/apps/api/node_modules apps/api/node_modules
COPY --from=prod-deps /src/apps/worker/package.json apps/worker/
COPY --from=prod-deps /src/apps/worker/dist apps/worker/dist
COPY --from=prod-deps /src/apps/worker/node_modules apps/worker/node_modules
COPY db/migrations db/migrations
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]

# ---------------------------------------------------------------- web: Caddy + the web app
FROM ${CADDY_IMAGE} AS web
COPY --from=build /src/apps/web/dist /srv
RUN mv /srv/csp.caddy /etc/caddy/csp.caddy && rm -f /srv/_headers /srv/csp-report-only.txt
COPY deploy/gcp/Caddyfile /etc/caddy/Caddyfile
