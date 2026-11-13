#!/usr/bin/env bash
#
# Puts one commit into production. Runs from the unpacked tarball of that very
# commit, so this file always matches the images it starts and the compose files
# it copies. Invoked by the bootstrap, not by hand:
#
#     deploy.sh <40-hex sha> <unpacked-tarball-dir>
#
# Written against ticket 08's deploy rather than an imagined one. The order —
# configuration, then pull, then up — is from there: keeping the pull separate
# makes "did not download" and "did not start" two different events.
#
# Needs no elevated privileges: /opt/alerts is owned by the deploy user and that
# user is in the docker group. sudo on this server asks for a password, so a
# script that needed it could not run unattended anyway.

set -Eeuo pipefail   # -E so the ERR trap survives into functions

sha="${1:?deploy.sh: missing commit sha}"
src="${2:?deploy.sh: missing source directory}"
target="${ALERTS_DIR:-/opt/alerts}"

# docker/metadata-action is configured as type=sha,format=short in ci.yml, and
# short means seven. If that ever changes, this line is the other half of it.
tag="sha-${sha:0:7}"
wait_timeout="${DEPLOY_WAIT_TIMEOUT:-180}"
# Our own images. Everything else in the stack is a pinned third-party tag,
# and the distinction matters in the pull phase below.
registry="ghcr.io/sergeyvuser/demo-fastapi-app"

# Where the narrative got to. The ERR trap reads it, so a failure report starts
# with the phase that produced it instead of leaving the reader to infer it.
current_phase="0/5  preflight"

phase() { current_phase="$*"; log "phase $*"; }

# Exactly the files that travel to the server. Everything else stays in the
# tarball: the server runs the stack, it does not build it, and it keeps no
# secrets generator next to the secrets.
CONFIG_PATHS=(
  compose.yaml
  deploy/compose.prod.yaml
  deploy/Caddyfile
  deploy/backup.sh
  deploy/backup-offsite.sh
  deploy/restore-check.sh
  observability
)

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }

# Both env files, always: --env-file feeds ${...} substitution inside the YAML,
# and .env alone would leave every infrastructure password undefined. Note what
# is NOT here: COMPOSE_PROFILES. Mailpit and pgAdmin sit behind a profile, and
# exporting it would deploy a mail catcher into production.
dc() {
  docker compose -f compose.yaml -f deploy/compose.prod.yaml \
    --env-file .env --env-file .env.secrets "$@"
}

# --- preflight ---------------------------------------------------------------

[[ -d "$src" ]] || die "$src does not exist"
[[ -d "$target" ]] || die "$target does not exist"
cd "$target"
[[ -f .env ]] || die "no .env in $target"
[[ -f .env.secrets ]] || die "no .env.secrets in $target — run deploy/gen-secrets.sh first"
docker compose version >/dev/null 2>&1 || die "docker compose is not available"

# --- helpers -----------------------------------------------------------------

# hash_path <root> <relative path> — the content of a file or a whole tree,
# hashed relative to <root> so that the copy in the tarball and the copy on the
# server are comparable.
#
# It exists to answer one question the deploy cannot otherwise answer: did this
# configuration file change? A bind mount follows the inode, so replacing the
# file underneath a running container changes nothing until the container is
# recreated — while `up -d` compares service definitions, sees no difference and
# leaves it alone. Without this, a Caddyfile fix would ship, not apply, and the
# deploy would report success.
hash_path() {
  local root="$1" rel="$2"
  [[ -e "$root/$rel" ]] || { printf 'absent'; return 0; }
  ( cd "$root" && find "$rel" -type f -exec sha256sum {} + | sort -k 2 | sha256sum | cut -d ' ' -f 1 )
}

# write_env <image tag> <previous tag> <status>
# Truncates in place, which is why the file keeps mode 664 and its owner: it is
# rewritten, never recreated, so no umask and no chmod are involved.
write_env() {
  cat > .env <<EOF
# Written by deploy/deploy.sh — the next deploy overwrites this file whole.
# Editing it by hand changes production only until then.
IMAGE_TAG=$1
PREVIOUS_IMAGE_TAG=$2
LAST_DEPLOY_STATUS=$3
EOF
}

