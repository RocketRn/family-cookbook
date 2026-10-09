#!/usr/bin/env bash
# Nightly database backup to Cloud Storage (docs/DEPLOY-GCP.ru.md, D-045). Run by cron, see
# install-cron.sh. Uses the VM's own Google account (no key on disk): it may add backups to the
# bucket and read them, not delete them. Old backups are removed by the bucket's lifecycle rule.
set -euo pipefail
cd "$(dirname "$0")"
setting() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2-; }
bucket="$(setting BACKUP_BUCKET)"
[ -n "$bucket" ] && [ "$bucket" != CHANGE_ME ] || { echo "BACKUP_BUCKET is not set in .env" >&2; exit 1; }

stamp="$(date -u +%Y-%m-%dT%H%MZ)"
file="$(mktemp /tmp/cookbook-backup-XXXXXX.dump)"
trap 'rm -f "$file"' EXIT
# Custom format: compressed, and pg_restore can restore all of it or single tables.
docker compose exec -T postgres pg_dump -U cookbook -d cookbook --format=custom >"$file"
size="$(stat -c %s "$file")"
if [ "$size" -lt 2000 ]; then
  echo "$(date -u +%FT%TZ) backup FAILED: the dump is only $size bytes" >&2
  exit 1
fi
gcloud storage cp --quiet "$file" "gs://$bucket/db/cookbook-$stamp.dump"
echo "$(date -u +%FT%TZ) backup ok: gs://$bucket/db/cookbook-$stamp.dump ($size bytes)"
