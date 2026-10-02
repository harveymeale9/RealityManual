#!/usr/bin/env bash
# Redeploys rm-ops-service on the VPS: pulls both repo clones, rebuilds the
# image, and recreates the container with the exact bind mounts/port/restart
# policy confirmed live via `docker inspect rm-ops-service` on 2026-09-18.
# Run this directly on the VPS as root (or let .github/workflows/
# deploy-ops-service.yml run it automatically via SSH on every push to
# main that touches ops-service/**, or via its workflow_dispatch button).
# Auto-deploy went live 2026-09-18 once VPS_SSH_KEY was added as a repo
# secret.
set -euo pipefail

REPO_DIR=/root/realitymanual-repo
RUNTIME_REPO_DIR=/srv/realitymanual-repo
DATA_DIR=/root/ops-service-data
IMAGE=rm-ops-service
CONTAINER=rm-ops-service
ENV_FILE="$REPO_DIR/ops-service/.env"

# Everything below is tee'd into a log file on the host, which is also the
# bind-mounted /data directory of whatever rm-ops-service container ends up
# running (old or new) — so a later Project Manager session (this script's own
# CI step included) can just read /data/last-deploy.log directly off the
# live filesystem instead of needing GitHub's Actions log-download API,
# which requires an "Administration" repo permission this token may or may
# not have and isn't worth fighting with for something this simple.
mkdir -p "$DATA_DIR"
LOG_FILE="$DATA_DIR/last-deploy.log"
exec > >(tee "$LOG_FILE") 2>&1
set -x

RUN_ARGS=(-d --name "$CONTAINER" --restart unless-stopped
  -p 127.0.0.1:4001:4001
  --add-host=host.docker.internal:host-gateway
  # Agent credentials remain host-side; the service mounts only its data,
  # shared repositories, and the scoped SSH key used by the Codex runner.
  # Do not add provider-specific home or credential mounts here.
  -v "$DATA_DIR:/data"
  # Aggregate weekly reporting reads this separate service's SQLite files but
  # must never be able to alter order, customer, or analytics data.
  -v /root/realitymanual-backend-data:/store-data:ro
  -v "$RUNTIME_REPO_DIR:/repo"
  -v /root/pm-ssh-key/pm_host_access:/home/node/.ssh/id_ed25519:ro
  --env-file "$ENV_FILE")

fail() { echo "DEPLOY FAILED: $*"; exit 1; }

cd "$REPO_DIR" || fail "cannot cd into $REPO_DIR"
# REPO_DIR doubles as an interactive root session's own working copy (see
# CLAUDE.md section on the voice app), so it can legitimately have
# uncommitted local edits sitting in it when this script runs unattended
# from CI. A plain `git pull` aborts outright when that happens, which
# silently wedges every single auto-deploy until someone notices and
# manually intervenes — auto-stash instead so the deploy always proceeds;
# nothing is discarded, just parked in the stash list for whoever left it
# there to recover with `git stash pop` later.
if [ -n "$(git status --porcelain)" ]; then
  echo "local changes present in $REPO_DIR — auto-stashing before pull"
  git stash push -u -m "deploy.sh auto-stash $(date -u +%FT%TZ)" || fail "could not stash local changes in $REPO_DIR"
fi
# CI also commits its deployment log back to main. Make the intended history
# rule explicit: deploy checkouts only fast-forward to origin/main and never
# synthesize a merge commit or depend on host-global pull.rebase settings.
git fetch origin main || fail "git fetch failed in $REPO_DIR"
git merge --ff-only origin/main || fail "git fast-forward failed in $REPO_DIR"
NEW_HEAD="$(git rev-parse HEAD)"

# The headless voice-app runner's own working tree (bind-mounted into the
# container at /repo, see CLAUDE.md section 74) does not update itself —
# forgetting this step is the exact regression that section warns about.
# This alone is what makes ops-service/public/** changes show up live —
# server.js now serves that directory straight out of $RUNTIME_REPO_DIR
# rather than a copy baked into the Docker image (see the section below on
# skipping the rebuild).
git -C "$RUNTIME_REPO_DIR" fetch origin main || fail "git fetch failed in $RUNTIME_REPO_DIR"
git -C "$RUNTIME_REPO_DIR" merge --ff-only origin/main || fail "git fast-forward failed in $RUNTIME_REPO_DIR"
chown -R 1000:1000 "$RUNTIME_REPO_DIR"

