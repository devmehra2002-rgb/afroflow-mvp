#!/bin/bash
# Looks up your Bolna agent's ID using the BOLNA_API_KEY already saved in .env.local,
# and saves it as BOLNA_AGENT_ID. The key is never printed. Usage:
#   bash scripts/find-bolna-agent.sh
set -e
cd "$(dirname "$0")/.."
key=$(grep '^BOLNA_API_KEY=' .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
[ -z "$key" ] && { echo "No BOLNA_API_KEY in .env.local yet. Run: bash scripts/add-local-secret.sh BOLNA_API_KEY"; exit 1; }
tmp=$(mktemp)
code=$(curl -s -o "$tmp" -w '%{http_code}' -H "Authorization: Bearer $key" https://api.bolna.ai/v2/agent/all || echo 000)
if [ "$code" != "200" ]; then
  echo "Bolna answered $code, so the API key was not accepted (or Bolna is unreachable)."
  [ "$code" = "401" ] || [ "$code" = "403" ] && echo "Create a fresh key under Developers > API Keys and save it again."
  rm -f "$tmp"; exit 1
fi
python3 - "$tmp" <<'PY'
import json, re, sys
agents = json.load(open(sys.argv[1]))
if not isinstance(agents, list) or not agents:
    print("Your Bolna account has no agents yet. Save the agent in Agent Studio first."); sys.exit(2)
print("Agents in your Bolna account:")
for a in agents: print("  -", a.get("agent_name"), "|", a.get("id"), "|", a.get("agent_status"))
pick = [a for a in agents if "afroflow" in (a.get("agent_name") or "").lower()] or (agents if len(agents) == 1 else [])
if len(pick) != 1:
    print("\nCould not choose automatically. Copy the right ID above and run:  bash scripts/add-local-secret.sh BOLNA_AGENT_ID"); sys.exit(3)
aid = pick[0]["id"]
lines = [l for l in open(".env.local").read().splitlines() if not l.startswith("BOLNA_AGENT_ID=")]
lines.append(f'BOLNA_AGENT_ID="{aid}"')
open(".env.local", "w").write("\n".join(lines) + "\n")
print(f"\nSaved BOLNA_AGENT_ID for '{pick[0].get('agent_name')}' ({len(aid)} characters).")
PY
rm -f "$tmp"