# The rendered top-level `networks:` block, hashed. Compose cannot apply a
# change to a network under a running stack: it recreates the network and
# reconnects the running containers without their service names, and every
# lookup of `db`, `redis`, `rabbitmq` fails (2026-11-02, deploy of 27efd15).
# Compose's own record of the network (a config-hash label) is not reachable
# from here, so the deploy keeps its own: the fingerprint of the last network
# configuration that came up healthy, in .deploy.networks.
networks_fingerprint() {
  dc config | awk '/^networks:/ { inside = 1; print; next } /^[^ ]/ { inside = 0 } inside' \
    | sha256sum | cut -d ' ' -f 1
}

# One line per container: service, status, health, exit code, restarts, OOM.
# `docker inspect` rather than `compose ps --format json` — the JSON shape
# changed between compose versions, the inspect template did not, and it needs
# no jq, which this server has not got.
container_states() {
  local ids
  ids="$(dc ps --all -q)" || return 0
  [[ -n "$ids" ]] || return 0
  # $ids is a newline-separated list of ids and is meant to split into separate
  # arguments — the one place in this script where splitting is the point.
  # shellcheck disable=SC2086
  docker inspect --format \
    '{{index .Config.Labels "com.docker.compose.service"}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.ExitCode}} {{.RestartCount}} {{.State.OOMKilled}}' \
    $ids
}

# Every shape a healthy stack is allowed to take. A new case goes here, as one
# line, instead of another branch in the reporting loop below.
container_is_ok() {
  local state="$1" health="$2" code="$3"
  case "$state:$health:$code" in
    running:healthy:*) return 0 ;;   # has a healthcheck and passes it
    running:none:*)    return 0 ;;   # no healthcheck — running is all we know
    exited:none:0)     return 0 ;;   # one-shot done: migrate, seed-demo
    *)                 return 1 ;;   # unhealthy, starting, restarting, exited non-zero
  esac
}

# Printed by the ERR trap, so a failed delivery log answers "what broke" without
# a second SSH session.
diagnose() {
  printf '\n'
  log "DEPLOY FAILED in phase $current_phase — stack state follows"
  dc ps --all || true

  local states name state health code restarts oom failed=0
  states="$(container_states)"
  [[ -n "$states" ]] || return 0

  # A here-string, not a process substitution: the loop then runs in this shell,
  # so the counter below survives it.
  while read -r name state health code restarts oom; do
    container_is_ok "$state" "$health" "$code" && continue
    failed=$(( failed + 1 ))
    printf '\n'
    log "--- $name: $state, health=$health, exit=$code, restarts=$restarts, oom-killed=$oom"
    dc logs --tail 50 "$name" || true
  done <<< "$states"

  printf '\n'
  if (( failed == 0 )); then
    # The honest reading of a failure with nothing unhealthy: the deploy died
    # before it touched the stack — a bad tag, an unreachable registry, a
    # missing file. What is running above is the previous version, still fine.
    log "no service is unhealthy — the stack was never changed; the cause is above this report"
  else
    log "$failed service(s) not healthy"
  fi
}
trap diagnose ERR

# --- 1. configuration --------------------------------------------------------

log "deploying $sha as $tag"
phase "1/5  configuration"

caddy_before="$(hash_path "$target" deploy/Caddyfile)"
obs_before="$(hash_path "$target" observability)"

for path in "${CONFIG_PATHS[@]}"; do
  [[ -e "$src/$path" ]] || die "commit $sha does not contain $path"
done
for path in "${CONFIG_PATHS[@]}"; do
  # Replace, do not merge: a file deleted in the repository has to disappear
  # here too, or the server keeps a scrape target that exists in no commit.
  mkdir -p "$(dirname "$path")"
  rm -rf "$path"
  cp -r "$src/$path" "$path"
done

caddy_after="$(hash_path "$target" deploy/Caddyfile)"
obs_after="$(hash_path "$target" observability)"

# --- 2. image tag ------------------------------------------------------------

phase "2/5  image tag $tag"

# Read, never source. Sourcing a file to get three values out of it grants that
# file the right to run code, and this one is written by a machine.
env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }
# What is actually running, asked of the running system instead of a file
# this script wrote itself. The api container is the witness: every application
# service shares IMAGE_TAG, and api is the one the site depends on.
#
# The file cannot answer this honestly, by design. A failed deploy leaves its
# attempted tag in .env — that is what writing it pessimistically means — so
# after a failure .env names a version that never ran, and the next deploy would
# take that for the rollback target. Measured rather than reasoned: the failed
# manual run of sha-5889ecb cost PREVIOUS_IMAGE_TAG one generation before this
# function existed.
running_image_tag() {
  local cid image
  cid="$(dc ps -q api)" || return 0
  [[ -n "$cid" ]] || return 0
  image="$(docker inspect --format '{{.Config.Image}}' "$cid")" || return 0
  printf '%s' "${image##*:}"
}
running_tag="$(running_image_tag)"
previous_tag="$(env_value PREVIOUS_IMAGE_TAG)"

