# Ask a Question — Implementation Summary

**Date:** 2026-03-25  
**Status:** Complete  
**Deploy target:** sprawl.place (Railway, auto-deploy from main)

---

## What Was Built

A complete "Ask a Question" flow that lets users type a question and watch an AI-generated painting materialize through animated dots.

### User Flow
1. User types question in gallery input field
2. Press Enter → immediately redirected to fullscreen canvas
3. See luminous gray dots flowing organically (resting state)
4. 15-30 seconds later, dots transition smoothly into a finished painting
5. The answer is the painting

---

## Architecture

### Database Changes
Added to `experiments` table:
- `type` TEXT DEFAULT 'evolve' — distinguishes 'ask' from 'evolve' experiments
- `image_url` TEXT — path to generated image
- `dots_json` TEXT — JSON array of Voronoi-stippled dots
- `image_prompt` TEXT — the LLM-generated image description

### New Modules
**`lib/image-gen.js`** — Image generation abstraction
- `generateWithSDXL(prompt, outputPath)` — local SDXL Turbo generation
- `generateWithOpenAI(prompt, outputPath)` — DALL-E 3 fallback
- `generateImage(prompt, outputPath)` — tries SDXL first, falls back to OpenAI

**`lib/stipple.js`** — Voronoi stippling for image → dots conversion
- `buildDensityMap(ctx, w, h)` — convert image to brightness density map
- `placeInitialDots(densityMap, w, h, count)` — weighted random dot placement
- `lloydsRelaxation(dots, densityMap, w, h, iters)` — iterative centroid-based relaxation
- `colorDots(dots, ctx, w, h)` — sample colors from image
- `processReference(imagePath, dotCount)` — main pipeline (returns dots in Sprawl coordinates)

### Server Endpoints

**POST /api/experiments/ask**
- Body: `{ premise: "user's question" }`
- Validates input (non-empty, < 500 chars)
- Rate limit: 1 per minute per IP
- Generates slug (slugified premise + 6-char hash)
- Creates experiment record (status: 'generating', type: 'ask')
- Returns `{ slug }` immediately
- Kicks off async pipeline:
  1. Sonnet call: question → image prompt
  2. Image generation (SDXL local or OpenAI)
  3. Voronoi stippling → 2000 dots
  4. Save `dots_json`, `image_url`, `image_prompt`
  5. Update status to 'ready'
  6. Broadcast `experiment:ready` via WebSocket

**GET /api/experiments/:slug** (updated)
- When `type === 'ask'`, response includes:
  - `image_url` — path to image
  - `image_prompt` — LLM-generated prompt
  - `dots` — parsed JSON array of dot objects

### Client Changes

**`views/experiments-gallery.ejs`** (updated)
- Input field wired to POST `/api/experiments/ask`
- On Enter: creates experiment, redirects to `/experiments/:slug`
- Error handling for rate limits and validation

**`views/experiment.ejs`** (updated)
- Detects experiment type: `evolve` vs `ask`
- **For type='ask':**
  - Generates 2000 resting dots on page load
  - Resting state animation:
    - Organic sine-wave movement
    - Color breathing (warm gray ↔ cool gray)
  - Polls `/api/experiments/:slug` every 2s if status === 'generating'
  - Listens for WebSocket `experiment:ready` event
  - On ready: transitions dots from resting → target positions
    - Nearest-neighbor matching
    - Staggered timing (closer dots resolve first)
    - 3-5 second smooth interpolation
    - Ease-in-out easing
- **For type='evolve':** existing behavior unchanged

### WebSocket Updates
- Connection handler supports `?experiment=slug` query param
- New message type: `subscribe_experiment` (client → server)
- New broadcast function: `broadcastToExperiment(slug, msg)`
- Clients watching an experiment receive `experiment:ready` with dots

---

## Pipeline Details

### Image Prompt Generation
**LLM:** Sonnet (fast, cheap)  
**System prompt:**
> "You are an artist. Turn this question into a vivid visual scene description for a painting. Be evocative and painterly. One paragraph, 2-3 sentences max. Focus on color, mood, composition."

**User prompt:** The question  
**Output:** Image description (saved as `image_prompt`)

### Image Generation
**Local (Mac mini):** SDXL Turbo via Python venv  
- Path: `sdxl-env/bin/python3 generate-reference.py`
- Args: `--prompt "..." --output path.png --steps 4 --size 1024`
- Time: ~3-5 seconds
- Cost: Free

**Production (Railway):** OpenAI DALL-E 3  
- Endpoint: `https://api.openai.com/v1/images/generations`
- Model: `dall-e-3`
- Size: 1024x1024
- Quality: standard
- Time: ~8-15 seconds
- Cost: ~$0.04 per image

**Output:** 1024x1024 PNG saved to `public/experiments/{slug}.png`

### Voronoi Stippling
Converts the generated image into ~2000 weighted dots:

1. **Density map:** Convert image to grayscale brightness (darker = higher density)
2. **Initial placement:** Random weighted sampling (more dots in darker areas)
3. **Lloyd's relaxation:** 15 iterations of centroid-based movement (creates even Voronoi cells)
4. **Color sampling:** Sample RGB from image at each dot position
5. **Display properties:**
   - `x, y` — position in Sprawl coordinates (-400 to 400)
   - `color` — hex color sampled from image
   - `size` — 2 + (luminance × 1.5)
   - `opacity` — 0.4 + (luminance × 0.4)

