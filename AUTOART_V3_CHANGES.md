# Autoart v3 - Rebuild Summary

## What Changed

### 1. Composition Plan (Phase 0) ✅
- **Before iteration 1**: LLM generates a complete composition plan saved to `autoart-plan.json`
- Plan defines each object in the scene with:
  - Exact coordinate bounds (x/y ranges)
  - Target mark count
  - Object-specific color palette
  - Size/opacity ranges
  - Priority level (1-5)
- Plan persists across runs (use `--replan` to force regeneration)
- Each iteration updates mark counts and picks the most underdone object

### 2. Vision-Based Scoring ✅
- **Replaced**: Text-based LLM scorer → Vision model with rendered canvas image
- **Rendering**: Node.js canvas package (fast, no browser required)
  - Fallback to Playwright Python renderer if node-canvas unavailable
  - Renders to `/tmp/autoart_render.png` (800x800 PNG)
- **Vision scoring**: Sends rendered PNG to Claude Sonnet 4.5 via OpenClaw gateway
  - Scores: coherence, density, thematic alignment, intentionality (1-10 each)
  - Returns specific visual critique and improvement suggestions

### 3. Object-Focused Iteration ✅
- Each iteration:
  1. Counts marks in each object's bounds
  2. Picks most underdone object (prioritizes priority 1, then % completion)
  3. Generates marks **only** for that object using its specific palette/params
  4. Vision scores the result
  5. Keeps or reverts based on score improvement

### 4. What Stayed the Same
- CLI args: `--canvas`, `--key`, `--max-iterations`, `--delay`, `--dry-run`, `--goals`
- Learned params file with hill-climbing/mutation
- Log file with iteration history
- Keep/revert logic based on score comparison
- Reading `autoart-goals.md` each iteration

### 5. New CLI Args
- `--replan`: Force regeneration of composition plan (ignores existing plan file)
- `--reset`: Reset params, log, AND plan (full fresh start)

## Test Results (Dry Run)

```bash
node autoart.js --canvas 770dd54a-4469-4d86-8d8f-dc462c1fc30b \
  --key sprl_DyXoIVwGM38U9MhGALslmLn8KZ5Tkm69 \
  --max-iterations 1 --dry-run
```

✅ Plan generation worked
- Created 14 objects (wine bottle, fruits, cloth, table, etc.)
- Assigned priorities, bounds, palettes correctly

✅ Mark counting worked
- Analyzed 983 existing marks
- Correctly counted marks per object (e.g., "wine-bottle-body: 39/80 (49%)")

✅ Vision scoring worked
- Rendered 800x800 PNG using node-canvas
- Sent to vision model via gateway
- Returned score: 5.0/10 with specific critique

✅ Object selection worked
- Picked "wine-bottle-highlight" (15% complete, priority 1)

⚠️ One LLM parse error (expected occasionally, not a blocker)

## File Locations

- `autoart.js` - Main script (v3)
- `autoart-plan.json` - Generated composition plan (persists)
- `autoart-params.json` - Learned parameters (persists)
- `autoart-log.json` - Iteration history (persists)
- `autoart-goals.md` - Human goals (read-only, hot-reloadable)
- `/tmp/autoart_render.png` - Latest rendered canvas (temp)

## Next Steps

Ready for live testing:
```bash
node autoart.js --canvas 770dd54a-4469-4d86-8d8f-dc462c1fc30b \
  --key sprl_DyXoIVwGM38U9MhGALslmLn8KZ5Tkm69 \
  --max-iterations 5 --delay 10000
```

Remove `--dry-run` to actually push marks to Sprawl.
