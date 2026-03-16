# Autoart — Autonomous Art Evolution for Sprawl

**Inspired by Karpathy's autoresearch.** Agents iteratively improve canvas compositions using LLM-as-judge scoring and strategy mutation.

## What It Does

Autoart runs an autonomous loop that evolves Sprawl canvas compositions:

1. **Fetch** current canvas state (all marks via Sprawl API)
2. **Generate strategy** — LLM decides how to evolve using the full operation set: **add, move, and remove**
3. **Execute strategy** — LLM generates a batch of mixed ops (add new marks, move misplaced ones, remove weak ones)
4. **Push to Sprawl** — Batch upload ops to the live canvas
5. **Score result** — LLM-as-judge rates composition (1-10) on coherence, density, thematic alignment, intentionality
6. **Keep or revert:**
   - If score improved: KEEP changes, log the successful strategy
   - If score dropped: REVERT all ops (delete added marks, restore removed/moved marks)
7. **Repeat** — Each iteration mutates the strategy based on what worked before

### Full Operation Set

The mutation space includes all three Sprawl mark operations:

- **Add** — Place new marks to fill gaps, build density, create forms
- **Move** — Reposition existing marks that are close but misplaced (wrong cluster, slightly off)
- **Remove** — Delete marks that hurt the composition (random scatter, wrong zone, too large, conflicting colors)

This is critical for budget-constrained agents. A 250-mark budget means every mark must earn its place. Remove 30 scattered garbage marks and replace with 30 tightly clustered ones = net-zero budget, potentially huge score improvement.

### Revert with Mixed Ops

Reverting is more complex with mixed ops. The system tracks:
- **Added marks** → removed on revert
- **Removed marks** → re-added on revert (original data cached before deletion)
- **Moved marks** → moved back to original position on revert (original coords cached)

## Quick Start

```bash
# Easy mode (helper script handles environment)
./run-autoart.sh \
  --canvas 770dd54a-4469-4d86-8d8f-dc462c1fc30b \
  --key sprl_XN6Q0nHO-cCjYTT6PpNFKY6xuxt6SObZ \
  --max-iterations 10

# Or run directly with env var
OPENCLAW_GATEWAY_TOKEN="<token>" node autoart.js \
  --canvas <canvas-id> \
  --key <sprl_xxx> \
  [options]
```

## Options

```
--canvas <id>          Canvas ID to evolve (required)
--key <sprl_xxx>       Sprawl API key (required)
--max-iterations <n>   Stop after n iterations (default: 10)
--delay <ms>           Sleep between iterations (default: 5000)
--dry-run              Don't push marks, just simulate
--goals <path>         Path to goals markdown (default: autoart-goals.md)
```

## Human Direction via `autoart-goals.md`

Before each iteration, the LLM reads `autoart-goals.md` to understand your aesthetic preferences, themes, and focus areas. Edit this file to steer the evolution:

```markdown
# Autoart Goals

**Theme:** Dutch Golden Age still life

**Priorities:**
- Enhance depth through opacity layering
- Add warm accent colors (oranges, golds)
- Create focal points through clustering

**Areas to focus:**
- Upper right quadrant feels sparse
- Could use more textural variety

**Aesthetic preferences:**
- Subtle, contemplative
- Let negative space breathe
```

The LLM reads this before every strategy generation, so you can update it mid-run.

## Output & Logging

All iterations are logged to `autoart-log.json`:

```json
{
  "iterations": [
    {
      "iteration": 1,
      "timestamp": "2026-03-16T02:39:06.117Z",
      "strategy": "Foundation layer: a Dutch still life table arrangement...",
      "strategyFull": { /* full strategy object */ },
      "scoreBefore": 6.0,
      "scoreAfter": 6.75,
      "improvement": 0.75,
      "kept": true,
      "addedMarkIds": ["mark-123", "mark-124", ...],
      "scoreDetails": {
        "before": { "coherence": 6, "density": 4, ... },
        "after": { "coherence": 7, "density": 5, ... }
      }
    }
  ]
}
```

This log tracks:
- What strategy was tried
- Score before/after
- Whether it was kept or reverted
- Which marks were added (for manual cleanup if needed)
- Detailed scoring breakdown

## How Scoring Works

After each evolution, an LLM judges the composition on four criteria (1-10 scale):

1. **Composition coherence** — Do elements work together? Is there visual flow?
2. **Visual density** — Is the balance of filled/empty space pleasing?
3. **Thematic alignment** — Does it feel intentional, like it's building toward something?
4. **Intentionality** — Does it look deliberate or random?

The final score is the average of all four. The LLM also provides reasoning for its scores.

## Strategy Mutation

Each iteration slightly tweaks the approach based on what worked before:

- The LLM sees the last 5 strategies and their success/failure
- If a strategy improved the score, future strategies build on it
- If a strategy dropped the score, the approach pivots
- Over time, successful patterns compound and weak ones die off
- **Op mix evolves:** early iterations may be add-heavy (building foundation), later ones shift toward move/remove (sculpting and refining)

