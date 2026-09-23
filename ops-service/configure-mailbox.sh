#!/usr/bin/env bash
# One-time host-side setup for the Namecheap app password. This deliberately
# prompts interactively so the credential never appears in shell history,
# command arguments, git, or an agent transcript.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: sudo /root/realitymanual-repo/ops-service/configure-mailbox.sh"
  exit 1
fi

REPO_DIR=/root/realitymanual-repo
ENV_FILE="$REPO_DIR/ops-service/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

read -r -s -p "Paste the Namecheap app password for info@realitymanual.com: " MAILBOX_SECRET
echo
if [ -z "$MAILBOX_SECRET" ]; then
  echo "No password entered; nothing changed."
  exit 1
fi
if [[ "$MAILBOX_SECRET" == *$'\n'* || "$MAILBOX_SECRET" == *$'\r'* ]]; then
  echo "The password contained an invalid line break; nothing changed."
  exit 1
fi

upsert_env() {
  local key="$1" value="$2" temp_file
  temp_file="$(mktemp "${ENV_FILE}.mailbox.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    index($0, key "=") == 1 { print key "=" value; found=1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$temp_file"
  chmod --reference="$ENV_FILE" "$temp_file"
  chown --reference="$ENV_FILE" "$temp_file"
  mv "$temp_file" "$ENV_FILE"
}

upsert_env MAILBOX_ADDRESS info@realitymanual.com
upsert_env MAILBOX_DISPLAY_NAME "Reality Manual Support"
upsert_env MAILBOX_APP_PASSWORD "$MAILBOX_SECRET"
unset MAILBOX_SECRET

echo "Mailbox settings saved. Recreating Content Studio so it can connect…"
FORCE_RECREATE=1 "$REPO_DIR/ops-service/deploy.sh"
echo "Mailbox configuration complete."
