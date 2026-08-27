#!/usr/bin/env bash
#
# The weekly copy that leaves the machine. The nightly dumps answer "a bad
# migration ate the data"; this one answers "the VPS is gone" — which no file
# stored on that VPS can answer, however many copies of it there are.
#
# Started by alerts-backup-offsite.timer, and by hand for a test:
#
#     bash /opt/alerts/deploy/backup-offsite.sh

set -Eeuo pipefail

ALERTS_DIR="${ALERTS_DIR:-/opt/alerts}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/alerts}"
CREDENTIALS="${CREDENTIALS:-$ALERTS_DIR/.env.backup}"

# Configuration, not secrets, so it belongs in version control: an endpoint and
# a bucket name are decisions, and keeping them here makes changing either a
# reviewable commit rather than an edit on the server.
S3_ENDPOINT="https://s3.twcstorage.ru"
S3_BUCKET="alerts-backups"
AWSCLI_IMAGE="amazon/aws-cli:2.36.32"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { printf 'backup-offsite: %s\n' "$*" >&2; exit 1; }

[[ -f "$CREDENTIALS" ]] || die "$CREDENTIALS is missing — the S3 keys live there"

# The newest dump, without parsing `ls`. The file names carry an ISO timestamp,
# so lexical order is chronological order — which is the reason the stamp is
# written 20260827T061525Z rather than 27-08-2026.
#
# nullglob makes an unmatched pattern expand to nothing instead of to itself;
# without it an empty directory would produce one "file" literally named
# crypto_alerts_db-*.dump and the error would surface later and stranger.
shopt -s nullglob
dumps=( "$BACKUP_DIR"/crypto_alerts_db-*.dump )
shopt -u nullglob
(( ${#dumps[@]} > 0 )) || die "no dumps in $BACKUP_DIR — has backup.sh ever run?"

newest="$(printf '%s\n' "${dumps[@]}" | sort | tail -n 1)"
key="weekly/$(basename "$newest")"

log "uploading $(basename "$newest") to s3://$S3_BUCKET/$key"

# The credentials never enter this script's environment: docker reads the file
# itself and passes the variables to the container, so a stray `set -x`, an
# error trace or a `ps` cannot show them. Nothing is installed on the host
# either — the CLI is pinned by image tag and disappears with the container.
docker run --rm \
  --env-file "$CREDENTIALS" \
  -v "$newest:/dump:ro" \
  "$AWSCLI_IMAGE" \
  s3 cp /dump "s3://$S3_BUCKET/$key" --endpoint-url "$S3_ENDPOINT"

# "Uploaded" and "is in the bucket" are different claims, and only the second
# one is a backup. Ask the bucket rather than trusting the exit code above.
log "verifying the object is there"
docker run --rm \
  --env-file "$CREDENTIALS" \
  "$AWSCLI_IMAGE" \
  s3 ls "s3://$S3_BUCKET/$key" --endpoint-url "$S3_ENDPOINT"

log "done"