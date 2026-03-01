#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/dev-env.sh"

ROLE="${BISPCRM_DEV_ROLE:-admin}"

echo "[dev-check] role=${ROLE}"
echo "[dev-check] api-core=${COPILOTRM_API_URL:-http://localhost:${PORT_API_CORE:-4010}} gateway=${BISPCRM_CHANNEL_GATEWAY_URL:-http://localhost:${PORT_GATEWAY_CHANNELS:-4020}}"

API_CORE_URL="${COPILOTRM_API_URL:-http://localhost:${PORT_API_CORE:-4010}}"
GATEWAY_URL="${BISPCRM_CHANNEL_GATEWAY_URL:-http://localhost:${PORT_GATEWAY_CHANNELS:-4020}}"

curl -fsS --max-time 5 "${API_CORE_URL}/health" | jq .
curl -fsS --max-time 5 "${GATEWAY_URL}/health" | jq .
curl -fsS --max-time 8 "${API_CORE_URL}/api/system/infra" -H "x-bisp-role: ${ROLE}" | jq .
curl -fsS --max-time 8 "${API_CORE_URL}/api/system/db/snapshot" -H "x-bisp-role: ${ROLE}" | jq .

echo "[dev-check] OK"
