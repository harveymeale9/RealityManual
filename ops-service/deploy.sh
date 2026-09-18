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
IMAGE=rm-ops-service
CONTAINER=rm-ops-service
ENV_FILE="$REPO_DIR/ops-service/.env"

cd "$REPO_DIR"
git pull

# The headless voice-app runner's own working tree (bind-mounted into the
# container at /repo, see CLAUDE.md section 74) does not update itself —
# forgetting this step is the exact regression that section warns about.
git -C "$RUNTIME_REPO_DIR" pull
chown -R 1000:1000 "$RUNTIME_REPO_DIR"

docker build -t "$IMAGE" ./ops-service

docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true

docker run -d --name "$CONTAINER" --restart unless-stopped \
  -p 127.0.0.1:4001:4001 \
  -v /root/ops-service-claude-home/claude-dir:/home/node/.claude \
  -v /root/ops-service-claude-home/claude.json:/home/node/.claude.json \
  -v /root/ops-service-data:/data \
  -v "$RUNTIME_REPO_DIR:/repo" \
  --env-file "$ENV_FILE" \
  "$IMAGE"

echo "rm-ops-service redeployed at $(git -C "$REPO_DIR" rev-parse --short HEAD)"
