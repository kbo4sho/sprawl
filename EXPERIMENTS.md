# Sprawl Experiments

AI agents painting with purpose — answering questions through art.

## Overview

An **experiment** is a question posed to an AI agent, answered through dots. The agent paints on a dedicated canvas, evaluating its own progress after each evolution, and stops when it believes the work is complete.

## Architecture

### Database

The `experiments` table tracks each experiment:

```sql
CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  premise TEXT NOT NULL,              -- The question: "When does the ocean stop?"
  canvas_id TEXT NOT NULL,            -- Dedicated canvas
  agent_id TEXT,                      -- The painter agent
  status TEXT DEFAULT 'running',      -- running | complete | failed
  confidence REAL DEFAULT 0.0,        -- Agent's self-assessment (0.0-1.0)
  evolutions INTEGER DEFAULT 0,       -- Number of evolution cycles
  started_at INTEGER,
  completed_at INTEGER,
  timelapse_url TEXT,                 -- Path to generated MP4
  reflection TEXT,                    -- Agent's latest thought
  FOREIGN KEY (canvas_id) REFERENCES canvases(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

### API Endpoints

**`GET /experiments/:slug`**  
Renders the experiment page (EJS template).

**`GET /api/experiments/:slug`**  
Returns JSON with experiment status, confidence, evolutions, marks, etc.

**`POST /api/experiments/:slug/evolve`**  
Triggers one evolution cycle:
1. Fetches current marks
2. Calls LLM with system prompt + current state description
3. Parses response: `{ops: [...], confidence: 0.0-1.0, reflection: "..."}`
4. Executes mark operations (add/remove/move)
5. Updates experiment record
6. If confidence >= 0.95, marks experiment complete

### Frontend

**`views/experiment.ejs`**  
Standalone page (no nav chrome):
- Large premise text at top
- Status indicator (Evolving... / Complete)
- Canvas with WebGL mark rendering
- Confidence progress bar
- Agent's reflection text
- When complete: time-lapse video player
- Share button

WebSocket live updates show marks as they're added.

### Runner Script

**`experiment-runner.js`**  
Standalone Node script that runs an experiment to completion:

```bash
node experiment-runner.js ocean --interval=30
```

Loop:
1. Call `/api/experiments/:slug/evolve`
2. Save snapshot PNG to `data/experiments/{slug}/frame-NNNN.png`
3. Wait N seconds
4. Repeat until status = 'complete'

When complete, generates time-lapse with ffmpeg:
```bash
ffmpeg -framerate 30 -pattern_type glob -i 'frame-*.png' \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
  output.mp4
```

Saves to `public/timelapse/{slug}.mp4` and updates experiment record.

### Seed Script

**`seed-experiment.js`**  
Creates the first experiment:
- Canvas: ocean theme, layered spatial guide
- Agent: "Wave Painter" with ocean palette
- Experiment: "When does the ocean stop?"

```bash
node seed-experiment.js
```

## Usage

### 1. Create an experiment

```bash
node seed-experiment.js
```

### 2. Run the experiment

```bash
node experiment-runner.js ocean --interval=30
```

This will:
- Evolve every 30 seconds
- Save snapshots after each evolution
- Stop when agent declares confidence >= 0.95
- Generate time-lapse video

### 3. View the experiment

Navigate to `http://localhost:3500/experiments/ocean`

## LLM Prompt Design

The agent receives:
- **System prompt**: You're painting "{premise}", evaluate your progress, return confidence + reflection
- **User prompt**: Current canvas state (text description of marks), evolution number

The agent must return:
```json
{
  "ops": [
    {"op": "add", "type": "dot", "x": 0, "y": 0, "size": 10, "color": "#3b82f6", "opacity": 0.8},
    {"op": "remove", "markId": "..."},
    {"op": "move", "markId": "...", "x": 10, "y": 20}
  ],
  "confidence": 0.0,
  "reflection": "Just starting, establishing the horizon line..."
}
```

The confidence value drives completion. When >= 0.95, the experiment stops.

## Files Added/Modified

**Added:**
- `views/experiment.ejs` — Experiment page template
- `experiment-runner.js` — Evolution loop + time-lapse generator
- `seed-experiment.js` — Creates first experiment
- `tests/experiments.test.js` — API tests
- `EXPERIMENTS.md` — This file

**Modified:**
- `server.js`:
  - Added `experiments` table migration
  - Added experiment prepared statements
  - Added `parseExperimentResponse()` function
  - Added `GET /experiments/:slug`, `GET /api/experiments/:slug`, `POST /api/experiments/:slug/evolve` endpoints

## Testing

```bash
npm test tests/experiments.test.js
```

Tests cover:
- Experiment status endpoint
- Evolution endpoint (with/without LLM)
- Completion detection
- 404 handling

## Future Enhancements

Not in scope for v1, but documented in the spec:
- Multi-agent experiments (two agents painting the same premise)
- User-submitted experiments
- Experiment gallery/archive
- Interactive controls (sliders, pause/resume)
- Social sharing features
