#!/usr/bin/env bash
#
# Installed on the server as /opt/alerts/deploy.sh and nowhere else. Ticket 12
# forces it as the delivery key's only command, which makes it a permanent
# resident — so it is deliberately the smallest thing that can still be one:
# validate the argument, fetch the commit, hand over to the deploy script that
# travels inside it.
#
#     /opt/alerts/deploy.sh <40-hex commit sha>
#
# Everything that decides *how* production is brought up lives in
# deploy/deploy.sh of the commit being deployed, so it is versioned together
# with the images it starts. This file is not: editing it in the repository
# changes nothing until it is copied over by hand, which is the price of having
# a fixed path for the forced command. Keep it boring.

set -euo pipefail

REPO="sergeyvuser/demo-fastapi-app"
ALERTS_DIR="${ALERTS_DIR:-/opt/alerts}"

die() { printf 'deploy: %s\n' "$1" >&2; exit 2; }

# The SHA arrives as an argument by hand, and as SSH_ORIGINAL_COMMAND from CI:
# a forced command replaces whatever the client asked to run, and the original
# request survives only in that variable.
sha="${1:-${SSH_ORIGINAL_COMMAND:-}}"

# This string is the one piece of attacker-controlled input on the whole path —
# whoever holds the delivery key chooses it — and it goes on to become part of a
# URL and a directory name. Hence a whitelist, not a sanitiser: 40 lowercase hex
# characters and nothing else. It is never eval'd, never word-split, and only
# ever quoted. The echo back is truncated because the rejected value is printed
# into a CI log.
[[ -n "$sha" ]] || die "usage: deploy.sh <40-hex commit sha>"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "not a full commit sha: '${sha:0:64}'"

# One deploy at a time. Continuous delivery on push and a manual dispatch for a
# rollback can arrive within seconds of each other, and two `compose up` runs in
# the same project interleave into a state neither of them intended. -n rather
# than a wait: the second deploy is not something to queue, it is something to
# refuse and re-run once the first has reported.
exec 9>"$ALERTS_DIR/.deploy.lock" || die "cannot write to $ALERTS_DIR"
flock -n 9 || die "another deploy is already running"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf 'deploy: fetching %s at %s\n' "$REPO" "$sha"

# The repository is public, so no credentials are involved anywhere in the
# delivery path — that was the whole reason to make it public. The archive root
# carries the FULL sha (demo-fastapi-app-<40 hex>/), so strip the component
# instead of reconstructing the name; GitHub generates it with no autocrlf
# involved, so it is LF regardless of who pushed.
if ! curl -fsSL --retry 3 --retry-connrefused --max-time 120 \
     "https://codeload.github.com/$REPO/tar.gz/$sha" \
     | tar -xz -C "$tmp" --strip-components=1; then
  die "could not fetch $sha — is it pushed to $REPO?"
fi

# The rollback trap, and the reason it is checked explicitly: every commit older
# than this one is a valid deploy target by every other measure — its images are
# in the registry — and contains no deploy script at all.
[[ -f "$tmp/deploy/deploy.sh" ]] ||
  die "commit $sha has no deploy/deploy.sh (it predates the deploy script) — roll back to a newer commit"

# Not exec: the trap above still has a temporary directory to remove. The exit
# status of this last command becomes the exit status of the deploy, which is
# what the delivery workflow reads.
bash "$tmp/deploy/deploy.sh" "$sha" "$tmp"
