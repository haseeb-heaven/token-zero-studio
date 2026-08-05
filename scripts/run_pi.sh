#!/usr/bin/env bash
set -euo pipefail
#
# run_pi.sh — launch the Pi coding agent in this repo with rtk + headroom enabled.
#
#   - rtk      Rust Token Killer CLI (token-optimized shell commands). Installed
#              from Homebrew if missing.
#   - headroom Context-optimization proxy. A `headroom` provider is registered in
#              pi's models.json and pi is launched through it, so all model traffic
#              runs through the proxy on 127.0.0.1:<HEADROOM_PORT>.
#
# Overrides (all optional):
#   PI_MODEL      model id to request via the proxy (default: current pi default)
#   HEADROOM_PORT proxy port (default: 8786)
#   HEADROOM_BIN  headroom CLI path
#   HEADROOM_LOG  proxy log path
#   RTK_BIN       rtk CLI path
#   PI_BIN        pi CLI path
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$PWD}"

# Set the proxy port BEFORE sourcing the helper, whose default is 8787.
HEADROOM_PORT="${HEADROOM_PORT:-8786}"
HEADROOM_LOG="${HEADROOM_LOG:-${TMPDIR:-/tmp}/headroom-${HEADROOM_PORT}.log}"
export HEADROOM_PORT HEADROOM_LOG

# shellcheck source=/dev/null
source "$SCRIPT_DIR/headroom_common.sh"
cd "$PROJECT_DIR"

# ---------- 1. rtk present? install from Homebrew if missing ----------
RTK_BIN="${RTK_BIN:-$(command -v rtk || true)}"
if [[ -z "$RTK_BIN" ]]; then
  echo "[INFO] rtk not found — installing via Homebrew..."
  HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_REQUIRE_TAP_TRUST=1 brew install rtk
  RTK_BIN="$(command -v rtk || true)"
fi
if [[ -z "$RTK_BIN" || ! -x "$RTK_BIN" ]]; then
  echo "[ERROR] rtk is not installed and could not be installed via brew." >&2
  exit 1
fi
echo "[INFO] rtk: $("$RTK_BIN" --version)"

# ---------- 2. headroom proxy + base-url env ----------
export HEADROOM_REQUIRE_RUST_CORE="${HEADROOM_REQUIRE_RUST_CORE:-false}"
export HEADROOM_MEMORY="${HEADROOM_MEMORY:-true}"
export HEADROOM_LEARN="${HEADROOM_LEARN:-true}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-http://127.0.0.1:${HEADROOM_PORT}/v1}"
export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-http://127.0.0.1:${HEADROOM_PORT}}"

setup_headroom

# ---------- 3. ensure a `headroom` provider exists in pi's models.json ----------
PI_MODELS="${PI_MODELS:-$HOME/.pi/agent/models.json}"
PI_PROXY_URL="http://127.0.0.1:${HEADROOM_PORT}/v1"
if [[ -f "$PI_MODELS" ]]; then
  PROV_RE='.*"headroom"[[:space:]]*:.*'
  if ! python3 - "$PI_MODELS" "$PI_PROXY_URL" <<'PY'
import json, sys, os
path, proxy_url = sys.argv[1], sys.argv[2]
try:
    with open(path) as f:
        cfg = json.load(f)
except Exception:
    cfg = {}
cfg.setdefault("providers", {})
providers = cfg["providers"]
changed = False
want = {
    "baseUrl": proxy_url,
    "api": "openai-completions",
    "apiKey": "headroom",
}
if providers.get("headroom") != want:
    providers["headroom"] = want
    changed = True
if changed:
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    print("[INFO] registered headroom provider ->", proxy_url)
else:
    print("[INFO] headroom provider already registered ->", proxy_url)
PY
  then
    echo "[WARN] could not ensure headroom provider in $PI_MODELS; continuing anyway" >&2
  fi
else
  echo "[WARN] pi models.json not found ($PI_MODELS); skipping provider registration" >&2
fi

PI_BIN="${PI_BIN:-$(command -v pi || true)}"
if [[ -z "$PI_BIN" || ! -x "$PI_BIN" ]]; then
  echo "[ERROR] pi CLI not found. Set PI_BIN=/path/to/pi." >&2
  exit 1
fi

PI_MODEL="${PI_MODEL:-}"

echo "[INFO] Launching Pi with Headroom proxy + rtk..."
if [[ -n "$PI_MODEL" ]]; then
  exec "$PI_BIN" --provider headroom --model "$PI_MODEL" "$@"
else
  exec "$PI_BIN" --provider headroom "$@"
fi
