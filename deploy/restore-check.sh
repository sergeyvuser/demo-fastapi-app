#!/usr/bin/env bash
#
# Does the newest dump actually restore? Starts a throwaway PostgreSQL, loads
# the dump into it, prints what came back, and removes the server again.
#
#     bash /opt/alerts/deploy/restore-check.sh [/path/to/a.dump]
#
# Deliberately a manual command rather than a schedule. A monthly job producing
# a report nobody reads proves nothing, and a CI test on synthetic data would
# exercise the procedure while missing what actually breaks: these dump flags,
# this data, this PostgreSQL version. Run it after anything that changes the
# shape of the data — a migration, a version bump, a restore rehearsal.
#
# Touches nothing in production: a separate container, no volume, no published
# port, and the dump is mounted nowhere — it arrives on stdin.

set -Eeuo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/alerts}"
# Must match production's major version: pg_restore reads a dump written by
# pg_dump 18, and an older server would refuse the format outright.
PG_IMAGE="${PG_IMAGE:-postgres:18-alpine}"
READY_TIMEOUT=60

# $$ is this script's own process id — a name that cannot collide with a second
# run of the same script.
CONTAINER="alerts-restore-check-$$"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { printf 'restore-check: %s\n' "$*" >&2; exit 1; }

dump="${1:-}"
if [[ -z "$dump" ]]; then
  shopt -s nullglob
  dumps=( "$BACKUP_DIR"/crypto_alerts_db-*.dump )
  shopt -u nullglob
  (( ${#dumps[@]} > 0 )) || die "no dumps in $BACKUP_DIR"
  dump="$(printf '%s\n' "${dumps[@]}" | sort | tail -n 1)"
fi
[[ -f "$dump" ]] || die "$dump is not a file"

log "checking $(basename "$dump") ($(stat -c %s "$dump") bytes)"

# -d detaches, --rm removes the container when it stops. The password is
# throwaway and never leaves this machine: nothing outside can reach the server,
# because no port is published.
docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=restore-check \
  -e POSTGRES_DB=restore_check \
  "$PG_IMAGE" >/dev/null

# Removal is the trap's job, so an interrupted or failed run does not leave a
# stray database container behind.
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true' EXIT

log "waiting for the throwaway server"
# -h 127.0.0.1 rather than the default socket, and that is the whole trick: the
# official image starts a temporary server during initialisation which listens
# on the unix socket only. Asking over TCP means "ready" is answered by the real
# server, not by the one that is about to be shut down and restarted.
for _ in $(seq "$READY_TIMEOUT"); do
  docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres -q && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres -q ||
  die "the throwaway server never became ready"

log "restoring"
# -i keeps stdin open so the dump can be piped in; without it the redirection
# below reaches a closed descriptor and pg_restore sees an empty archive.
#
# --no-owner and --no-privileges: the dump names the production role, which does
# not exist here, and without these every ALTER OWNER becomes an error and the
# check fails for a reason that has nothing to do with the data.
docker exec -i "$CONTAINER" \
  pg_restore -U postgres -d restore_check --no-owner --no-privileges < "$dump"

log "what came back:"
docker exec "$CONTAINER" psql -U postgres -d restore_check -c \
  "select version_num as alembic_revision from alembic_version"
docker exec "$CONTAINER" psql -U postgres -d restore_check -c \
  "select 'users' as table_name, count(*) from users
   union all select 'alerts', count(*) from alerts
   union all select 'refresh_tokens', count(*) from refresh_tokens
   order by 1"

log "the dump restores; removing the throwaway server"