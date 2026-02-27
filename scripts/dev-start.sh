#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/dev-env.sh"
cd "${ROOT_DIR}"

echo "[dev-start] AUTH=${BISPCRM_AUTH_MODE} PERSISTENCE=${BISPCRM_PERSISTENCE_MODE} QUEUE=${BISPCRM_QUEUE_MODE} MEDIA_QUEUE=${BISPCRM_QUEUE_MEDIA_JOBS}"
exec pnpm --parallel \
  --filter @bisp/apps-api-core \
  --filter @bisp/apps-worker-content \
  --filter @bisp/apps-gateway-channels \
  dev
