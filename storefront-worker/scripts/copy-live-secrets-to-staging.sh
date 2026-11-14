#!/usr/bin/env bash
# Harvey runs this himself. Never run it from an unattended agent session:
# the project's raw-credential boundary reserves secret writes for the owner.
set -euo pipefail

worker_name=rm-storefront-api-staging
cloudflare_auth=/root/.config/realitymanual-cloudflare/deploy.env
storefront_env=/root/realitymanual-repo/backend/.env

if [[ $(id -u) -ne 0 ]]; then
  echo 'Run this script as root with sudo.' >&2
  exit 1
fi
if [[ ! -f "$cloudflare_auth" || ! -f "$storefront_env" ]]; then
  echo 'Expected private Cloudflare and storefront env files were not found.' >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$cloudflare_auth"
set +a

if [[ -z ${CLOUDFLARE_ACCOUNT_ID:-} || -z ${CLOUDFLARE_API_TOKEN:-} ]]; then
  echo 'Cloudflare account ID or token is missing.' >&2
  exit 1
fi

cd /srv/realitymanual-repo/storefront-worker

for secret_name in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET BOOKVAULT_API_KEY RESEND_API_KEY; do
  echo "Transferring $secret_name to disabled staging Worker..."
  RM_SECRET_NAME="$secret_name" node --env-file="$storefront_env" \
    -e 'const value = process.env[process.env.RM_SECRET_NAME]; if (!value) process.exit(2); process.stdout.write(value)' \
    | npx --yes wrangler@latest secret put "$secret_name" --name "$worker_name" >/dev/null
done

echo 'Cloudflare reports these secret names (values remain hidden):'
npx --yes wrangler@latest secret list --name "$worker_name"
