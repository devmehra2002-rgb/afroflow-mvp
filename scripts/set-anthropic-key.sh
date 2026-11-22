#!/usr/bin/env bash
# Stores a new Anthropic API key on the Vercel project in this folder and in .env.local.
# Typed hidden; never printed.
set -euo pipefail
cd "$(dirname "$0")/.."
read -r -s -p "New Anthropic API key (hidden): " KEY; echo
[ -n "$KEY" ] || { echo "Key required"; exit 1; }
npx vercel env rm ANTHROPIC_API_KEY production --yes >/dev/null 2>&1 || true
printf '%s' "$KEY" | npx vercel env add ANTHROPIC_API_KEY production --sensitive --yes >/dev/null
python3 - "$KEY" <<'PY'
import re,sys
p=".env.local"; s=open(p).read(); k=sys.argv[1]
s = re.sub(r"(?m)^ANTHROPIC_API_KEY=.*$", "ANTHROPIC_API_KEY="+k, s) if re.search(r"(?m)^ANTHROPIC_API_KEY=", s) else s.rstrip("\n")+"\nANTHROPIC_API_KEY="+k+"\n"
open(p,"w").write(s)
PY
echo "Saved on Vercel (staging) and in .env.local. Now redeploy."