# Rebuilding/restarting the container kills whatever Project Manager
# voice/chat turn is running inside it mid-task (§88/§76 in CLAUDE.md) —
# real problem, hit repeatedly on 2026-09-18 while the PM burned through a
# long to-do list of ops-service/public/** tweaks and kept killing its own
# in-flight turn on every single commit. Since server.js now serves
# ops-service/public/ live out of $RUNTIME_REPO_DIR (just pulled above, no
# rebuild needed for it to take effect), the only pushes that genuinely
# need the Node process to reload code are ones touching the *backend*:
# server.js itself, src/, the Dockerfile, or the dependency lockfiles.
#
# Compared against the commit the *currently running image was actually
# built from* (recorded below after every real rebuild), not against
# whatever this particular `git pull` happened to change — REPO_DIR
# doubles as an interactive session's own working copy (see above), so it
# can already be sitting ahead of the last deploy before this script's
# pull even runs (e.g. a session committed+pushed directly from this same
# checkout), which would make an old-HEAD/new-HEAD comparison see "no
# change" and wrongly skip a rebuild that's actually still owed. This file
# lives in $DATA_DIR so it survives every container recreation.
LAST_BUILD_FILE="$DATA_DIR/last-image-commit.txt"
LAST_BUILD_COMMIT="$(cat "$LAST_BUILD_FILE" 2>/dev/null || true)"
NEEDS_REBUILD=1
if [ -n "$LAST_BUILD_COMMIT" ] && git cat-file -e "${LAST_BUILD_COMMIT}^{commit}" 2>/dev/null; then
  if [ -z "$(git diff --name-only "$LAST_BUILD_COMMIT" "$NEW_HEAD" -- \
    ops-service/server.js ops-service/src ops-service/package.json \
    ops-service/package-lock.json ops-service/Dockerfile ops-service/deploy.sh)" ]; then
    NEEDS_REBUILD=0
  fi
fi

if [ "${FORCE_RECREATE:-0}" = "1" ]; then
  echo "FORCE_RECREATE=1 — rebuilding/recreating even though the current commit may already be live"
  NEEDS_REBUILD=1
fi

if [ "$NEEDS_REBUILD" = "0" ]; then
  echo "no backend changes between $LAST_BUILD_COMMIT and $NEW_HEAD — already live via git pull, skipping rebuild/restart"
  exit 0
fi

# Snapshot whatever is currently tagged $IMAGE (the build about to be
# replaced) *before* rebuilding overwrites that tag, so a bad new container
# can be rolled back automatically instead of leaving the site (and this
# very runner) down until someone notices.
docker tag "$IMAGE" "${IMAGE}:previous" 2>/dev/null || true

docker build -t "$IMAGE" ./ops-service || fail "docker build failed — old container left untouched"

docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true

if docker run "${RUN_ARGS[@]}" "$IMAGE"; then
  echo "$NEW_HEAD" > "$LAST_BUILD_FILE"
  echo "rm-ops-service redeployed at $(git -C "$REPO_DIR" rev-parse --short HEAD)"
  # Every successful rebuild replaces the unversioned rm-ops-service tag and
  # otherwise leaves the old 3+ GB image dangling. Frequent Editor iteration
  # accumulated 108 unreferenced images and pushed the VPS to 96% disk use.
  # Keep the explicitly tagged one-step rollback image and every active
  # container image, but remove only dangling layers; cap unused builder cache
  # without ever making cleanup failure turn a healthy deploy into an outage.
  docker image prune -f || echo "warning: dangling image cleanup failed"
  docker builder prune -f --max-used-space 8GB || echo "warning: build-cache cleanup failed"
else
  echo "docker run failed on the new image — rolling back to the previous one"
  docker rm -f "$CONTAINER" 2>/dev/null || true
  if docker image inspect "${IMAGE}:previous" >/dev/null 2>&1; then
    docker run "${RUN_ARGS[@]}" "${IMAGE}:previous" \
      && echo "rolled back successfully — service is back up on the previous build" \
      || echo "ROLLBACK ALSO FAILED — service is down, needs manual attention"
  else
    echo "no previous image to roll back to — service is down, needs manual attention"
  fi
  fail "new container failed to start; see rollback outcome above"
fi
