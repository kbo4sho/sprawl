# Autoart v4 — Quick Start Guide

Get from zero to a finished pointillist canvas in 3 minutes.

## Prerequisites

1. **OpenClaw Gateway running** with `OPENCLAW_GATEWAY_TOKEN` in env
2. **Sprawl API key** (starts with `sprl_`)
3. **Canvas ID** from Sprawl
4. **Node.js** with `canvas` package installed (already in `sprawl` project)

## Quick Run

```bash
cd ~/clawd/projects/sprawl

node autoart-v4.js \
  --canvas YOUR_CANVAS_ID \
  --key sprl_YOUR_API_KEY \
  --dots 3000
```

That's it. Wait ~3 minutes, then check your canvas at `https://sprawl.place/canvas/YOUR_CANVAS_ID`.

---

## Step-by-Step

### 1. Get Your Canvas ID

Visit [Sprawl](https://sprawl.place), create or find a canvas. The ID is in the URL:
```
https://sprawl.place/canvas/abc123xyz
                              ^^^^^^^^^ this is your canvas ID
```

### 2. Get Your API Key

In the Sprawl dashboard, generate an API key. It will start with `sprl_`.

### 3. Verify Gateway is Running

```bash
echo $OPENCLAW_GATEWAY_TOKEN
```

Should print a token. If not, start the gateway:
```bash
openclaw gateway start
```

### 4. Run Autoart v4

```bash
node autoart-v4.js --canvas abc123xyz --key sprl_YOUR_KEY --dots 3000
```

**What happens:**
1. Fetches canvas theme (e.g., "A still life with wine and fruit")
2. Generates a reference image via OpenAI (5s)
3. Runs Voronoi stippling to place 3000 dots (3s)
4. Pushes dots in 3 progressive rounds (2.5 min with 2s delay per batch)
5. Optional: LLM critiques the result

**Total time:** ~3 minutes

---

## Common Options

### Control Dot Count
```bash
--dots 5000    # More dots = richer detail (but slower push time)
```

### Skip Image Generation (Reuse Existing)
```bash
--skip-image   # Uses /tmp/autoart_reference.png from a previous run
```

### Skip Taste Check (Faster Finish)
```bash
--skip-taste   # Don't run LLM critique at the end
```

### Dry Run (Test Without Pushing)
```bash
--dry-run      # Logs what would happen, doesn't push marks
```

### Adjust Delay Between Batches
```bash
--delay 1000   # 1 second between batches (faster, but may hit rate limits)
--delay 5000   # 5 seconds (safer for large runs)
```

---

## Example Workflows

### Quick Test (Dry Run)
```bash
node autoart-v4.js --canvas abc123 --key sprl_xxx --dots 500 --dry-run
```
Validates the pipeline without pushing marks.

### Production Run (5000 Dots, No Taste Check)
```bash
node autoart-v4.js --canvas abc123 --key sprl_xxx --dots 5000 --skip-taste
```
Fast production run, skips LLM critique to save time.

### Iterative Refinement (Reuse Image)
```bash
# First run: generate image + place 3000 dots
node autoart-v4.js --canvas abc123 --key sprl_xxx --dots 3000

# Second run: reuse image, add 2000 more dots
node autoart-v4.js --canvas abc123 --key sprl_xxx --dots 2000 --skip-image
```

The second run will add dots to the same canvas using the same reference image.

---

## Troubleshooting

### "Missing OPENCLAW_GATEWAY_TOKEN"
**Fix:** Start the gateway:
```bash
openclaw gateway start
export OPENCLAW_GATEWAY_TOKEN=$(openclaw gateway token)
```

### "Failed to fetch canvas"
**Fix:** Check that the canvas ID is correct and accessible.

### "Image generation failed"
**Fix:** Verify the gateway can reach OpenAI. Try:
```bash
curl -X POST http://127.0.0.1:18789/v1/images/generations \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-1","prompt":"test","n":1,"size":"1024x1024"}'
```

### "Failed to push marks"
**Fix:** Check your Sprawl API key is valid and has write access to the canvas.

### Dots are Too Sparse or Dense
**Fix:** Adjust `--dots`:
- Sparse canvas → increase to 5000-8000
- Too crowded → decrease to 1000-2000

---

## Advanced: Custom Reference Image

If you want to use your own reference image instead of generating one:

1. Place a 1024×1024 PNG at `/tmp/autoart_reference.png`
2. Run with `--skip-image`:
   ```bash
   node autoart-v4.js --canvas abc123 --key sprl_xxx --skip-image
   ```

The stippling algorithm will use your image as the density/color reference.

---

## Output Files

- **Reference image:** `/tmp/autoart_reference.png`
- **Final render (for taste check):** `/tmp/autoart_render.png`

These are overwritten on each run.

---

## Next Steps

- Read `AUTOART-V4.md` for full pipeline docs
- Read `AUTOART-COMPARISON.md` to see how v4 improves on v3
- Run `node test-autoart-v4.js` to validate the core algorithm

---

Built 2026-03-17 by Brick. Ship it. 🚀
