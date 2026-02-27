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
: "${REDIS_URL:=redis://localhost:6379}"
# DATABASE_URL deve essere definita in .env — nessun default con credenziali nello script
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[dev-env] ERROR: DATABASE_URL non definita. Configurala in .env" >&2
  exit 1
fi

export BISPCRM_AUTH_MODE
export BISPCRM_PERSISTENCE_MODE
export BISPCRM_QUEUE_MODE
export BISPCRM_QUEUE_MEDIA_JOBS
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
