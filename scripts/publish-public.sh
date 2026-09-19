#!/usr/bin/env bash
# Publishes the current tree to the public repository as ONE fresh commit authored by the project identity,
# so no personal name, e-mail, co-author line or past history leaves this machine.
#
#   GITHUB_TOKEN=<token with repo:write on CAUSA-RH/causa-rh> scripts/publish-public.sh
#
# Re-run any time: it replaces the public `main` with a new single commit of the current tree (force push).
# The token is used only for this one push and never written to disk or to git config.
set -euo pipefail
: "${GITHUB_TOKEN:?set GITHUB_TOKEN}"
REPO="${PUBLIC_REPO:-CAUSA-RH/causa-rh}"
IDENT_NAME="${PUBLIC_AUTHOR_NAME:-CAUSA-RH}"
IDENT_EMAIL="${PUBLIC_AUTHOR_EMAIL:-CAUSA-RH@users.noreply.github.com}"
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "commit or stash your local changes first (only committed, tracked files are published)" >&2
  exit 1
fi
# (this script is skipped: it contains the patterns themselves)
if git ls-files -z | xargs -0 grep -lIiE "sk-or-v1|vercel_blob_rw|ghp_[A-Za-z0-9]{20}|api-key=[0-9a-f]{8}" 2>/dev/null | grep -vE "package-lock|scripts/publish-public.sh"; then
  echo "the files above look like they contain secrets; aborting" >&2
  exit 1
fi

TREE=$(git write-tree)
COMMIT=$(GIT_AUTHOR_NAME="$IDENT_NAME" GIT_AUTHOR_EMAIL="$IDENT_EMAIL" \
         GIT_COMMITTER_NAME="$IDENT_NAME" GIT_COMMITTER_EMAIL="$IDENT_EMAIL" \
         git commit-tree "$TREE" -m "Linkr — StonkFun coins whose holders are paid in tokenised stocks

Dividend layer for StonkFun (Raydium LaunchLab) on Solana: coins launched
with a vault as their creator, creator fees converted into a basket of xStocks through
Jupiter and paid to holders by time-weighted balance, in Merkle epochs
committed on-chain. 0% platform fee. Custodial mode live; the
causa_vault program is the trustless upgrade path.")
echo "commit $COMMIT by $(git log -1 --format='%an <%ae>' "$COMMIT")"
git push --force "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git" "${COMMIT}:refs/heads/main" 2>&1 | sed "s#${GITHUB_TOKEN}#…#g"
echo "published to https://github.com/${REPO}"
