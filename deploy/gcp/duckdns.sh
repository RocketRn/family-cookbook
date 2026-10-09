#!/usr/bin/env bash
# Keeps DOMAIN (a free DuckDNS name) pointing at this VM's current address (docs/DEPLOY-GCP.ru.md).
# Run by cron every 5 minutes and at start-up, see install-cron.sh: after the VM is stopped and
# started, Google may give it a new address.
set -euo pipefail
cd "$(dirname "$0")"
setting() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2-; }
name="$(setting DUCKDNS_SUBDOMAIN)"
token="$(setting DUCKDNS_TOKEN)"
[ -n "$name" ] && [ "$name" != CHANGE_ME ] && [ -n "$token" ] && [ "$token" != CHANGE_ME ] ||
  { echo "DUCKDNS_SUBDOMAIN / DUCKDNS_TOKEN are not set in .env" >&2; exit 1; }
# An empty ip= lets DuckDNS take the address the request comes from: this VM's public address.
answer="$(curl -fsS --max-time 20 "https://www.duckdns.org/update?domains=$name&token=$token&ip=")"
[ "$answer" = OK ] || { echo "$(date -u +%FT%TZ) DuckDNS update failed: $answer" >&2; exit 1; }