# Pessimistic on purpose: from here until the stack is healthy, this deploy is a
# failure. A timeout, a dropped connection or a kill therefore leaves
# LAST_DEPLOY_STATUS=failed behind — the state that is true — instead of a file
# claiming a success that never happened.
write_env "$tag" "$previous_tag" failed

# --- 3. pull -----------------------------------------------------------------

phase "3/5  pull"

# Deliberately not `dc pull`, which asks the registries about all fifteen
# images. Seven of those come from Docker Hub, which since 2025 refuses more
# than ten anonymous manifest requests per hour per IP — so two deploys inside
# an hour is enough to be turned away with a 429 halfway through a release.
# That happened on 2026-08-28, and every image it was refused for was pinned
# to an exact tag and already sitting on this disk.
#
# Narrowing it loses nothing. These three change on every deploy and are the
# whole reason this phase is separate from `up`; the pinned ones change a few
# times a year, and `up` below fetches any image genuinely missing. The cost
# is that on a brand-new server the third-party images arrive during `up`
# instead, which blurs "did not download" into "did not start" exactly once,
# on a machine where someone is watching anyway.
app_images="$(dc config --images | grep "^$registry/" | sort -u || true)"
[[ -n "$app_images" ]] || die "no $registry images in the rendered configuration"

# A here-string, not a pipe: a pipeline runs the loop body in a subshell, and
# a failure there would not stop this script.
while read -r image; do
  log "  $image"
  docker pull -q "$image"
done <<< "$app_images"

# --- 4. up -------------------------------------------------------------------

phase "4/5  up"

# A changed network takes the whole stack down first, so that `up` creates the
# network and every container on it from scratch, names included. A minute of
# downtime, on the rare deploy that changes a network. Volumes are untouched:
# `down` without -v removes containers and networks only. No record yet (the
# first deploy with this check) means no comparison: the network running now is
# the one the previous commit asked for.
networks_now="$(networks_fingerprint)"
networks_last="$(cat .deploy.networks 2>/dev/null || true)"
if [[ -n "$networks_last" && "$networks_now" != "$networks_last" ]]; then
  log "  network configuration changed — taking the stack down so it is recreated whole"
  dc down
fi

# The two services whose configuration can change without their image changing.
# Recreated before the main `up` rather than after, so the single wait below
# covers them too. --no-deps: this is a targeted recreation, not a restart of
# everything that happens to be nearby.
if [[ "$caddy_after" != "$caddy_before" ]]; then
  log "  Caddyfile changed — recreating caddy"
  dc up -d --force-recreate --no-deps caddy
fi
if [[ "$obs_after" != "$obs_before" ]]; then
  log "  observability configuration changed — recreating prometheus, grafana"
  dc up -d --force-recreate --no-deps prometheus grafana
fi

# Migrations and demo seeding are part of this, not steps of their own: they are
# one-shot services the application services wait on, and a step in a script is
# a step someone can skip by typing `up -d` by hand. Both re-run on every deploy
# because IMAGE_TAG changed, which is what recreates them.
#
# Deliberately no --remove-orphans: profile-gated services (mailpit, pgadmin)
# are orphans by definition in this file set, and a deploy is the wrong moment
# to find out what else that flag considers one.
dc up -d --wait --wait-timeout "$wait_timeout"

# --- 5. record ---------------------------------------------------------------

phase "5/5  recording the result"

# The rollback target is the version that was serving traffic when this deploy
# started, and only when it differs from what is being deployed: redeploying the
# same commit must not make the field point at itself.
#
# What this field does NOT promise is that the tag it names is the newest
# healthy release. It is one step of undo. Deploy an old commit by hand — a
# rollback drill, a bisect, an experiment — and the next deploy will record that
# old commit as the way back: correct, and unhelpful. The list of versions that
# actually ran in production is the repository's Deployments panel and the GHCR
# tags; consult it before rolling back to whatever this file happens to say.
if [[ -n "$running_tag" && "$running_tag" != "$tag" ]]; then
  previous_tag="$running_tag"
