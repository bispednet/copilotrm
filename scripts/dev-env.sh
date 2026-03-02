#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
  set +a
fi

: "${BISPCRM_AUTH_MODE:=header}"
: "${BISPCRM_PERSISTENCE_MODE:=postgres}"
: "${BISPCRM_QUEUE_MODE:=redis}"
: "${BISPCRM_QUEUE_MEDIA_JOBS:=true}"
: "${BISPCRM_CHANNEL_DISPATCH_MODE:=gateway-first}"
: "${REDIS_URL:=redis://localhost:6379}"
: "${PORT_GATEWAY_CHANNELS:=4020}"
: "${BISPCRM_ROOT_DIR:=${ROOT_DIR}}"
: "${BISPCRM_MIGRATIONS_DIR:=${ROOT_DIR}/infra/migrations}"
: "${BISPCRM_RUNTIME_DATA_DIR:=${ROOT_DIR}/data}"
: "${BISPCRM_CHANNEL_GATEWAY_URL:=http://localhost:${PORT_GATEWAY_CHANNELS}}"
: "${BISPCRM_ELIZA_ENV_PATH:=}"
: "${BISPCRM_REDIS_CONNECT_TIMEOUT_MS:=3000}"
: "${BISPCRM_ORCHESTRATOR_API_TIMEOUT_MS:=5000}"
# DATABASE_URL deve essere definita in .env — nessun default con credenziali nello script
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[dev-env] ERROR: DATABASE_URL non definita. Configurala in .env" >&2
  exit 1
fi

export BISPCRM_AUTH_MODE
export BISPCRM_PERSISTENCE_MODE
export BISPCRM_QUEUE_MODE
export BISPCRM_QUEUE_MEDIA_JOBS
export BISPCRM_CHANNEL_DISPATCH_MODE
export BISPCRM_ROOT_DIR
export BISPCRM_MIGRATIONS_DIR
export BISPCRM_RUNTIME_DATA_DIR
export BISPCRM_CHANNEL_GATEWAY_URL
export BISPCRM_ELIZA_ENV_PATH
export BISPCRM_REDIS_CONNECT_TIMEOUT_MS
export BISPCRM_ORCHESTRATOR_API_TIMEOUT_MS
export REDIS_URL
export DATABASE_URL

if ! command -v ss >/dev/null 2>&1; then
  echo "[dev-env] 'ss' non disponibile: skip port checks"
  exit 0
fi

if ! ss -ltn | grep -qE ':5432\s'; then
  echo "[dev-env] WARNING: Postgres su :5432 non rilevato"
fi

if [ "${BISPCRM_QUEUE_MODE}" = "redis" ] && ! ss -ltn | grep -qE ':6379\s'; then
  echo "[dev-env] Redis non attivo su :6379 -> fallback automatico a queue inline"
  export BISPCRM_QUEUE_MODE=inline
  export BISPCRM_QUEUE_MEDIA_JOBS=false
fi
