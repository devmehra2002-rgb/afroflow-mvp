#!/usr/bin/env bash
# Stores the Google OAuth client id + secret on Vercel (this project) and in .env.local.
# You type them here; they are never shown on screen and never leave your computer except to Vercel.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -p "Google client ID: " CID
read -r -s -p "Google client secret (hidden): " CSEC; echo
[ -n "$CID" ] && [ -n "$CSEC" ] || { echo "Both are required"; exit 1; }
printf '%s' "$CID"  | npx vercel env add GOOGLE_GMAIL_CLIENT_ID production --yes >/dev/null
printf '%s' "$CSEC" | npx vercel env add GOOGLE_GMAIL_CLIENT_SECRET production --sensitive --yes >/dev/null
printf '\nGOOGLE_GMAIL_CLIENT_ID=%s\nGOOGLE_GMAIL_CLIENT_SECRET=%s\n' "$CID" "$CSEC" >> .env.local
echo "Saved. Now redeploy: npx vercel --prod --yes"
