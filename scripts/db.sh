#!/usr/bin/env bash
# Local Postgres 16 cluster for Qadam. No docker required.
#
#   ./scripts/db.sh start | stop | status | psql | reset | url
#
# Everything lives in .pgdata / .pgsock at the repo root, both gitignored.
# If DATABASE_URL is set, these commands are a no-op and that URL is used instead —
# that is how CI and a real Supabase project are targeted.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA_DIR="${QADAM_PGDATA:-$ROOT/.pgdata}"
PGSOCK_DIR="${QADAM_PGSOCK:-$ROOT/.pgsock}"
PGPORT="${QADAM_PGPORT:-5433}"
PGLOG="$PGDATA_DIR/server.log"

find_bindir() {
  if command -v pg_ctl >/dev/null 2>&1; then dirname "$(command -v pg_ctl)"; return; fi
  for v in 17 16 15; do
    for p in "/usr/lib/postgresql/$v/bin" "/usr/local/pgsql/bin" "/opt/homebrew/opt/postgresql@$v/bin"; do
      [ -x "$p/pg_ctl" ] && { echo "$p"; return; }
    done
  done
  echo "qadam: no postgres server binaries found (need initdb/pg_ctl)." >&2
  echo "  ubuntu/debian: sudo apt-get install postgresql-16 postgresql-16-pgtap" >&2
  echo "  macos:         brew install postgresql@16 && brew install pgtap" >&2
  exit 1
}
BIN="$(find_bindir)"

# Postgres refuses to run as root. When we are root (containers, CI images) do the
# work as the postgres system user instead.
AS_PG=""
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  AS_PG="postgres"
fi
run_pg() {   # run_pg <command string>
  if [ -n "$AS_PG" ]; then su "$AS_PG" -c "$1"; else bash -c "$1"; fi
}
own() { [ -n "$AS_PG" ] && chown -R "$AS_PG:$AS_PG" "$@" || true; }

# libpq keyword/value conninfo — no URI escaping traps around the socket path.
url() { echo "host=$PGSOCK_DIR port=$PGPORT user=postgres dbname=${1:-postgres}"; }

is_running() {
  run_pg "$BIN/pg_ctl -D '$PGDATA_DIR' status" >/dev/null 2>&1
}

start() {
  if is_running; then echo "qadam: cluster already running on port $PGPORT"; return; fi
  if [ ! -s "$PGDATA_DIR/PG_VERSION" ]; then
    echo "qadam: initialising cluster at $PGDATA_DIR"
    mkdir -p "$PGDATA_DIR"; own "$PGDATA_DIR"
    run_pg "$BIN/initdb -D '$PGDATA_DIR' -U postgres --auth=trust --locale=C.UTF-8 --encoding=UTF8" >/dev/null
  fi
  mkdir -p "$PGSOCK_DIR"; own "$PGSOCK_DIR" "$PGDATA_DIR"
  run_pg "$BIN/pg_ctl -D '$PGDATA_DIR' -l '$PGLOG' -w \
    -o \"-k $PGSOCK_DIR -p $PGPORT -c listen_addresses='' -c timezone=UTC\" start" >/dev/null
  echo "qadam: cluster up  →  $(url)"
}

stop()   { is_running && run_pg "$BIN/pg_ctl -D '$PGDATA_DIR' -m fast -w stop" >/dev/null && echo "qadam: cluster stopped" || echo "qadam: not running"; }
status() { is_running && echo "qadam: running on $PGPORT" || { echo "qadam: not running"; exit 1; }; }
reset()  { stop >/dev/null 2>&1 || true; rm -rf "$PGDATA_DIR" "$PGSOCK_DIR"; echo "qadam: cluster wiped"; start; }

case "${1:-status}" in
  start)  start ;;
  stop)   stop ;;
  status) status ;;
  reset)  reset ;;
  url)    shift || true; url "${1:-postgres}" ;;
  psql)   shift; db="${1:-postgres}"; shift || true; psql "$(url "$db")" "$@" ;;
  *) echo "usage: $0 {start|stop|status|reset|psql|url}" >&2; exit 2 ;;
esac
