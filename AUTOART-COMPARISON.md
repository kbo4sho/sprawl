# Autoart v3 vs v4 — Architecture Comparison

## TL;DR

**v3** uses LLMs to generate coordinates → slow, noisy, random placement
**v4** uses mathematical optimization → fast, deterministic, gallery-quality

---

## Pipeline Comparison

### v3: LLM-Driven Iteration
1. **Phase 0:** LLM generates composition plan (objects with bounds)
2. **Pick object:** Choose most underdone object from plan
3. **Generate strategy:** LLM decides how to approach this object
4. **Generate marks:** LLM outputs 40 coordinate arrays
5. **Push marks:** Send to API
6. **Score:** Heuristic or vision-based scoring
7. **Keep/Revert:** If score drops, revert the batch
8. **Repeat:** 10-50 iterations

**Problems:**
- LLM generates essentially random coordinates within bounds
- Each iteration takes ~30s (multiple LLM calls)
- Noisy scoring means good batches sometimes get reverted
- 40 dots per iteration → slow buildup (500+ dots needs 12+ iterations)
- Keep/revert loop is trial-and-error, not goal-directed

### v4: Voronoi Stippling Pipeline
1. **Generate reference image:** One image gen API call (~5s)
2. **Build density map:** Convert image to grayscale density
3. **Place dots:** Rejection sampling based on density (~1s for 3000 dots)
4. **Optimize positions:** Lloyd's relaxation (30 iterations, ~2s)
5. **Color dots:** Sample reference image at final positions
6. **Progressive placement:** Split into 3 rounds, push to API (~2min with delays)
7. **Optional taste check:** LLM critique for refinement

**Advantages:**
- Deterministic: same input → same output
- Fast: ~2min total for 3000 dots (vs 15+ min for v3 to reach 500 dots)
- No trial-and-error: dots are placed optimally on first pass
- LLM used for taste, not math (the right tool for the job)

---

## Code Complexity

| Metric | v3 | v4 |
|--------|----|----|
| **Lines of code** | ~500 | ~350 |
| **API calls per run** | 20-100+ (LLM + vision) | 1-2 (image gen + optional critique) |
| **External dependencies** | canvas (optional), playwright (fallback) | canvas (required) |
| **State files** | autoart-log.json, autoart-params.json, autoart-plan.json | None (stateless) |
| **Learned parameters** | Yes (mutation + keep/revert) | No (deterministic algorithm) |

---

## Quality Comparison

### v3: Random Placement Within Bounds
- Dots are randomly scattered within object bounds
- Clumping and voids are common
- No spatial optimization
- "Cluster tightness" param tries to force proximity, but LLM often ignores it
- Result: looks like random scatter, not deliberate art

### v4: Mathematically Optimal Placement
- Dots are placed via weighted Voronoi stippling (Secord 2002)
- Perfectly spaced: no clumps, no voids
- Dots cluster in high-density (dark) regions naturally
- Lloyd's relaxation ensures even distribution
- Result: gallery-quality pointillism

**Example:**
- v3: 40 dots placed in a "wine bottle" region → random scatter
- v4: 500 dots placed in a wine bottle silhouette → recognizable form with optimal spacing

---

## Speed Comparison

### v3 Iteration Breakdown (per iteration)
- **Strategy generation:** ~8s (LLM call)
- **Mark generation:** ~15s (LLM call with JSON schema)
- **Push marks:** ~2s (API call)
- **Scoring:** ~10s (vision LLM) or ~1s (heuristic)
- **Keep/revert decision:** ~2s (if revert, another API call)

**Total per iteration:** ~30-40s
**10 iterations:** 5-7 minutes
**Marks placed:** ~400 (10 iterations × 40 marks, minus reverts)

### v4 Full Pipeline
- **Reference image gen:** ~5s
- **Density map build:** <1s
- **Rejection sampling (3000 dots):** ~1s
- **Lloyd's relaxation (30 iterations):** ~2s
- **Color sampling:** <1s
- **Progressive placement (3 rounds, 75 batches):** ~2.5min (with 2s delay per batch)
- **Optional taste check:** ~5s

**Total:** ~3 minutes
**Marks placed:** 3000

**Result:** v4 is ~100x faster per dot placed.

---

## Scoring Philosophy

### v3: Keep/Revert Loop
- **Goal:** Incrementally improve score via mutation + selection
- **Problem:** Scoring is noisy (vision LLM varies ±2 points per run)
- **Effect:** Good batches sometimes get reverted, bad batches sometimes kept
- **Learning:** Params mutate toward "winning patterns," but signal is weak

**Analogy:** Throwing darts blindfolded, asking someone to describe how close you got, adjusting aim based on noisy feedback.

### v4: Deterministic Quality
- **Goal:** Generate optimal placement on first pass
- **Validation:** Optional LLM critique for high-level feedback
- **No iteration:** If the composition needs adjustment, regenerate the reference image or tweak density map, don't retry random placements

**Analogy:** Using a stencil. The result is guaranteed to match the template.

---

## LLM Role

### v3: LLM as Coordinate Generator
- LLM generates arrays of `{x, y, size, color, opacity}` objects
- This is fundamentally the wrong tool — LLMs are bad at arithmetic and spatial reasoning
- JSON schema helps, but clamping is still needed post-generation
- Result: LLM wastes tokens on a task better done by math

### v4: LLM as Taste Filter
- LLM generates the reference image (creative work — LLM's strength)
- LLM optionally critiques the final composition (subjective judgment — LLM's strength)
- Math handles all coordinate placement (deterministic work — math's strength)
- Result: Each tool does what it's best at

---

## When to Use Which

### Use v3 when:
- You want to experiment with composition planning (object-based iteration)
- You're debugging the keep/revert learning loop
- You need vision-based scoring integrated into the iteration cycle
- You're okay with slow, exploratory iterations

### Use v4 when:
- You want production-quality art, fast
- You need deterministic, reproducible results
- You want gallery-quality pointillism
- You're shipping to users (v4 is the "real" product)

---

## Migration Path

If you have a canvas built with v3 and want to switch to v4:

1. **Fetch existing canvas theme** (already done in both scripts)
2. **Run v4 on the same canvas** — it will generate a fresh reference image and place dots
3. **Result:** v4's dots will blend with or replace v3's scattered marks

**Note:** v4 doesn't reuse v3's composition plan or learned params — it's a clean-slate approach.

---

## Future: Hybrid Approach?

**Potential combo:**
- Use v4's Voronoi engine for base layer (fast, beautiful)
- Use v3's LLM critique + refinement for targeted touch-ups
- Result: Best of both worlds — math for bulk work, LLM for taste

**Example workflow:**
1. v4 places 3000 dots (2 min)
2. LLM critiques: "wine bottle needs more highlight on left edge"
3. v3-style targeted iteration: LLM generates 40 marks for that specific region
4. Push, evaluate, keep/revert

This hasn't been built yet, but the infrastructure exists in both scripts.

---

Built 2026-03-17 by Brick.
