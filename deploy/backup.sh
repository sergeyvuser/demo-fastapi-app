#!/usr/bin/env bash
#
# The nightly database dump, kept on the machine. It answers one disaster — "a
# bad migration ate the data" — and by definition cannot answer the other one,
# "the VPS is gone". That is what backup-offsite.sh is for.
#
# Started by alerts-backup.timer, and by hand for a test:
#
#     bash /opt/alerts/deploy/backup.sh
#
# Travels with every deploy like the compose files do, so the script running
# here always matches the commit in production. Only the systemd units are
# permanent residents, and they merely point at this path.

set -Eeuo pipefail

ALERTS_DIR="${ALERTS_DIR:-/opt/alerts}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/alerts}"
KEEP_DAYS="${KEEP_DAYS:-7}"

# A custom-format dump of this database is tens of kilobytes. A few hundred
# bytes means pg_dump wrote a header and then died — and keeping that is the
# difference between "no backup tonight", which the journal shows, and "a backup
# that restores an empty database", which nothing shows until it matters.
MIN_BYTES=1000

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { printf 'backup: %s\n' "$*" >&2; exit 1; }

dc() {
  docker compose \
    -f "$ALERTS_DIR/compose.yaml" \
    -f "$ALERTS_DIR/deploy/compose.prod.yaml" \
    --env-file "$ALERTS_DIR/.env" \
    --env-file "$ALERTS_DIR/.env.secrets" "$@"
}

[[ -d "$BACKUP_DIR" ]] || die "$BACKUP_DIR does not exist"

cid="$(dc ps -q db)"
[[ -n "$cid" ]] || die "the db service is not running — nothing to dump"

stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
target="$BACKUP_DIR/crypto_alerts_db-$stamp.dump"

log "dumping into $(basename "$target")"

# Two things this line deliberately does not do.
#
# It does not repeat the credentials: the official image exports POSTGRES_USER
# and POSTGRES_DB inside the container, and a connection over the local socket
# needs no password — so the database describes itself and nothing here can
# drift from .env.secrets.
#
# And it does not write to the final name. -Fc is the custom format (compressed,
# and restorable selectively with pg_restore -t, which a plain SQL dump cannot
# do); it is written as .part and renamed afterwards, because rename within one
# filesystem is atomic. A dump interrupted halfway therefore never appears under
# a name that restore-check.sh would pick up as "the newest".
docker exec "$cid" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$target.part"

size="$(stat -c %s "$target.part")"
(( size >= MIN_BYTES )) || { rm -f "$target.part"; die "dump is only $size bytes — refusing to keep it"; }

mv "$target.part" "$target"
# Dumps hold e-mail addresses and password hashes; they are not world-readable.
chmod 600 "$target"
log "wrote $target ($size bytes)"

# Rotation by age rather than by count, because the question a backup answers is
# "how far back can I go", and seven daily dumps answer it directly. -print makes
# the journal say what disappeared instead of leaving it to be inferred.
log "removing dumps older than $KEEP_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'crypto_alerts_db-*.dump' -mtime "+$KEEP_DAYS" -print -delete

log "$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' | wc -l) dumps on disk, $(du -sh "$BACKUP_DIR" | cut -f1) total"
