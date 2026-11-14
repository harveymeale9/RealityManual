#!/usr/bin/env bash
# OWNER-ONLY: Harvey runs this in his own VPS terminal. The agent must never
# execute it: it generates and installs a new raw credential.
set -euo pipefail
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run with sudo on the VPS.' >&2
  exit 1
fi

WORKER_DIR=/srv/realitymanual-repo/storefront-worker
DEPLOY_ENV=/root/.config/realitymanual-cloudflare/deploy.env
OPS_ENV=/root/realitymanual-repo/ops-service/.env
if [ ! -f "$DEPLOY_ENV" ] || [ ! -f "$OPS_ENV" ]; then
  echo 'Cloudflare deployment settings or ops-service .env is missing.' >&2
  exit 1
fi
if grep -q '^STOREFRONT_REPORT_TOKEN=' "$OPS_ENV"; then
  echo 'A report token is already installed. Stop rather than silently replacing it.' >&2
  exit 1
fi

REPORT_TOKEN="$(openssl rand -hex 32)"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
set -a
. "$DEPLOY_ENV"
set +a
cd "$WORKER_DIR"
printf '%s' "$REPORT_TOKEN" | npx wrangler secret put REPORT_ACCESS_TOKEN --name rm-storefront-api-staging >/dev/null
printf '\nSTOREFRONT_REPORT_TOKEN=%s\n' "$REPORT_TOKEN" >> "$OPS_ENV"
unset REPORT_TOKEN
echo 'Report token installed on the staging Worker and in ops-service .env. Reporting source was not switched.'
