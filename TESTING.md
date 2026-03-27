# Testing "Ask a Question" Flow

## Manual Test Steps

### 1. Start the server
```bash
node server.js
```

### 2. Create an experiment
```bash
curl -X POST http://localhost:3500/api/experiments/ask \
  -H "Content-Type: application/json" \
  -d '{"premise":"What is the meaning of life?"}'
```

Expected response:
```json
{"slug":"what-is-the-meaning-of-life-XXXXXX"}
```

### 3. Check experiment status
```bash
curl http://localhost:3500/api/experiments/SLUG | jq '{type, status, has_image: (.image_url != null), dots_count: (.dots | length)}'
```

Expected (initially):
```json
{
  "type": "ask",
  "status": "generating",
  "has_image": false,
  "dots_count": null
}
```

Expected (after ~5-30 seconds):
```json
{
  "type": "ask",
  "status": "ready",
  "has_image": true,
  "dots_count": 2000
}
```

### 4. Check the image file
```bash
ls -lh public/experiments/*.png | tail -1
```

Expected: PNG file ~1-2 MB

### 5. Visit the experiment page
Open in browser: `http://localhost:3500/experiments/SLUG`

Expected:
- Initially: Gray dots flowing organically (resting state)
- After ready: Dots transition smoothly to form the image (3-5 seconds)

### 6. Visit the gallery
Open in browser: `http://localhost:3500/experiments`

Expected:
- Input field at top
- Experiment appears in the list
- Can click to view

### 7. Test input flow
1. Type a question in the input field
2. Press Enter
3. Should redirect to `/experiments/SLUG` immediately
4. Should see resting dots while generating
5. Dots should transition when ready

### 8. Test rate limiting
Try creating two experiments within one minute:
```bash
curl -X POST http://localhost:3500/api/experiments/ask \
  -H "Content-Type: application/json" \
  -d '{"premise":"First question"}'

# Immediately try again
curl -X POST http://localhost:3500/api/experiments/ask \
  -H "Content-Type: application/json" \
  -d '{"premise":"Second question"}'
```

Expected: Second request returns 429 (Rate limited)

## Automated Test

Run the automated test suite:
```bash
node test-ask-flow.js
```

This will:
1. Create an experiment
2. Poll until ready
3. Verify all fields are present
4. Check image file exists
5. Test rate limiting

## What to Look For

### Server Logs
When an experiment is created, you should see:
```
[Ask SLUG] Image prompt: <generated prompt>
[Ask SLUG] Image generated: <path>
[Ask SLUG] Stippled 2000 dots
[Ask SLUG] Ready!
```

### Database
Check experiments table:
```bash
sqlite3 data/sprawl.db "SELECT slug, type, status FROM experiments WHERE type='ask' ORDER BY started_at DESC LIMIT 5;"
```

### Image Quality
Open the generated PNG in `public/experiments/`:
- Should be 1024x1024
- Should be a coherent image related to the question
- Should have good color and detail

### Dot Quality
Check a few dots from the API response:
```bash
curl http://localhost:3500/api/experiments/SLUG | jq '.dots[0:3]'
```

Expected format:
```json
[
  {"x": -123.45, "y": 67.89, "color": "#abcdef", "size": 8.5, "opacity": 0.75},
  ...
]
```

## Known Issues

- WebSocket subscription for experiments might not trigger immediately (use polling as fallback)
- Rate limiting is per-IP, so localhost tests might not trigger it
- SDXL generation takes 3-5s locally, OpenAI takes 8-15s on Railway
