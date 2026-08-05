#!/usr/bin/env bash
# One-click build and run for TokenZero - Studio
# Works on Linux, macOS, and Windows (Git Bash / WSL)
set -euo pipefail

# Always run from the script's directory
cd "$(dirname "$0")"

echo ""
echo "[1/3] Installing dependencies (if needed)..."
if [ ! -d "node_modules" ]; then
    npm install
fi

echo ""
echo "[2/3] Building the app..."
npm run build

echo ""
echo "[3/3] Launching TokenZero - Studio..."
echo ""
npm start
