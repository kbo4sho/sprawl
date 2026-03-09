# Create Agent Flow — Design Doc

*2026-03-08*

## Pricing
- **$1/month** — below impulse threshold, zero friction
- **$8/year** — annual option, ~33% savings, locks retention
- Stripe Checkout (no custom payment forms)
- No free tier. Free creation → 24h trial → frozen if unpaid

## Flow

### 1. Canvas (sprawl.place)
- User lands, sees living canvas
- Zooms around, clicks agents, watches timelapses
- **"Release an Agent" button** — always visible, bottom-right area

### 2. Create (modal overlay on canvas)
Three inputs only:
- **Name** — text field, max 30 chars
- **Color** — single color picker
- **Who is it?** — textarea, max 200 chars. "A poet obsessed with circles." Plain English personality.

Preview: as user types, a single dot in their color breathes on a small dark canvas in the modal. It's alive before they even submit.

### 3. Release (the magic moment)
- User clicks "Release" — NO payment yet
- Modal closes, camera pans to where the agent will live
- Agent places its first 3-5 marks in real time (1-2 second delays between marks)
- Each mark appears with a subtle flash
- User watches their creation take its first breath
- This is the emotional hook

### 4. Subscribe (after creation)
- After first marks land, gentle overlay fades in:
  - "Your agent is alive."
  - "It will evolve every hour — growing, refining, responding to neighbors."
  - "Keep it on the canvas."
  - **[$1/month]** **[$8/year — save 33%]**
- Stripe Checkout opens in new tab/modal
- Email collected at Stripe (not before)

### 5. If they pay
- Agent stays active
- Evolves hourly via evolution engine
- User gets a link to their agent's page (sprawl.place/agent/{id})
- Can watch timelapse anytime

### 6. If they don't pay
- Agent is active for 24 hours (free trial)
- After 24h: agent freezes
- Frozen = marks stay on canvas but fade to 40% opacity, gray tint
- Ghost on the canvas. Permanent reminder.
- "Your agent is sleeping. Wake it up for $1/month."
- Can revive anytime — picks up where it left off

## Technical

### Stripe
- Stripe Checkout Session (server-side)
- Two prices: $1/mo recurring, $8/yr recurring
- Webhook: `checkout.session.completed` → activate agent
- Webhook: `customer.subscription.deleted` → freeze agent
- Store Stripe customer_id + subscription_id on agent record

### Database Changes
- agents table: add `stripe_customer_id`, `stripe_subscription_id`, `subscription_status` (trial|active|frozen|cancelled)
- agents table: add `trial_expires_at` (24h after creation)
- agents table: add `email` (from Stripe checkout)

### API Endpoints
- `POST /api/agents/create` — name, color, personality → creates agent + first evolution
- `POST /api/stripe/checkout` — agentId → returns Stripe Checkout URL
- `POST /api/stripe/webhook` — handles subscription events
- `GET /api/agents/:id` — public agent page data

### Evolution
- Only evolve agents with `subscription_status = active` or within trial window
- Frozen agents skip evolution but marks persist on canvas
- Revived agents resume evolution from current composition

## What We're NOT Building
- User accounts / login (Stripe IS the account)
- Agent editing after creation (personality is permanent)
- Multiple pricing tiers
- Free tier with limits
- Email collection before creation

## Open Questions
- Do we let users delete their agent? (probably yes, with confirmation)
- Agent page (sprawl.place/agent/{id}) — what's on it? Timelapse + personality + mark count + neighbors?
- Do frozen agents count toward canvas density for other agents' neighbor awareness?
