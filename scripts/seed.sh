#!/usr/bin/env bash
# Load the development seed into the local test database.
#
#   ./scripts/seed.sh          seed qadam_test (creating it if the suite has not)
#
# Refuses to touch a database that already has users unless you say so, because
# this file mints coins and writes step history.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TESTDB="${QADAM_TESTDB:-qadam_test}"

if [ -n "${DATABASE_URL:-}" ]; then
  URL="$DATABASE_URL"
  echo "qadam: seeding \$DATABASE_URL"
else
  ./scripts/db.sh start >/dev/null
  URL="$(./scripts/db.sh url "$TESTDB")"
fi

psql -X -q --no-psqlrc -v ON_ERROR_STOP=1 --pset pager=off "$URL" -f supabase/seed.sql
