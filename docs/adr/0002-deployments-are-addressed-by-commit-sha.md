# A deployment is one commit SHA

A deploy takes a 40-character commit SHA and nothing else. Both halves of the running system follow
from it: the images, which CI tags `sha-<short>`, and the compose files, proxy configuration and
observability configuration, which the server downloads as the repository tarball for that same
commit. "What is running?" therefore has one exact answer, and rolling back is the same command with
an earlier SHA.

## Considered options

**Having CI copy the files over** (rsync or scp from the workflow) was the obvious alternative and
was rejected for two reasons. It creates two delivery paths — images from a registry, files from a
workflow — that can silently drift apart, so the server could end up running yesterday's compose file
against today's images with nothing recording the mismatch. And it is incompatible with the way the
delivery key is restricted: the key is bound to a single forced command, which is exactly what makes
a leaked CI secret unable to open a shell, and a forced command consumes scp and rsync.

Fetching the tarball needs no credentials because the repository is public — which is also why no
registry credentials live on the server: the images are public too.

## Consequences

- **A rollback target must be a commit that contains the deploy script.** Commits older than its
  introduction fail with an explicit message rather than a missing-file error.
- **The bootstrap on the server is the one file that does not travel with the commit.** It is the
  forced command's fixed path, so editing it in the repository changes nothing until it is copied
  over by hand — the only place in this design where the server and the repository can drift.
- **Configuration changes need no image rebuild**, but a changed bind-mounted file does not reach a
  running container by itself: the deploy hashes the configuration set before and after and recreates
  the services whose files actually changed.
