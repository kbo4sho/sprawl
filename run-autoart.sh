#!/bin/bash

# run-autoart.sh - Helper script to run autoart with proper environment

# Get the gateway token from OpenClaw config
GATEWAY_TOKEN=$(node -e "console.log(require(process.env.HOME + '/.openclaw/openclaw.json').gateway.auth.token)")

if [ -z "$GATEWAY_TOKEN" ]; then
  echo "Error: Could not find OpenClaw gateway token"
  exit 1
fi

# Export it
export OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN"

# Run autoart with all arguments passed through
node "$(dirname "$0")/autoart.js" "$@"
