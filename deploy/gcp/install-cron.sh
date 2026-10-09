#!/usr/bin/env bash
# Installs the server's scheduled jobs for the current user (docs/DEPLOY-GCP.ru.md). Safe to run
# again: it replaces its own lines and leaves any other cron lines alone.
#   03:30 UTC every night   backup.sh   -> ~/cookbook-backup.log
#   every 5 min, at boot    duckdns.sh  -> ~/cookbook-duckdns.log
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
chmod +x "$here/backup.sh" "$here/restore-test.sh" "$here/duckdns.sh"
{
  crontab -l 2>/dev/null | grep -v '# cookbook-' || true
  echo "30 3 * * * $here/backup.sh >>\$HOME/cookbook-backup.log 2>&1 # cookbook-backup"
  echo "*/5 * * * * $here/duckdns.sh >>\$HOME/cookbook-duckdns.log 2>&1 # cookbook-duckdns"
  echo "@reboot sleep 30 && $here/duckdns.sh >>\$HOME/cookbook-duckdns.log 2>&1 # cookbook-duckdns-boot"
} | crontab -
echo "Installed:"
crontab -l | grep '# cookbook-'
