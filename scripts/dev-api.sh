#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/dev-env.sh"
cd "${ROOT_DIR}"

echo "[dev-api] AUTH=${BISPCRM_AUTH_MODE} PERSISTENCE=${BISPCRM_PERSISTENCE_MODE} QUEUE=${BISPCRM_QUEUE_MODE}"
exec pnpm --filter @bisp/apps-api-core dev
