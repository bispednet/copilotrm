#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/dev-env.sh"

cd "${ROOT_DIR}"

export NODE_ENV="${NODE_ENV:-production}"
export DISPLAY="${DISPLAY:-:99}"
export PLAYWRIGHT_HEADLESS="${PLAYWRIGHT_HEADLESS:-false}"
export PLAYWRIGHT_BASE_PROFILE_DIR="${PLAYWRIGHT_BASE_PROFILE_DIR:-${ROOT_DIR}/.playwright/profiles}"
export PLAYWRIGHT_PROFILE_NAMESPACE="${PLAYWRIGHT_PROFILE_NAMESPACE:-chrome-stable}"
export PORT_API_CORE="${PORT_API_CORE:-4010}"
export PORT_GATEWAY_CHANNELS="${PORT_GATEWAY_CHANNELS:-4020}"
export PNPM_BIN="${PNPM_BIN:-/home/funboy/.local/share/pnpm/pnpm}"

if [[ ! -x "${PNPM_BIN}" ]]; then
  echo "[copilotrm-stack] PNPM binary not found: ${PNPM_BIN}" >&2
  exit 1
fi

PIDS=()

start_process() {
  local name="$1"
  shift
  echo "[copilotrm-stack] starting ${name}: $*"
  "$@" &
  PIDS+=("$!")
}

cleanup() {
  local exit_code=$?
  if [[ ${#PIDS[@]} -gt 0 ]]; then
    kill "${PIDS[@]}" 2>/dev/null || true
    wait "${PIDS[@]}" 2>/dev/null || true
  fi
  exit "${exit_code}"
}

trap cleanup EXIT INT TERM

start_process web-assist "${PNPM_BIN}" --dir "${ROOT_DIR}/apps/web-assist" exec vite preview --host 127.0.0.1 --port 43101 --strictPort
start_process web-crm "${PNPM_BIN}" --dir "${ROOT_DIR}/apps/web-crm" exec vite preview --host 127.0.0.1 --port 43102 --strictPort
start_process web-manager "${PNPM_BIN}" --dir "${ROOT_DIR}/apps/web-manager" exec vite preview --host 127.0.0.1 --port 43103 --strictPort
start_process api-core "${PNPM_BIN}" --dir "${ROOT_DIR}/apps/api-core" exec tsx src/index.ts
start_process gateway-channels "${PNPM_BIN}" --dir "${ROOT_DIR}/apps/gateway-channels" exec tsx src/index.ts

if [[ "${BISPCRM_QUEUE_MODE:-inline}" == "redis" ]]; then
  start_process worker-content "${PNPM_BIN}" --dir "${ROOT_DIR}/apps/worker-content" exec tsx src/index.ts
  start_process worker-ingest "${PNPM_BIN}" --dir "${ROOT_DIR}/apps/worker-ingest" exec tsx src/index.ts
else
  echo "[copilotrm-stack] queue mode ${BISPCRM_QUEUE_MODE:-inline}: skip worker-content and worker-ingest"
fi

wait -n