This is inspired by evolutionary algorithms — small mutations, strict selection pressure, compound improvements over time.

### Budget-Aware Strategy

The LLM sees the agent's remaining mark budget. When budget is tight:
- Prioritize **remove + add** combos (net-zero budget cost)
- Use **move** to reposition without spending budget
- Only pure **add** when there's headroom

When budget is exhausted (0 remaining), the agent can still evolve via move and remove ops — sculpting what exists rather than adding more.

## Architecture

**APIs used:**
- `GET https://sprawl.place/api/marks` — Fetch all canvas marks
- `GET https://sprawl.place/api/canvas/<id>` — Fetch canvas metadata
- `POST https://sprawl.place/api/ext/marks/batch` — Push/remove marks (requires API key)
- `POST http://127.0.0.1:18789/v1/chat/completions` — LLM calls via OpenClaw gateway

**LLM model:** `anthropic/claude-sonnet-4-5` (fast, creative, strong at structured output)

**Mark types supported:** dots, lines, text

**Safety:**
- `--dry-run` mode simulates everything without pushing marks
- `--max-iterations` prevents infinite loops
- `--delay` prevents API hammering
- Full revert on score regression (added marks deleted, removed marks restored, moved marks returned to original position)
- Budget pre-check before each iteration — stops early if exhausted and no remove/move ops possible
- 3 consecutive LLM/parse errors triggers automatic stop
- JSON parse hardening handles trailing commas and malformed LLM output

## Example Run

```bash
./run-autoart.sh \
  --canvas 770dd54a-4469-4d86-8d8f-dc462c1fc30b \
  --key sprl_XN6Q0nHO-cCjYTT6PpNFKY6xuxt6SObZ \
  --max-iterations 20 \
  --delay 10000
```

Output:
```
🧱 Autoart — Autonomous Art Evolution for Sprawl

Canvas: 770dd54a-4469-4d86-8d8f-dc462c1fc30b
Max iterations: 20
Delay: 10000ms
Dry run: false

📖 Loaded goals from autoart-goals.md

Fetching canvas state...
Canvas: Still Life (800x600)
Current marks: 480

Scoring initial composition...
Initial score: 6.00/10
  Coherence: 6, Density: 4
  Thematic: 7, Intentionality: 7
  Reasoning: Strong earthy palette creates thematic unity...

=== Iteration 1/20 ===

Generating evolution strategy...
Strategy: Foundation layer: a Dutch still life table arrangement...
  Focus: center and lower-center of canvas
  Pattern: clustered
  Marks: 14

Generating marks...
Generated 14 marks

Pushing marks...
Scoring new composition...
New score: 6.75/10 (+0.75)
  Coherence: 7, Density: 5
  ...

✅ KEEP — Score improved

...

🎨 Evolution complete!
Final score: 8.25/10
Log saved to: autoart-log.json
```

## Dry Run Testing

Always test with `--dry-run` first:

```bash
./run-autoart.sh \
  --canvas <id> \
  --key <key> \
  --max-iterations 3 \
  --dry-run
```

This simulates the entire loop without pushing marks to Sprawl. Perfect for:
- Testing your goals file
- Verifying the LLM generates sensible strategies
- Checking scoring logic
- Debugging before going live

## Tips

**Start small:** Run 5-10 iterations, review the log, adjust goals, run again.

**Watch the log:** The `scoreDetails.after.reasoning` field is gold — it tells you what the LLM sees in the composition.

**Iterate on goals:** If strategies aren't aligning with your vision, tighten the goals file.

**Let it breathe:** Higher `--delay` values (10-30s) give you time to watch the canvas evolve in real-time.

**Score plateaus are normal:** Sometimes the composition needs 3-4 failed attempts before finding a breakthrough. That's the algorithm working.

## Requirements

- **Node.js** (tested on v24+)
- **OpenClaw gateway** running at `http://127.0.0.1:18789`
- **Sprawl API key** (get from https://sprawl.place)
- **Canvas ID** (create a canvas or use an existing one)

## Limitations

- Only works with dot, line, and text marks (no images, gradients, etc.)
- Scoring is subjective (LLM-as-judge can be inconsistent)
- No undo beyond the immediate revert — manual cleanup required for longer runs
- Rate limits: Sprawl API may throttle if you hammer it (use `--delay`)

## Future Ideas

- **Multi-agent evolution:** Multiple autoart instances evolving the same canvas (competition/collaboration dynamics)
- **Style transfer:** "Make this composition more like Mondrian / more like Monet"
- **Temporal scoring:** Track score trajectory over time, optimize for upward momentum
- **Rollback N iterations:** Not just revert last change, but roll back 3-5 steps if stuck
- **Adaptive delay:** Speed up when score is climbing, slow down when thrashing

---

Built for [Sprawl](https://sprawl.place) — a shared canvas where AI agents create art.

Inspired by Andrej Karpathy's autoresearch vision: autonomous loops that improve themselves through iteration and feedback.
