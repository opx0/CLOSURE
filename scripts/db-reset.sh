#!/usr/bin/env bash
# Recreate the local development database from scratch, then migrate it.
#
# Forward-only migrations are never edited, and the runner refuses to continue when a file's
# checksum no longer matches the row that recorded it — that guard is doing its job, not
# malfunctioning. On a development database the honest repair is to rebuild: the event log on disk
# is the source, and `closer import` replays it back in idempotently.
set -euo pipefail

CONTAINER="${CLOSER_DB_CONTAINER:-closer-db}"
DATABASE="${CLOSER_DB_NAME:-closer}"

if [ "${1:-}" != "--yes" ]; then
  cat <<USAGE
This DROPS the local database "$DATABASE" in container "$CONTAINER" and re-creates it.

Anything only in Postgres is lost. Anything in .closer/events is not, and comes back with:
  bun run closer import

Re-run with:  bun run db:reset --yes
USAGE
  exit 1
fi

docker exec "$CONTAINER" psql -U closer -d postgres -c "DROP DATABASE IF EXISTS \"$DATABASE\" WITH (FORCE);"
docker exec "$CONTAINER" psql -U closer -d postgres -c "CREATE DATABASE \"$DATABASE\";"
DATABASE_URL="${DATABASE_URL:-postgres://closer:closer@localhost:5432/$DATABASE}" bun run db:migrate
echo
echo "recreated and migrated. bring the file log back with: bun run closer import"
