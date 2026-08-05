#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${CAREER_STUDIO_DIR:-/Users/haseeb-mir/Documents/Code/career-studio-ai}"
HEADROOM_BIN="${HEADROOM_BIN:-/Users/haseeb-mir/.local/bin/headroom}"
HEADROOM_PORT="${HEADROOM_PORT:-8787}"
HEADROOM_LOG="${HEADROOM_LOG:-${TMPDIR:-/tmp}/headroom-${HEADROOM_PORT}.log}"

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "[ERROR] Project directory does not exist: $PROJECT_DIR" >&2
  exit 1
fi

if [[ ! -x "$HEADROOM_BIN" ]]; then
  HEADROOM_BIN="$(command -v headroom || true)"
fi

if [[ -z "$HEADROOM_BIN" || ! -x "$HEADROOM_BIN" ]]; then
  echo "[ERROR] Headroom CLI was not found. Set HEADROOM_BIN or install headroom-ai." >&2
  exit 1
fi

export HEADROOM_REQUIRE_RUST_CORE="${HEADROOM_REQUIRE_RUST_CORE:-false}"
export HEADROOM_MEMORY="${HEADROOM_MEMORY:-true}"
export HEADROOM_LEARN="${HEADROOM_LEARN:-true}"

headroom_proxy_running() {
  lsof -nP -iTCP:"$HEADROOM_PORT" -sTCP:LISTEN >/dev/null 2>&1
}

start_headroom_proxy() {
  if headroom_proxy_running; then
    echo "[INFO] Headroom proxy already listening on port $HEADROOM_PORT."
    HEADROOM_STARTED_BY_SCRIPT=0
    return
  fi

  echo "[INFO] Starting Headroom proxy on port $HEADROOM_PORT..."
  "$HEADROOM_BIN" proxy --host 127.0.0.1 --port "$HEADROOM_PORT" >"$HEADROOM_LOG" 2>&1 &
  HEADROOM_PID=$!
  HEADROOM_STARTED_BY_SCRIPT=1

  for _ in {1..30}; do
    if headroom_proxy_running; then
      echo "[INFO] Headroom proxy is ready (PID $HEADROOM_PID)."
      return
    fi
    if ! kill -0 "$HEADROOM_PID" 2>/dev/null; then
      echo "[ERROR] Headroom proxy exited. See $HEADROOM_LOG" >&2
      sed -n '1,80p' "$HEADROOM_LOG" >&2 || true
      exit 1
    fi
    sleep 0.2
  done

  echo "[ERROR] Timed out waiting for Headroom proxy. See $HEADROOM_LOG" >&2
  exit 1
}

stop_headroom_proxy() {
  if [[ "${HEADROOM_STARTED_BY_SCRIPT:-0}" == "1" ]] && [[ -n "${HEADROOM_PID:-}" ]] && kill -0 "$HEADROOM_PID" 2>/dev/null; then
    kill "$HEADROOM_PID" 2>/dev/null || true
    wait "$HEADROOM_PID" 2>/dev/null || true
  fi
}

setup_headroom() {
  cd "$PROJECT_DIR"
  start_headroom_proxy
  trap stop_headroom_proxy EXIT INT TERM
}