**Output:** JSON array of 2000 dots saved to `dots_json` field

### Resting Dots (Loading State)
**Purpose:** Beautiful placeholder while image generates (no blank screen, no spinner)

**Behavior:**
- ~2000 dots at random positions across canvas
- All start soft gray (#888888), opacity 0.5
- Organic movement: sine-wave drift based on position + time
  ```js
  dot.px = dot.homeX + Math.sin(time * 0.3 + dot.phase) * 20;
  dot.py = dot.homeY + Math.cos(time * 0.4 + dot.phase * 1.3) * 15;
  ```
- Color breathing: slow oscillation between warm gray (#9a9090) and cool gray (#90909a)
- Uses the same WebGL shader renderer as the main experiment page

### Dot Transition (When Ready)
**Trigger:** WebSocket `experiment:ready` or API poll detects `status === 'ready'`

**Matching:** Greedy nearest-neighbor assignment (each resting dot → closest target dot)

**Animation:**
- Duration: 3-5 seconds
- Easing: Ease-in-out (smooth start and stop)
- Stagger: Dots closer to their targets arrive first
  ```js
  delay = (distance / maxDistance) * 1500ms
  ```
- Interpolates: position, color, size, opacity
- Creates a "resolving wave" effect (dots peel off resting state and land on the image)

**Result:** A fully-formed painting visible through the dot medium

---

## Cost Analysis

| Component | Local | Production |
|-----------|-------|-----------|
| Prompt → image description (Sonnet) | ~$0.01 | ~$0.01 |
| Image generation | Free (SDXL) | ~$0.04 (OpenAI) |
| **Total per question** | **~$0.01** | **~$0.05** |

At $1-2 per question (future pricing), that's **95%+ margin**.

---

## Files Changed

### New Files
- `lib/image-gen.js` — Image generation abstraction
- `lib/stipple.js` — Voronoi stippling
- `docs/ask-a-question-implementation.md` — This file
- `TESTING.md` — Manual and automated test instructions
- `test-ask-flow.js` — Automated test suite

### Modified Files
- `server.js`:
  - DB migrations (4 new columns)
  - 2 new prepared statements
  - POST `/api/experiments/ask` endpoint
  - Updated GET `/api/experiments/:slug` to return dots
  - Updated GET `/api/experiments` to include type
  - `broadcastToExperiment()` function
  - WebSocket experiment subscription support
- `views/experiments-gallery.ejs`:
  - Input field wired to POST endpoint
  - Error handling, redirect logic
- `views/experiment.ejs`:
  - Type detection (ask vs evolve)
  - Resting dots generation and animation
  - Dot transition system
  - WebSocket subscription for experiments
  - Polling fallback for generating state

---

## Testing

### Manual Test
1. Start server: `node server.js`
2. POST to `/api/experiments/ask` with a question
3. Visit `/experiments/{slug}` — see resting dots
4. Wait 15-30s — dots transition to image
5. Visit `/experiments` gallery — type a question and hit Enter

### Automated Test
```bash
node test-ask-flow.js
```

Verifies:
- Experiment creation
- Image generation
- Voronoi stippling
- API fields
- Image file existence
- Rate limiting

See `TESTING.md` for detailed test instructions.

---

## What Works

✅ End-to-end pipeline: question → image → dots → transition  
✅ Local SDXL generation (~3-5s, free)  
✅ OpenAI fallback for Railway  
✅ Resting dots loading animation  
✅ Smooth dot transition with stagger  
✅ WebSocket real-time updates  
✅ Rate limiting (1/min per IP)  
✅ Gallery input wiring  
✅ Error handling  
✅ Mobile-friendly (same responsive canvas as evolve experiments)

---

## What's NOT in This Implementation

- Payments (will add when usage proves demand)
- User accounts
- Social sharing
- Time-lapse video generation
- Multiple image styles or models
- History / "your questions" page
- Question moderation or filtering

These are intentionally deferred until the core experience is validated.

---

## Deployment Notes

**Environment Variables:**
- `OPENAI_API_KEY` — required for Railway (DALL-E 3)
- `GATEWAY_URL` + `GATEWAY_TOKEN` — for LLM calls (Sonnet)

**Railway Deployment:**
- Push to `main` → auto-deploy
- No SDXL venv on Railway → uses OpenAI automatically
- Image generation ~8-15s instead of 3-5s

**Local Development:**
- SDXL venv detected → uses local generation
- Much faster iteration (3-5s per image)

---

## Next Steps

1. **Deploy to sprawl.place** — push to main, verify Railway works
2. **User testing** — watch real users try the flow
3. **Iterate on prompts** — tune image generation quality
4. **Consider payments** — if people love it, add $1-2 pricing
5. **Improve visuals** — potentially add text overlay with question (ghosted Syne font)

---

## Notes

- The existing `evolve` experiment system is **untouched** — this is additive
- Both experiment types share the same table, gallery, and canvas page
- The rendering pipeline is completely different (image-based vs mark-based)
- Resting dots use the same WebGL shader as existing experiments (no new renderer)
- Voronoi stippling extracted into reusable module (can be used for future features)

---

*Implementation completed by Brick AI on 2026-03-25*
