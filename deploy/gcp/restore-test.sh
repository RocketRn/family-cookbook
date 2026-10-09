#!/usr/bin/env bash
# Restore test (docs/DEPLOY-GCP.ru.md, D-045): takes the newest backup from Cloud Storage, restores
# it into a temporary database next to the real one, compares the number of rows, and removes the
# temporary database. The app and its data are not touched. Run it once a month.
set -euo pipefail
cd "$(dirname "$0")"
setting() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2-; }
bucket="$(setting BACKUP_BUCKET)"
[ -n "$bucket" ] && [ "$bucket" != CHANGE_ME ] || { echo "BACKUP_BUCKET is not set in .env" >&2; exit 1; }
psql() { docker compose exec -T postgres psql -U cookbook -v ON_ERROR_STOP=1 -qtA "$@"; }

latest="$(gcloud storage ls "gs://$bucket/db/" | sort | tail -n 1)"
[ -n "$latest" ] || { echo "No backups in gs://$bucket/db/ yet" >&2; exit 1; }
echo "Newest backup: $latest"
file="$(mktemp /tmp/cookbook-restore-XXXXXX.dump)"
trap 'rm -f "$file"; psql -d postgres -c "DROP DATABASE IF EXISTS cookbook_restore_test" >/dev/null 2>&1 || true' EXIT
gcloud storage cp --quiet "$latest" "$file"

psql -d postgres -c 'DROP DATABASE IF EXISTS cookbook_restore_test'
psql -d postgres -c 'CREATE DATABASE cookbook_restore_test OWNER cookbook'
docker compose exec -T postgres pg_restore -U cookbook -d cookbook_restore_test --exit-on-error <"$file"

count="SELECT format('%s users, %s books, %s recipes, %s migrations', (SELECT count(*) FROM users), (SELECT count(*) FROM books), (SELECT count(*) FROM recipes), (SELECT count(*) FROM schema_migrations))"
echo "In the backup:   $(psql -d cookbook_restore_test -c "$count")"
echo "In the app now:  $(psql -d cookbook -c "$count")"
echo "Restore test OK: the backup can be restored (the numbers may differ by what changed since)."
