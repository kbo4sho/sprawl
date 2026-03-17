# Visual Comparison: v3 vs v4

Quick guide to compare autoart.js (v3) and autoart-v4.js side-by-side.

---

## Setup

### 1. Create Two Test Canvases

Visit [Sprawl](https://sprawl.place), create two canvases with the **same theme**:
- Canvas A: For v3 testing
- Canvas B: For v4 testing

Example theme: `"A still life with wine, grapes, and candlelight"`

### 2. Get API Key

Generate a Sprawl API key (starts with `sprl_`).

---

## Run v3 (10 iterations)

```bash
cd ~/clawd/projects/sprawl

node autoart.js \
  --canvas CANVAS_A_ID \
  --key sprl_xxx \
  --max-iterations 10 \
  --delay 8000
```

**Expected output:**
- ~10 iterations × 30-40s each = **5-7 minutes**
- ~300-400 marks placed (with some reverted)
- Random scatter within object bounds
- Possible empty regions or clumping

**Time:** Start timer ⏱️

---

## Run v4 (3000 dots)

```bash
cd ~/clawd/projects/sprawl

node autoart-v4.js \
  --canvas CANVAS_B_ID \
  --key sprl_xxx \
  --dots 3000
```

**Expected output:**
- Reference image generation: ~5s
- Voronoi stippling: ~3s
- Progressive placement: ~2.5 min (with 2s delay per batch)
- **Total: ~3 minutes**
- 3000 marks placed (no reverts)
- Even distribution, no clumps/voids

**Time:** Start timer ⏱️

---

## Visual Comparison Checklist

Visit both canvases side-by-side:
- `https://sprawl.place/canvas/CANVAS_A_ID`
- `https://sprawl.place/canvas/CANVAS_B_ID`

### v3 (LLM Coordinates)
Look for:
- [ ] **Random scatter:** Dots placed without spatial optimization
- [ ] **Clumping:** Multiple dots very close together
- [ ] **Voids:** Empty regions that should have density
- [ ] **Low mark count:** Only ~300-400 marks after 7 minutes
- [ ] **Unrecognizable forms:** Hard to identify objects (wine bottle, grapes, etc.)

### v4 (Voronoi Stippling)
Look for:
- [ ] **Even spacing:** No clumps, no voids
- [ ] **Dense coverage:** 3000 marks in 3 minutes
- [ ] **Recognizable forms:** Objects clearly defined by dot density
- [ ] **Progressive detail:** Large dots for shapes, small dots for texture
- [ ] **Gallery-quality:** Looks like deliberate pointillist art

---

## Quantitative Comparison

| Metric | v3 (10 iterations) | v4 (3000 dots) | Winner |
|--------|-------------------|----------------|--------|
| **Time** | ~5-7 min | ~3 min | v4 (2x faster) |
| **Marks placed** | ~300-400 | 3000 | v4 (7-10x more) |
| **Marks per minute** | ~60 | ~1000 | v4 (16x faster) |
| **Determinism** | Varies per run | Same every time | v4 |
| **Visual quality** | Random scatter | Optimal spacing | v4 |

---

## Advanced: Same Canvas, Both Methods

To see how they interact, run both on the **same canvas**:

```bash
# First: v3 for 5 iterations
node autoart.js --canvas CANVAS_ID --key sprl_xxx --max-iterations 5

# Then: v4 for 1500 dots
node autoart-v4.js --canvas CANVAS_ID --key sprl_xxx --dots 1500
```

**Observe:**
- v3's scattered dots
- v4's Voronoi-optimized dots filling in the gaps
- Combined effect (v4 should dominate visually)

---

## Screenshot & Share

For each canvas:
1. Take a screenshot
2. Save as `v3-output.png` and `v4-output.png`
3. Compare side-by-side

**Optional:** Upload to a comparison tool (e.g., Figma, Notion, or just side-by-side in Preview)

---

## Expected Verdict

**v4 should clearly outperform v3** on:
- Speed (2x faster total, 16x faster per mark)
- Quality (gallery-quality vs random scatter)
- Density (3000 dots vs 400 dots)
- Recognizability (clear forms vs vague shapes)

**v3's only advantage:** Composition planning (object-based iteration)
- But this doesn't outweigh the speed/quality gap
- And v4 could be extended with composition planning if needed

---

## If v3 Looks Better...

**Possible reasons:**
1. **Canvas theme mismatch** — v4's reference image didn't match the theme
   - Fix: Regenerate with a more descriptive theme/spatial guide
2. **Not enough dots** — 3000 dots too sparse for this theme
   - Fix: Rerun with `--dots 5000`
3. **v3's learned params** hit a lucky streak
   - Rerun v3 from scratch (without existing params) to verify

**Unlikely:** Voronoi stippling is mathematically superior. If v3 wins, something is misconfigured.

---

## Report Findings

**Template:**
```
Canvas theme: "..."
v3: [time], [marks], [observations]
v4: [time], [marks], [observations]
Winner: v4 (or v3 if you disagree)
Reason: ...
```

Example:
```
Canvas theme: "A still life with wine, grapes, and candlelight"
v3: 6min 30s, ~350 marks, random scatter, hard to identify objects
v4: 2min 50s, 3000 marks, clear bottle/grapes/candle forms, even spacing
Winner: v4
Reason: 2x faster, 8x more marks, recognizable forms, gallery-quality
```

---

Built 2026-03-17 by Brick.
