#!/usr/bin/env bash
# Restores the database from a backup (docs/DEPLOY-GCP.ru.md, D-045). Everything written since that
# backup is lost, so it asks first. Photos are not affected (they live in their own bucket).
#   ./restore.sh                     the newest backup
#   ./restore.sh gs://<bucket>/db/cookbook-2026-10-09T0330Z.dump
set -euo pipefail
cd "$(dirname "$0")"
setting() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2-; }
bucket="$(setting BACKUP_BUCKET)"
src="${1:-$(gcloud storage ls "gs://$bucket/db/" | sort | tail -n 1)}"
[ -n "$src" ] || { echo "No backup found in gs://$bucket/db/" >&2; exit 1; }
echo "Restore the database from: $src"
echo "Everything changed in the app after that backup will be lost."
read -r -p 'Type YES to continue: ' answer
[ "$answer" = YES ] || { echo 'Cancelled, nothing changed.'; exit 0; }

file="$(mktemp /tmp/cookbook-restore-XXXXXX.dump)"
trap 'rm -f "$file"' EXIT
gcloud storage cp --quiet "$src" "$file"
docker compose stop api worker
docker compose exec -T postgres pg_restore -U cookbook -d cookbook --clean --if-exists --single-transaction --exit-on-error <"$file"
# Migrations newer than the backup, and the API's database user, are put back in shape.
docker compose run --rm migrate
docker compose up -d
echo "Restored from $src. The app is running again."
