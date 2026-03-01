#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/dev-env.sh"
cd "${ROOT_DIR}"

echo "[dev-start] AUTH=${BISPCRM_AUTH_MODE} PERSISTENCE=${BISPCRM_PERSISTENCE_MODE} QUEUE=${BISPCRM_QUEUE_MODE} MEDIA_QUEUE=${BISPCRM_QUEUE_MEDIA_JOBS} DISPATCH=${BISPCRM_CHANNEL_DISPATCH_MODE}"
echo "[dev-start] API → :4010  |  gateway-channels → :4020"
echo "[dev-start] Frontend → web-crm :5173  |  web-assist :5174  |  web-manager :5175"

exec pnpm --parallel \
  --filter @bisp/apps-api-core \
  --filter @bisp/apps-worker-content \
  --filter @bisp/apps-gateway-channels \
  --filter @bisp/apps-web-crm \
  --filter @bisp/apps-web-assist \
  --filter @bisp/apps-web-manager \
  dev
