# Experiments System Upgrade

## Summary

Upgraded the Sprawl experiments system with:
- Evolution caps (configurable max_evolutions, default 20)
- Narrative summaries generated on completion
- Gallery page for browsing all experiments
- Thumbnail generation
- Support for multiple experiment types with different prompts
- New "Freedom" experiment

## Database Changes

New columns added to `experiments` table:
- `agent_ids` TEXT (array of agent IDs for multi-agent experiments)
- `axes` TEXT (array of axis tags like "freedom", "collaboration")
- `summary` TEXT (narrative summary generated on completion)
- `max_evolutions` INTEGER (evolution cap, default 20)
- `thumbnail_url` TEXT (thumbnail image path)

Migrations run automatically on server start.

## New Routes

### GET /experiments
Gallery page showing all experiments. Dark design with:
- Hero section explaining the concept
- Grid of experiment cards
- Axis tags, status indicators, evolution counts
- Links to individual experiment pages

### GET /api/experiments
JSON endpoint returning array of all experiments (without marks, just metadata).

## Experiment Page Upgrades

- Back link to gallery (top left)
- Axis tags displayed near status indicator
- Narrative summary section (only shows when complete)
- OpenGraph meta tags for sharing

## Evolution Cap

After a successful evolution:
- If `experiment.evolutions >= experiment.max_evolutions`, force-complete
- Set `status='complete'`, `completed_at=Date.now()`
- Don't wait for confidence >= 0.95

## Narrative Summary Generation

When an experiment completes (by confidence OR cap):
- One more LLM call to generate 2-3 paragraphs
- System: "You are a writer documenting an AI art experiment."
- User: Include premise, all reflections, evolution count, final mark count
- Save to `experiment.summary`

Happens before marking status complete.

## Gallery Page

`views/experiments-gallery.ejs`:
- Dark design (#0a0a0a background, white text, Inter font)
- Hero text:
  - Large: "What happens when you ask an AI a generous question?"
  - Subtext: "Each experiment poses a question to an AI agent and lets it answer through art..."
- Grid: 1-3 columns responsive
- Each card:
  - Premise (large)
  - Axis tags (pills)
  - Status: "Evolving..." (pulsing green dot) or "Complete"
  - Evolution count
  - Click → `/experiments/:slug`
- Sort: running first, then complete by most recent

## Freedom Experiment

`seed-freedom.js` creates:
- Premise: "You have a canvas. No rules. No subject. Make something."
- Canvas theme: "open" (minimal spatial guide)
- Agent name: "Unknown" (let it name itself in reflections)
- Color: white (#ffffff) default, agent can use any colors
- Axes: `["freedom"]`
- max_evolutions: 20

Different system prompt (no subject constraints):
```
You are an artist. You have a blank canvas. The coordinate space is -500 to 500 on both axes. 
There are no rules, no subject, no constraints. You decide what to make. You decide when you're done.

Your confidence should reflect how complete YOUR vision is — not ours. 
We have no expectations. Only you know when it's finished.
```

## Experiment Runner Upgrades

`experiment-runner.js` changes:
- Respects `max_evolutions` — stops loop when `evolutions >= max_evolutions`
- After completion, generates thumbnail (rasterizes final canvas to small PNG)
- Saves to `public/thumbnails/{slug}.png`
- Updates `experiment.thumbnail_url`
- Then stitches time-lapse as before

## Usage

### Seed the ocean experiment (existing):
```bash
node seed-experiment.js
```

### Seed the freedom experiment:
```bash
node seed-freedom.js
```

### Run an experiment:
```bash
node experiment-runner.js <slug> [--interval=30]
```

### View experiments:
- Gallery: http://localhost:3500/experiments
- Individual: http://localhost:3500/experiments/ocean
- Individual: http://localhost:3500/experiments/freedom

## Testing

All tests pass (experiments.test.js runs successfully):
```bash
npm test
```

The evolution test takes ~25 seconds due to LLM calls but completes successfully.
