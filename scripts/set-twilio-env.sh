#!/usr/bin/env bash
# Stores the Twilio WhatsApp settings on the Vercel project in this folder and in .env.local.
# The Auth Token is typed hidden and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -p "Twilio Account SID (starts with AC): " SID
read -r -s -p "Twilio Auth Token (hidden): " TOKEN; echo
read -r -p "Twilio sandbox WhatsApp number (digits, e.g. 14155238886): " FROMNUM
read -r -p "Owner's own WhatsApp number with country code, digits only (e.g. 919876543210): " OWNER
[ -n "$SID" ] && [ -n "$TOKEN" ] && [ -n "$FROMNUM" ] && [ -n "$OWNER" ] || { echo "All four are required"; exit 1; }
FROMNUM=$(printf '%s' "$FROMNUM" | tr -cd '0-9'); OWNER=$(printf '%s' "$OWNER" | tr -cd '0-9')
setvar() { # name value sensitive(s|n)
  local flag=""; [ "$3" = "s" ] && flag="--sensitive"
  if ! printf '%s' "$2" | npx vercel env add "$1" production $flag --yes >/dev/null 2>&1; then
    printf '%s' "$2" | npx vercel env update "$1" production $flag --yes >/dev/null
  fi
  python3 - "$1" "$2" <<'PY'
import re,sys
p=".env.local"; s=open(p).read(); k,v=sys.argv[1],sys.argv[2]
s = re.sub(r"(?m)^"+k+"=.*$", k+"="+v, s) if re.search(r"(?m)^"+k+"=", s) else s.rstrip("\n")+"\n"+k+"="+v+"\n"
open(p,"w").write(s)
PY
  echo "set $1"
}
setvar WHATSAPP_PROVIDER twilio n
setvar TWILIO_ACCOUNT_SID "$SID" n
setvar TWILIO_AUTH_TOKEN "$TOKEN" s
setvar TWILIO_WHATSAPP_FROM "$FROMNUM" n
setvar OWNER_WHATSAPP "$OWNER" n
echo
echo "Next: redeploy (npx vercel --prod --yes), then in Twilio set the sandbox 'When a message comes in' URL to:"
echo "  https://afroflow-login.vercel.app/api/whatsapp/twilio   (method POST)"
