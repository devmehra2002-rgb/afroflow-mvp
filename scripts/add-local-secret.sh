#!/bin/bash
# Adds one secret to .env.local (which is never committed) without showing it on
# screen and without it ever passing through a chat. Usage:
#   bash scripts/add-local-secret.sh BOLNA_API_KEY
set -e
name="$1"
[ -z "$name" ] && { echo "Usage: bash scripts/add-local-secret.sh NAME"; exit 1; }
cd "$(dirname "$0")/.."
printf "Paste the value for %s (it will not be shown), then press Return: " "$name"
read -r -s value; echo
[ -z "$value" ] && { echo "Nothing entered. Nothing changed."; exit 1; }
touch .env.local
grep -v "^${name}=" .env.local > .env.local.tmp || true
printf '%s="%s"\n' "$name" "$value" >> .env.local.tmp
mv .env.local.tmp .env.local
echo "Saved ${name} in .env.local (${#value} characters)."
