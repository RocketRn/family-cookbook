#!/usr/bin/env bash
# Local demo for the product owner: one command that starts everything on this computer.
# Guide (Russian): docs/RUN-LOCALLY.ru.md. Development only: fake dev bot token, fake S3 keys,
# no real Telegram calls, nothing leaves this computer (all ports listen on 127.0.0.1).
#
#   scripts/demo.sh start        (pnpm demo)        check, set up and start; opens the browser
#   scripts/demo.sh stop         (pnpm demo:stop)   stop everything, keep the demo data
#   scripts/demo.sh reset [--yes] (pnpm demo:reset) stop and delete all demo data (asks first;
#                                 the chosen ports are kept)
#
# Ports (remembered in .demo/ports.env after a successful start):
#   DEMO_WEB_PORT (5173)  DEMO_API_PORT (3000)  POSTGRES_PORT (5432)  S3_PORT (8333)
# Other switches: DEMO_NO_BROWSER=1 (do not open the browser).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
STATE="$ROOT/.demo"
LOGS="$STATE/logs"
PROJECT="cookbook-demo"
NODE_MAJOR="$(tr -dc '0-9' < "$ROOT/.nvmrc")"
GUIDE="docs/RUN-LOCALLY.ru.md"
export COMPOSE_PROJECT_NAME="$PROJECT"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# ---------- output ----------
if [ -t 1 ]; then B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; N=$'\033[0m'; else B=; R=; G=; N=; fi
step() { printf '\n%s▶ %s%s\n' "$B" "$*" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
info() { printf '    %s\n' "$@"; }
fail() {
  printf '\n%s✗ %s%s\n' "$R" "$1" "$N"
  shift
  for line in "$@"; do printf '    %s\n' "$line"; done
  printf '\n    Подробная инструкция: %s\n' "$GUIDE"
  exit 1
}
show_log() { [ -f "$1" ] && { printf '\n    --- последние строки журнала %s ---\n' "${1#"$ROOT"/}"; tail -n 25 "$1" | sed 's/^/    /'; }; }

# ---------- ports ----------
saved() { grep -s "^$1=" "$STATE/ports.env" | tail -n 1 | cut -d= -f2; }
WEB_PORT="${DEMO_WEB_PORT:-$(saved WEB_PORT)}"; WEB_PORT="${WEB_PORT:-5173}"
API_PORT="${DEMO_API_PORT:-$(saved API_PORT)}"; API_PORT="${API_PORT:-3000}"
PG_PORT="${POSTGRES_PORT:-$(saved PG_PORT)}"; PG_PORT="${PG_PORT:-5432}"
S3P="${S3_PORT:-$(saved S3_PORT)}"; S3P="${S3P:-8333}"
export POSTGRES_PORT="$PG_PORT" S3_PORT="$S3P"
URL="http://localhost:$WEB_PORT/?devUser=1"

# ---------- processes ----------
pid_of() { cat "$STATE/$1.pid" 2>/dev/null; }
alive() { local p; p="$(pid_of "$1")"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }
# Each app runs in its own session, so stopping it stops its whole process group.
start_bg() {
  local name="$1"; shift
  # shellcheck disable=SC2016 # $$ and $0 expand in the inner shell, on purpose
  setsid bash -c 'echo $$ > "$0"; exec "$@"' "$STATE/$name.pid" "$@" >"$LOGS/$name.log" 2>&1 </dev/null &
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$STATE/$name.pid" ] && return 0; sleep 0.2; done
}
stop_bg() {
  local name="$1" p
  p="$(pid_of "$name")"
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
    kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null
    for _ in $(seq 1 50); do kill -0 "$p" 2>/dev/null || break; sleep 0.2; done
    kill -KILL -- "-$p" 2>/dev/null || true
    ok "остановлено: $name"
  fi
  rm -f "$STATE/$name.pid"
}

# ---------- checks ----------
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" = "$NODE_MAJOR" ]; }
port_free() {
  node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.once('listening',()=>s.close(()=>process.exit(0)));s.listen(Number(process.argv[1]),'0.0.0.0')" "$1"
}
http_ok() { node -e "fetch(process.argv[1]).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))" "$1" 2>/dev/null; }
wait_http() { # url seconds
  for _ in $(seq 1 "$2"); do http_ok "$1" && return 0; sleep 1; done
  return 1
}
compose_running() { [ -n "$(docker compose ps --status running -q "$1" 2>/dev/null)" ]; }
port_hint() { # port VAR what
  fail "Порт $1 уже занят другой программой ($3)." \
    "Запустите демо на другом свободном порту, например:" \
    "  $2=$(($1 + 1)) pnpm demo" \
    "Порт запомнится: в следующий раз достаточно «pnpm demo»."
}

check_node() {
  step "Проверяю Node.js $NODE_MAJOR"
  if ! node_ok && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm use --silent >/dev/null 2>&1 || true # reads .nvmrc
  fi
  if ! node_ok; then
    local now; now="$(node -v 2>/dev/null || echo 'не установлен')"
    if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
      fail "Нужен Node.js $NODE_MAJOR, а сейчас: $now." \
        "Выполните по очереди:" "  nvm install $NODE_MAJOR" "  nvm alias default $NODE_MAJOR" \
        "Затем закройте терминал, откройте новый и снова запустите «pnpm demo»."
    fi
    fail "Нужен Node.js $NODE_MAJOR, а сейчас: $now. Сначала установите nvm:" \
      "  wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash" \
      "Закройте терминал, откройте новый и выполните:" \
      "  nvm install $NODE_MAJOR && nvm alias default $NODE_MAJOR"
  fi
  ok "Node.js $(node -v)"
  local pv
  if ! command -v pnpm >/dev/null 2>&1 || ! pv="$(pnpm -v 2>/dev/null)" || [ -z "$pv" ]; then
    fail "Не найден pnpm (или он не запускается). Включите его (одна команда, нужен интернет):" \
      "  corepack enable && corepack prepare pnpm@10.28.0 --activate"
  fi
  ok "pnpm $pv"
}

check_docker() {
  step "Проверяю Docker"
  command -v docker >/dev/null 2>&1 || fail "Docker не найден." "Установите его: sudo apt install -y docker.io docker-compose-v2"
  case "$(readlink -f "$(command -v docker)")" in
    /snap/*)
      case "$ROOT" in "$HOME"/*) ;; *) fail "Docker установлен из snap и не видит папку $ROOT." \
        "Переместите папку проекта в домашнюю папку ($HOME) и запустите снова." ;; esac ;;
  esac
  local out
  if ! out="$(docker info 2>&1)"; then
    # Docker 29 says "failed to connect to the docker API ... daemon is running"; older versions say
    # "Cannot connect to the Docker daemon ... Is the docker daemon running?".
    case "$(printf '%s' "$out" | tr '[:upper:]' '[:lower:]')" in
      *"permission denied"*)
        fail "У вашего пользователя нет прав на Docker." \
          "Выполните:  sudo usermod -aG docker \$USER" \
          "Затем выйдите из системы и войдите снова (или перезагрузите компьютер)." ;;
      *"cannot connect"* | *"failed to connect"* | *"daemon is running"* | *"daemon running"*)
        fail "Служба Docker не запущена." "Выполните:  sudo systemctl start docker" \
          "Чтобы она запускалась сама при включении:  sudo systemctl enable docker" ;;
      *) fail "Docker не отвечает:" "$(printf '%s' "$out" | tail -n 3)" ;;
    esac
  fi
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
  docker compose version >/dev/null 2>&1 || fail "Не найден Docker Compose v2." "Выполните:  sudo apt install -y docker-compose-v2"
  ok "$(docker compose version --short 2>/dev/null | sed 's/^/Docker Compose /')"
}

check_ports() {
  step "Проверяю порты"
  compose_running postgres || port_free "$PG_PORT" || port_hint "$PG_PORT" POSTGRES_PORT "база данных"
  compose_running s3 || port_free "$S3P" || port_hint "$S3P" S3_PORT "хранилище фото"
  port_free "$API_PORT" || port_hint "$API_PORT" DEMO_API_PORT "сервер API"
  port_free "$WEB_PORT" || port_hint "$WEB_PORT" DEMO_WEB_PORT "веб-приложение"
  ok "свободны: приложение $WEB_PORT, API $API_PORT, база $PG_PORT, фото $S3P"
}

# Local, fake values only (the same as .env.example). They take precedence over a .env file.
demo_env() {
  export NODE_ENV=development LOG_LEVEL=info HOST=127.0.0.1 PORT="$API_PORT"
  export DATABASE_URL="postgres://cookbook_api:cookbook_api@localhost:$PG_PORT/cookbook"
  export MIGRATION_DATABASE_URL="postgres://cookbook:cookbook@localhost:$PG_PORT/cookbook"
  export BOT_TOKEN="000000:placeholder-not-a-real-token" ALLOW_DEV_INIT_DATA=true DEV_BOT_TOKEN="000000:DEV-ONLY-FAKE-TOKEN"
  export CORS_ORIGIN="http://localhost:$WEB_PORT" TRUST_PROXY=false
  export S3_ENDPOINT="http://localhost:$S3P" S3_PUBLIC_ENDPOINT="http://localhost:$S3P" S3_REGION=us-east-1
  export S3_ACCESS_KEY=cookbook-dev S3_SECRET_KEY=cookbook-dev-secret S3_BUCKET=cookbook-media S3_FORCE_PATH_STYLE=true
  export VITE_API_PROXY_TARGET="http://localhost:$API_PORT"
}

open_browser() {
  [ -n "${DEMO_NO_BROWSER:-}" ] && return 0
  if command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    xdg-open "$URL" >/dev/null 2>&1 &
    ok "открываю браузер"
  fi
}

# ---------- commands ----------
cmd_start() {
  mkdir -p "$LOGS"
  if alive api && alive web; then
    printf '\n%sДемо уже запущено:%s %s\n' "$B" "$N" "$URL"
    info "Остановить: pnpm demo:stop"
    open_browser
    exit 0
  fi
  stop_bg web >/dev/null; stop_bg worker >/dev/null; stop_bg api >/dev/null # leftovers of a crash

  check_node
  check_docker
  check_ports
  demo_env

  step "Устанавливаю зависимости (в первый раз это может занять несколько минут)"
  pnpm install --frozen-lockfile >"$LOGS/install.log" 2>&1 || { show_log "$LOGS/install.log"; fail "Не удалось установить зависимости." "Проверьте подключение к интернету и запустите «pnpm demo» ещё раз."; }
  ok "зависимости установлены"

  step "Запускаю базу данных и хранилище фото (Docker; в первый раз скачивается около 300 МБ)"
  docker compose up -d --wait >"$LOGS/docker.log" 2>&1 || { show_log "$LOGS/docker.log"; fail "Docker не смог запустить базу данных или хранилище фото."; }
  wait_http "http://localhost:$S3P/" 60 || fail "Хранилище фото не отвечает на порту $S3P." "Посмотрите: docker compose logs s3"
  ok "база данных: порт $PG_PORT; хранилище фото: порт $S3P"

  step "Готовлю базу данных"
  pnpm db:migrate >"$LOGS/migrate.log" 2>&1 || { show_log "$LOGS/migrate.log"; fail "Не удалось подготовить базу данных."; }
  pnpm db:seed >>"$LOGS/migrate.log" 2>&1 || { show_log "$LOGS/migrate.log"; fail "Не удалось загрузить тестовые данные."; }
  ok "таблицы созданы, тестовые пользователи, книга и рецепты загружены"

  step "Запускаю приложение"
  start_bg api pnpm --filter @cookbook/api exec tsx --conditions=source src/server.ts
  start_bg worker pnpm --filter @cookbook/worker exec tsx --conditions=source src/index.ts
  start_bg web pnpm --filter @cookbook/web exec vite --port "$WEB_PORT" --strictPort
  wait_http "http://localhost:$API_PORT/health" 90 || { show_log "$LOGS/api.log"; fail "Сервер API не запустился."; }
  ok "API: http://localhost:$API_PORT"
  wait_http "http://localhost:$WEB_PORT/" 90 || {
    show_log "$LOGS/web.log"
    grep -qs "already in use" "$LOGS/web.log" && port_hint "$WEB_PORT" DEMO_WEB_PORT "веб-приложение"
    fail "Веб-приложение не запустилось."
  }
  ok "приложение: http://localhost:$WEB_PORT"
  alive worker || { show_log "$LOGS/worker.log"; fail "Фоновый процесс (worker) не запустился."; }
  ok "фоновый процесс работает"

  step "Публикую демо-рецепт с фотографиями"
  API_URL="http://localhost:$API_PORT" WEB_URL="http://localhost:$WEB_PORT" node scripts/demo-recipe.mjs >"$LOGS/demo-recipe.log" 2>&1 ||
    { show_log "$LOGS/demo-recipe.log"; fail "Не удалось опубликовать демо-рецепт."; }
  sed 's/^/    /' "$LOGS/demo-recipe.log"

  printf 'WEB_PORT=%s\nAPI_PORT=%s\nPG_PORT=%s\nS3_PORT=%s\n' "$WEB_PORT" "$API_PORT" "$PG_PORT" "$S3P" >"$STATE/ports.env"
  printf '\n%s%s✓ Готово! Демо работает:%s %s\n' "$B" "$G" "$N" "$URL"
  info "Остановить:            pnpm demo:stop" "Стереть данные демо:   pnpm demo:reset" "Журналы:               .demo/logs/"
  open_browser
}

cmd_stop() {
  step "Останавливаю демо"
  stop_bg web; stop_bg worker; stop_bg api
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker compose stop >/dev/null 2>&1 && ok "база данных и хранилище фото остановлены (данные сохранены)"
  fi
  printf '\n%sДемо остановлено.%s Снова запустить: pnpm demo\n' "$B" "$N"
}

cmd_reset() {
  if [ "${1:-}" != "--yes" ]; then
    printf '\n%sВнимание:%s будут удалены все данные демо на этом компьютере:\n' "$B" "$N"
    info "рецепты, книги, загруженные фото, журналы. Код проекта не изменится."
    printf '    Продолжить? Введите «да» и нажмите Enter: '
    local answer
    read -r answer
    case "$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')" in
      да | yes | y | д) ;;
      *) printf '    Отменено, ничего не удалено.\n'; exit 0 ;;
    esac
  fi
  step "Удаляю данные демо"
  stop_bg web; stop_bg worker; stop_bg api
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker compose down -v --remove-orphans >/dev/null 2>&1 && ok "база данных и фото удалены"
  fi
  # Keep .demo/ports.env: chosen ports are a setting, not demo data.
  rm -rf "$LOGS" "$STATE"/*.pid
  printf '\n%sГотово.%s Чистое демо: pnpm demo\n' "$B" "$N"
}

case "${1:-start}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  reset) cmd_reset "${2:-}" ;;
  *) echo "Usage: scripts/demo.sh start|stop|reset [--yes]" >&2; exit 2 ;;
esac