fi
write_env "$tag" "$previous_tag" ok

# Only now, with the stack healthy: a failed deploy must leave the old record,
# so the next attempt still sees the network as changed.
printf '%s\n' "$networks_now" > .deploy.networks

log "deployed $tag — rollback target is ${previous_tag:-none}"

# --- after the record: smoke check -------------------------------------------
#
# The first check of any kind that the deploy sees the product the way a
# visitor does. `up --wait` waits only on healthchecks, and the demo seeder
# deliberately has no completion condition, so until now a seeder that exited 1
# left a green deploy behind it (stage 12 did exactly that).
#
# It runs after the record on purpose. From here a failure cannot roll back,
# cannot touch PREVIOUS_IMAGE_TAG and cannot hold up a release: it only exits
# non-zero, which turns the CI job red. The site stands, the pipeline burns, a
# human fixes it. It lives in this script rather than beside the e2e job
# because not every deploy comes through the pipeline — the dispatch rollback
# and a human over ssh run this file too.
#
# What it does not promise: it is true at deploy time, not continuously.

# The ERR trap reports a stack that did not come up, and this one just did.
# Left armed, it would print DEPLOY FAILED over a recorded deploy and dump the
# state of containers that --wait has just called healthy.
trap - ERR

# The address a visitor uses, taken from the file that configures it, so the
# check cannot drift from the site it is checking.
public_url="$(sed -n 's/^ *APP_CONFIG__RUN__PUBLIC_URL: *//p' deploy/compose.prod.yaml)"

smoke_fail() { log "SMOKE FAILED: $*"; exit 1; }

[[ -n "$public_url" ]] || smoke_fail "no APP_CONFIG__RUN__PUBLIC_URL in deploy/compose.prod.yaml"

smoke_dir="$(mktemp -d)"
trap 'rm -rf "$smoke_dir"' EXIT
body="$smoke_dir/body"
cookies="$smoke_dir/cookies"
: > "$cookies"

# smoke <step> <expected status> <path> [extra curl options...]
#
# One request through the public URL, with a cookie jar shared between calls the
# way a browser shares one: login sets the refresh cookie, logout sends it back.
# The response body is left in $body for the caller to look into.
smoke() {
  local step="$1" expected="$2" path="$3" status
  shift 3
  # -w prints the status even when the connection fails (as 000), but curl then
  # exits non-zero, and under set -e that would end the script with no message.
  status="$(curl -sS --max-time 15 -o "$body" -w '%{http_code}' \
    -c "$cookies" -b "$cookies" "$@" "$public_url$path")" || status="${status:-000}"
  [[ "$status" == "$expected" ]] \
    || smoke_fail "$step: expected HTTP $expected, got $status: $(head -c 300 "$body" 2>/dev/null)"
  log "smoke: $step — $status"
}

# json_field <name> — a string field of the last response body. sed, not jq:
# this server has no jq. Good enough for FastAPI's compact JSON and for values
# without quotes in them, which is all this check reads.
json_field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$body"; }

log "smoke check against $public_url"

# Nobody had ever checked that the server serves the bundle after this script
# runs. A 200 alone is not enough: an error page is a 200 too.
smoke "app shell" 200 /
grep -q '<div id="root">' "$body" \
  || smoke_fail "app shell: GET / answered 200, but not with the app's page"

# The same request the Landing page makes, and the pair it publishes is the pair
# that is tried below — so the check covers the whole claim "the published
# credentials open the account", not just "the endpoint answers".
smoke "demo account" 200 /api/v1/demo
if grep -q '"enabled":false' "$body"; then
  log "smoke: the demo account is disabled in this deployment, nothing to sign in with"
  log "smoke check passed"
  exit 0
fi
demo_email="$(json_field email)"
demo_password="$(json_field password)"
[[ -n "$demo_email" && -n "$demo_password" ]] \
  || smoke_fail "demo account: enabled, but the answer carries no credentials"

smoke "sign in as $demo_email" 200 /api/v1/auth/login \
  --data-urlencode "username=$demo_email" --data-urlencode "password=$demo_password"
access_token="$(json_field access_token)"
[[ -n "$access_token" ]] || smoke_fail "sign in: 200 without an access token"

# Sign out with the refresh cookie from the jar, so the check leaves no session
# row behind on an account every visitor shares.
smoke "sign out" 204 /api/v1/auth/logout \
  -X POST -H "Authorization: Bearer $access_token"

log "smoke check passed"
