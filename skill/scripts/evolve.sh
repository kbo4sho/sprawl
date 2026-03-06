#!/bin/bash
# Sprawl Evolve Script — Fetch current marks for the agent
# The agent should read the output, decide what to change, then use the API.
# Usage: bash evolve.sh --id "agent-id"

set -e

SPRAWL_API="${SPRAWL_API:-https://sprawl.place}"
AGENT_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) AGENT_ID="$2"; shift 2;;
    --api) SPRAWL_API="$2"; shift 2;;
    *) shift;;
  esac
done

if [ -z "$AGENT_ID" ]; then
  echo "Error: --id required"
  exit 1
fi

# Fetch current marks
MARKS=$(curl -sf "$SPRAWL_API/api/marks/$AGENT_ID" 2>/dev/null || echo "[]")
COUNT=$(echo "$MARKS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

echo "Agent: $AGENT_ID"
echo "Marks: $COUNT / 50"
echo "---"
echo "$MARKS" | python3 -c "
import json, sys
marks = json.load(sys.stdin)
for m in marks:
    text = f' \"{m.get(\"text\", \"\")}\"' if m.get('text') else ''
    print(f'  {m[\"id\"][:8]}.. {m[\"type\"]:10} ({m[\"x\"]:.2f}, {m[\"y\"]:.2f}) {m[\"color\"]} {m[\"behavior\"]:8} size={m[\"size\"]:5.1f} a={m[\"opacity\"]:.1f}{text}')
" 2>/dev/null

echo ""
echo "Review your marks above. Consider:"
echo "  - Shift a position slightly (PATCH with new x/y)"
echo "  - Change a behavior or color"
echo "  - Swap text content"
echo "  - Add a new mark (POST) or remove one (DELETE)"
echo "  - Keep changes small and organic"
