#!/usr/bin/env bash
set -euo pipefail

BUCKET="imjin1592.com"
DISTRIBUTION="EARA00UGW51K0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npx tsc --noEmit
npx vite build

# Earlier hashes stay, as in the CI deploy: an open tab fetches a screen's chunk or the battle's after the new pages
# are published.
aws s3 sync dist/assets "s3://$BUCKET/assets" \
  --cache-control "public,max-age=31536000,immutable"

# The pages (index.html and one per address) are uploaded below under keys of their own: keep them out of the delete.
PAGES="$(node scripts/route-pages.mjs)"
EXCLUDES=()
while read -r file key; do EXCLUDES+=(--exclude "$key"); done <<< "$PAGES"

aws s3 sync dist "s3://$BUCKET" --delete \
  --exclude "assets/*" --exclude "*.glb" "${EXCLUDES[@]}" \
  --cache-control "public,max-age=86400"

aws s3 sync dist "s3://$BUCKET" \
  --exclude "*" --include "*.glb" \
  --content-type "model/gltf-binary" \
  --cache-control "public,max-age=86400"

# Every address (/, /campaign, /en/conquest, ... from src/routes.ts) answers at <path>, <path>/ and <path>/index.html:
# the origin has no directory index.
while read -r file key; do
  aws s3api put-object --bucket "$BUCKET" --key "$key" --body "dist/$file" \
    --content-type "text/html; charset=utf-8" \
    --cache-control "no-cache" >/dev/null
done <<< "$PAGES"

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths "/*" \
  --query "Invalidation.{Id:Id,Status:Status}" --output text
