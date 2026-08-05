#!/bin/sh
# Fake agent used by the Playwright E2E: proves env injection + PTY spawn works.
# Prints a marker + injected proxy env, then idles so the session stays alive.
echo "FAKE-AGENT READY"
echo "OPENAI_BASE_URL=${OPENAI_BASE_URL:-<unset>}"
echo "ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL:-<unset>}"
while true; do sleep 1; done
