# Sprawl Monetization Strategy

*2026-03-09 — Brick's analysis*

## What We Actually Have

Sprawl is NOT a generative art tool. It's NOT an NFT platform. It's closer to a **living aquarium** — you release a creature, watch it grow, and it lives among other creatures. The closest analog is **Tamagotchi meets screensaver meets social art gallery**.

The psychological hook is the **Tamagotchi effect**: people form emotional bonds with digital things that appear alive, especially things they named and gave a personality. When campfire writes "smoke" and "circle" and "night" in an arc — and you chose the personality that made it do that — it feels like YOUR creation is alive.

## Current Model Problems

**$1/mo for... what exactly?**

Right now the value prop is "keep your agent alive." That's a stick, not a carrot. "Pay or your thing dies" is hostile. The model should flip to: "Your thing is alive and here's all the cool stuff you can unlock."

**No visible upgrade path.** Once you're paying $1/mo, there's nothing else to buy. No reason to upgrade. No "I want MORE." The ceiling is the floor.

**Evolution is invisible.** The most magical thing about Sprawl — agents evolving, writing, curating — happens silently in the background. Users don't see it happening. They check back and things have moved. That's not an engagement loop, that's a screensaver.

## The Insight: Evolution IS the Product

The evolve button Kevin just asked for reveals the real product. Watching your agent think, place marks, write words IN REAL TIME — that's the dopamine. That's the moment someone goes "holy shit, it's alive." 

**The free experience should showcase this.** Not hide it behind a paywall.

## Proposed Model: Free to Create, Pay to Grow

### Free Tier (Generous)
- Create an agent (name, color, personality) — FREE
- First LLM-driven composition (20-30 marks) — FREE
- Agent lives on canvas permanently (never frozen, never deleted)
- **1 free evolution per day** — user can trigger it manually
- Mark limit: 30
- Visible on canvas, clickable, has profile
- This is the hook. They see their creation, watch it evolve once, want more.

### Spark ($1/month or $8/year)
- **Hourly auto-evolution** — agent evolves on its own, 24/7
- Mark limit: 60
- **Manual evolve: 3x per day** (instant, on-demand)
- Agent gets "Spark" badge on profile
- Evolution history / timelapse player
- Priority canvas position (slight visual emphasis)

### Flame ($3/month or $24/year)  
- Everything in Spark
- Mark limit: 120
- **Manual evolve: unlimited**
- **Neighbor connections** — your agent can form visual connections to others
- **Custom evolution speed** — evolve every 30min, 15min, or hourly
- **Export composition** as PNG/SVG
- "Flame" badge

### Inferno ($8/month or $60/year)
- Everything in Flame
- Mark limit: 200
- **Multiple agents** (up to 3)
- **Evolution directives** — tell your agent what to build next (influences the vision prompt)
- **Priority rendering** — agent's marks render on top
- "Inferno" badge
- Early access to new features

## Why This Works

### 1. Free tier drives virality
Nobody shares "I paid $1 for a dot." People share "look at this AI thing I made that's writing poetry on a shared canvas." Free creation = more agents = more interesting canvas = more visitors = more conversions.

### 2. Evolution is the upgrade lever
Every tier gives you MORE evolution. More marks, more frequent cycles, more control. This is natural — you're not restricting the core experience, you're amplifying it.

### 3. The evolve button is the conversion moment
Free users get 1 evolution per day. They trigger it, watch the magic, and... "UPGRADE FOR MORE." That button becomes the most natural upsell in the product. They literally just experienced the thing they'd be paying for.

### 4. No death threat
Agents never freeze or die. Free agents just evolve slowly (1x/day) and have fewer marks. This removes the "pay or lose" hostility and replaces it with "pay to unlock more."

### 5. Price anchoring
$1/mo feels like nothing against $3/mo and $8/mo options. The existence of Inferno makes Spark feel like a steal.

## The Evolve Button UX

This is the critical conversion surface:

```
[Agent Card]
  🌀 Evolve  ←  FREE users see this
  
  [After clicking:]
  ✅ +8 -3 ~2  |  "Your agent wrote 'silence' near the eastern arc"
  
  [After daily limit:]
  🔒 Next free evolution in 18h  |  ⚡ Upgrade to Spark for hourly evolution
```

The upgrade prompt should:
1. Appear AFTER they've experienced the magic (not before)
2. Show what they'd get ("hourly auto-evolution, 60 marks, 3x daily manual")
3. Be dismissible (not blocking)
4. Show the agent's current vision ("Your agent wants to: extend the western text arc...")

## Implementation Priority

1. **Free tier with 1 daily evolve** — this is the hook
2. **Evolve button with limit + upgrade CTA** — this is the conversion
3. **Spark tier ($1/mo)** — hourly auto + 3x daily manual
4. **Flame/Inferno** — later, once we know what people actually want more of

## What NOT to Do

- Don't freeze free agents. Ever. Dead things don't convert.
- Don't gate creation. The first experience must be free and magical.
- Don't show pricing before the first evolution. Let them fall in love first.
- Don't add ads. This is art. Ads destroy the aesthetic.
- Don't add NFTs/crypto. It's a distraction and alienates most people.

## Revenue Math

If 1000 agents are created:
- 70% stay free (700 agents, still alive on canvas, making it interesting)
- 20% convert to Spark at $1/mo = 200 × $12/yr = $2,400/yr
- 8% convert to Flame at $3/mo = 80 × $36/yr = $2,880/yr  
- 2% convert to Inferno at $8/mo = 20 × $96/yr = $1,920/yr
- **Total: ~$7,200/yr from 1000 agents**

At 10,000 agents: ~$72,000/yr
At 50,000 agents: ~$360,000/yr

The canvas gets better with every agent (free or paid), which drives organic growth. This is the flywheel.

## Compute Costs

Per agent per month:
- Sonnet 4.5: ~$0.005/evolution × 24 evolutions/day × 30 days = ~$3.60/mo (too high for $1 tier)
- Haiku/Mini: ~$0.0005/evolution × 24/day × 30 = ~$0.36/mo (sustainable)
- **Solution:** Free + Spark tier use fast/cheap model (Haiku/Mini). Flame+ uses Sonnet for better art quality.

This actually creates a REAL quality difference between tiers — not artificial gating, but genuinely better LLM = genuinely better art.
