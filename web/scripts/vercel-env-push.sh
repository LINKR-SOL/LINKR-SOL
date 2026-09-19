#!/usr/bin/env bash
# Pushes every KEY=value line of an env file into the linked Vercel project's Production environment,
# overwriting what is there. Run from web/ after `vercel link`:
#
#   scripts/vercel-env-push.sh .env.mainnet.local
#
# Then redeploy (`vercel --prod`) — NEXT_PUBLIC_* values are baked in at build time.
set -euo pipefail
file="${1:-.env.mainnet.local}"
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }
n=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  key="${line%%=*}"
  val="${line#*=}"
  val="${val%%[[:space:]]#*}"   # strip a trailing "  # comment"
  if printf '%s' "$val" | vercel env add "$key" production --force >/dev/null 2>&1; then
    n=$((n + 1))
    printf '  %-32s ok\n' "$key"
  else
    printf '  %-32s FAILED\n' "$key" >&2
  fi
done < "$file"
echo "pushed $n variables to Production"
