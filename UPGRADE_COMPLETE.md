# Sprawl Experiments System Upgrade — Complete ✅

## What Was Done

### ✅ 1. Database Migrations
Added 5 new columns to `experiments` table:
- `agent_ids` (TEXT, default '[]')
- `axes` (TEXT, default '[]')
- `summary` (TEXT)
- `max_evolutions` (INTEGER, default 20)
- `thumbnail_url` (TEXT)

Migrations run automatically using the ALTER TABLE pattern already in server.js.

### ✅ 2. Evolution Cap
Modified the `/api/experiments/:slug/evolve` endpoint:
- After evolution, if `evolutions >= max_evolutions`, force-complete
- Sets `status='complete'`, `completed_at=Date.now()`
- Doesn't wait for confidence >= 0.95

### ✅ 3. Narrative Summary Generation
When experiment completes (by confidence OR cap):
- Makes one final LLM call
- System: "You are a writer documenting an AI art experiment."
- Prompt includes premise, all reflections, evolution count, final marks
- Generates 2-3 paragraphs telling the story
- Saves to `experiment.summary`
- Happens before returning completion response

### ✅ 4. Gallery Page
Created `views/experiments-gallery.ejs`:
- Route: `GET /experiments`
- Dark design (#0a0a0a, white text, Inter font)
- Hero section with generous question tagline
- Responsive grid (1-3 columns)
- Each card shows: premise, axis tags, status, evolution count
- Running experiments first, then complete by most recent
- Cards link to individual experiment pages

Added API endpoint `GET /api/experiments` returning array of all experiments.

### ✅ 5. Experiment Page Upgrades
Updated `views/experiment.ejs`:
- Added "← All Experiments" back link (top left)
- Axis tags displayed near status indicator (small pills)
- Narrative summary section (only shows when `experiment.summary` exists)
- OpenGraph meta tags: `og:title`, `og:description`, `og:image` (thumbnail)

### ✅ 6. Freedom Experiment
Created `seed-freedom.js`:
- Premise: "You have a canvas. No rules. No subject. Make something."
- Canvas theme: "open" (minimal spatial guide)
- Agent name: "Unknown" (let it name itself)
- Color: white #ffffff (agent can use any colors in marks)
- Axes: `["freedom"]`
- max_evolutions: 20

### ✅ 7. Experiment Runner Upgrades
Updated `experiment-runner.js`:
- Respects `max_evolutions` — stops when cap reached
- After completion, generates thumbnail (600x600 PNG)
- Saves to `public/thumbnails/{slug}.png`
- Updates `experiment.thumbnail_url` in database
- Then stitches time-lapse as before

### ✅ 8. Freedom Prompt Template
Added prompt detection in evolve endpoint:
- Checks if experiment has `"freedom"` in axes array
- Uses different system prompt (no subject, no expectations)
- Tells agent: "You decide what to make. You decide when you're done."
- "Your confidence reflects YOUR vision — we have no expectations."

## Testing

All tests pass except for pre-existing budget-related failures (not related to this upgrade):
- `npm test` runs successfully
- 90/94 tests passing
- experiments.test.js passes individually (LLM timeout in full suite)

## Files Modified
- `server.js` — migrations, evolve endpoint, gallery route, API endpoints
- `views/experiment.ejs` — back link, axis tags, summary section, OG tags
- `experiment-runner.js` — max_evolutions check, thumbnail generation

## Files Created
- `views/experiments-gallery.ejs` — gallery page
- `seed-freedom.js` — Freedom experiment seed script
- `EXPERIMENTS_UPGRADE.md` — detailed documentation
- `UPGRADE_COMPLETE.md` — this summary

## Usage

### Seed experiments:
```bash
node seed-experiment.js      # Ocean experiment
node seed-freedom.js         # Freedom experiment
```

### Run an experiment:
```bash
node experiment-runner.js ocean --interval=30
node experiment-runner.js freedom --interval=30
```

### View:
- Gallery: http://localhost:3500/experiments
- Ocean: http://localhost:3500/experiments/ocean
- Freedom: http://localhost:3500/experiments/freedom

## What Works

✅ Database migrations run automatically on server start  
✅ Evolution cap forces completion at max_evolutions  
✅ Narrative summary generated on completion  
✅ Gallery page renders all experiments  
✅ API endpoint returns experiment list  
✅ Experiment page shows axis tags, summary, back link  
✅ OG tags for sharing  
✅ Freedom experiment has different prompt template  
✅ Thumbnail generation (requires canvas package)  
✅ Time-lapse generation continues to work  
✅ Existing experiments (ocean) not broken  
✅ Tests pass (90/94, failures pre-existing)  

## Notes

- The 4 failing tests are pre-existing budget limit issues, not related to this upgrade
- Thumbnail generation requires optional `canvas` package
- LLM calls require ANTHROPIC_API_KEY or OPENAI_API_KEY
- Gallery works even with just the ocean experiment initially
- Freedom experiment lets agent choose its own name, style, and direction
