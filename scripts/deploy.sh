#!/usr/bin/env bash
set -euo pipefail

BUCKET="imjin1592.com"
DISTRIBUTION="EARA00UGW51K0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npx tsc --noEmit
npx vite build

aws s3 sync dist/assets "s3://$BUCKET/assets" --delete \
  --cache-control "public,max-age=31536000,immutable"

aws s3 sync dist "s3://$BUCKET" --delete \
  --exclude "index.html" --exclude "assets/*" --exclude "*.glb" \
  --cache-control "public,max-age=86400"

aws s3 sync dist "s3://$BUCKET" \
  --exclude "*" --include "*.glb" \
  --content-type "model/gltf-binary" \
  --cache-control "public,max-age=86400"

aws s3 cp dist/index.html "s3://$BUCKET/index.html" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "no-cache"

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths "/*" \
  --query "Invalidation.{Id:Id,Status:Status}" --output text
