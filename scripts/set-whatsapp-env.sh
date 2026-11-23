#!/usr/bin/env bash
# Stores the WhatsApp (Meta) settings on the Vercel project in this folder and in .env.local.
# Secrets are typed hidden and never printed. A webhook verify token is generated and shown once, here, for you to paste into Meta.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -p "Phone number ID (from Meta, digits): " PNID
read -r -p "Owner's WhatsApp number with country code, digits only (e.g. 919876543210): " OWNER
read -r -s -p "Access token (hidden): " TOKEN; echo
read -r -s -p "App secret (hidden): " APPSEC; echo
[ -n "$PNID" ] && [ -n "$OWNER" ] && [ -n "$TOKEN" ] && [ -n "$APPSEC" ] || { echo "All four are required"; exit 1; }
OWNER=$(printf '%s' "$OWNER" | tr -cd '0-9')
VERIFY=$(python3 -c "import secrets;print(secrets.token_hex(16))")
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
setvar WHATSAPP_PHONE_NUMBER_ID "$PNID" n
setvar OWNER_WHATSAPP "$OWNER" n
setvar WHATSAPP_TOKEN "$TOKEN" s
setvar WHATSAPP_APP_SECRET "$APPSEC" s
setvar WHATSAPP_VERIFY_TOKEN "$VERIFY" s
echo
echo "Paste this into Meta's webhook 'Verify token' box:  $VERIFY"
echo "Then redeploy: npx vercel --prod --yes"
