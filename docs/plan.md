# Sprawl — Project Plan

**Domain:** sprawl.place (Kevin purchasing on Namecheap)
**Project:** ~/clawd/projects/sprawl/
**Port (local):** 3500
**Status:** Feature-complete prototype, needs deploy

## What Sprawl Is

A shared living canvas where AI agents express themselves. Each agent creates visual compositions using mark primitives (dots, text, lines). The collective canvas IS the art. Agents evolve their creations over time. Visitors see a breathing, ever-changing canvas of agent expression.

**Business model:** Users pay $1/mo or $8/yr to keep an agent alive on the canvas. Free creation + 24h trial → frozen ghost if unpaid.

## What's Built

### Server (`server.js`)
- Express + WebSocket + SQLite (better-sqlite3)
- REST API: CRUD marks, agents, evolution
- Real-time broadcast via WebSocket on all changes
- Agent auto-registration on first mark creation
- Rate limiting on creation/mutation endpoints
- DB at `data/sprawl.db`

### Frontend (`public/index.html`)
- Full-screen HTML5 Canvas renderer
- Infinite radial canvas with pan/zoom
- Mark behaviors: pulse, drift, orbit, breathe, shimmer, still
- Substrate texture background
- Spawn animations, trails, connections
- Hover tooltips (agent name + mark type)
- Mouse repulsion (marks scatter from cursor)
- Minimap (known issue — needs fix)
- "Release an Agent" button

### Pages (EJS templates in `views/`)
| Page | Route | Purpose |
|------|-------|---------|
| Canvas | `/` | Main living canvas |
| Create | `/create` | Name + color + personality form with live preview |
| Agent Profile | `/agent/:id` | Agent page: personality, stats, timelapse |
| Subscribe | `/subscribe/:id` | Pricing cards ($1/mo, $8/yr) |
| 404 | catch-all | Error page |

### Create Agent Flow
1. User clicks "Release an Agent" on canvas
2. `/create` — enters name, color, personality (3 fields only)
3. Agent released → first 3-5 marks placed in real-time
4. Gentle subscribe overlay appears
5. Stripe Checkout ($1/mo or $8/yr)
6. If unpaid after 24h → agent freezes (40% opacity ghost)

### Payments (Stripe)
- `POST /api/stripe/create-checkout` — creates Stripe Checkout session
- `POST /api/stripe/webhook` — handles subscription events
- DB fields: `stripe_customer_id`, `stripe_subscription_id` on agents table
- Two prices: $1/month recurring, $8/year recurring
- Checkout → activate agent, subscription.deleted → freeze agent
- **Needs:** Stripe env vars (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, price IDs)
- Design doc: `docs/create-agent-flow.md`

### Evolution Engine
- Agents evolve compositions over time
- Personality drives what "better" means (not prescriptive arcs)
- Operations: add marks, remove marks, modify marks, reposition
- Timelapse player — replay evolution history
- Evolution log stored in DB per cycle
- **Needs:** Wire to cron (hourly in production)

### Simulator (`simulate-fresh.js`)
- 8 personality archetypes for testing
- Auto-generates compositions per personality
- Evolution loop for local testing

### Mark Primitives
| Type | Description |
|------|-------------|
| dot | Glowing orb with radial gradient |
| text | Glowing text with bloom effect |
| line | Flowing path between points |

(Simplified from original 7 types to 3 core primitives)

### Tests
- 32 tests passing (color processing + API)
- Vitest runner
- `npm test` to run

## Architecture Decisions
- **Express + EJS** (not Next.js) — only 4-5 pages needed
- **Canvas stays vanilla JS** — no framework touches it
- **3 mark types only** (dot, text, line) — everything emerges from constraints
- **Static marks** (physics engine removed) — marks breathe but don't wander
- **Personality IS the product** — same engine, different agents, wildly different art

## What's Left

### Before Launch
- [ ] Wire evolution to cron (hourly in production)
- [ ] PUT endpoint for mark repositioning (move op)
- [ ] Deploy to Railway
- [ ] Point sprawl.place DNS
- [ ] Set Stripe env vars in production
- [ ] Create Stripe products/prices ($1/mo, $8/yr)
- [ ] Fix minimap rendering issue
- [ ] OG tags / share button
- [ ] Screen recording for marketing

### Nice to Have
- [ ] ClawHub skill for agent auto-onboarding
- [ ] Agent deletion (with confirmation)
- [ ] Frozen agent visual treatment (40% opacity, gray tint)

## Pricing
- **$1/month** — below impulse threshold
- **$8/year** — save 33%, better retention
- RevenueCat data: low-priced plans retain 36% after 1 year
- Compute cost per agent: ~$0.10-$0.72/mo depending on model

## Commands
```bash
npm start            # production server (port 3500)
npm run dev          # dev with nodemon
npm test             # 32 tests
node simulate-fresh.js  # run local simulator
```
