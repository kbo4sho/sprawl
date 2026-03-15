# Sprawl Canvas Pivot - Implementation Status

**Date:** 2026-03-14  
**Status:** Core backend complete, UI and rendering system pending

---

## ✅ Completed

### 1. Database Schema
- ✅ **Users table**: email-based, credits, Stripe customer ID
- ✅ **Contributions table**: tracks paid contributions with seed words
- ✅ **Purchases table**: Stripe payment tracking
- ✅ **Extended canvases table**: slug, subject, style_prompt, rules (JSON), current_render_url, contribution_count, render_interval
- ✅ All migrations run automatically on server start
- ✅ All existing tests still pass (72/72 passing)

### 2. API Endpoints

#### User Management
- ✅ `POST /api/users` - Create or get user by email
  - Returns user ID, credits, created timestamp
  - No password auth (simple email-only for MVP)

#### Contribution Flow
- ✅ `POST /api/canvas/:id/contribute` - Make a paid contribution
  - Requires userId, canvas ID
  - Optional seedWord (max 1 word)
  - Uses LLM (llmCall) to generate 1-5 primitives
  - Respects canvas color palette and allowed types
  - Rate limited: 1 contribution per hour per user per canvas
  - Deducts 1 credit
  - Increments canvas contribution_count
  - Logs when render should be triggered (every N contributions)
  - System-generated marks use `agent_id='system'`

#### Payment System
- ✅ `POST /api/stripe/create-checkout` - Create Stripe checkout session
  - Supports: single ($2), pack_10 ($16), pack_50 ($70)
  - Returns sessionId and checkout URL
- ✅ `POST /api/stripe/webhook` - Stripe payment webhook
  - Handles `checkout.session.completed` events
  - Automatically grants credits
  - Records purchase in database
- ✅ `POST /api/purchases` - Manual purchase recording (for testing)

#### Canvas Management
- ✅ `POST /api/canvas/create` - Admin endpoint for creating canvases
  - Protected by `ADMIN_SECRET` env var
  - Accepts: name, theme, subject, stylePrompt, rules (JSON), renderInterval
  - Auto-generates slug from name

### 3. Primitive Types
- ✅ **Dot**: position, size, color, opacity
- ✅ **Line**: start (x,y), end (x2,y2), size, color, opacity
- ✅ **Text**: position, text (max 10 chars), size, color, opacity
- ✅ **Arc**: position, radius, startAngle, endAngle, size, color, opacity (NEW)
  - Arc meta stored as JSON: `{radius, startAngle, endAngle}`

### 4. Seed Data
- ✅ `seed-canvases.js` script creates two starter canvases:
  - **Neon City**: cyberpunk nightscape, neon palette (cyan, magenta, electric blue, white), all primitive types
  - **Wildflower**: meadow, warm palette (greens, yellows, pinks, orange), dots and arcs only
- ✅ Both set to render every 25 contributions

### 5. Agent Infrastructure
- ✅ **Kept intact** for Garden later
- ✅ Canvas contributions don't require agent auth
- ✅ System-generated marks use `agent_id='system'`
- ✅ Existing agent API endpoints unchanged

---

## ❌ Not Yet Implemented

### 1. Dual-Layer Rendering System (CRITICAL)
The Canvas pivot's key feature is the two-layer rendering:

**Layer 1: Primitive** (✅ exists)
- The existing mark system (dots, lines, text, arcs)
- Renders live via WebSocket updates
- SVG/canvas rendering on frontend

**Layer 2: Rendered** (❌ not implemented)
- Trigger: every N contributions (default 25)
- Process:
  1. Rasterize current primitive layer to PNG (using node-canvas or similar)
  2. Pass PNG + canvas style_prompt to OpenAI image generation API
  3. Save rendered image to `public/renders/[canvas_id]/[timestamp].png`
  4. Update `canvases.current_render_url` in database
- Display rendered image as hero on canvas page
- Toggle between primitive view and rendered view

**What needs to be built:**
- Rasterization function (SVG/canvas → PNG)
- OpenAI image generation integration (use `OPENAI_API_KEY` env var)
- Async job system for rendering (don't block contribution endpoint)
- Storage directory structure: `public/renders/[canvas_id]/`
- Update canvas record with latest render URL

### 2. UI Overhaul
Current UI is agent-focused. Canvas pivot needs:

**Landing page** (`views/home.ejs`)
- Grid of active canvases
- Each card shows latest rendered image (fallback to primitive preview)
- Canvas name, contribution count, "Contribute $2" CTA

**Canvas page** (`views/canvas.ejs`)
- Hero section: latest rendered image
- Live primitive layer view (existing canvas viewer)
- Toggle button to switch between primitive/rendered views
- Contributor list (from contributions table)
- "Contribute" flow:
  - Show credit balance
  - Optional seed word input (1 word max)
  - "Contribute $2" button → Stripe checkout or use existing credits

**Archive page** (new)
- Grid of archived canvases
- Timelapse videos (future: generate from snapshots)
- Contributor credits

### 3. Stripe Configuration
- Set `STRIPE_SECRET_KEY` env var
- Set `STRIPE_WEBHOOK_SECRET` for production
- Set `BASE_URL` for Stripe redirect URLs
- Test checkout flow end-to-end

### 4. Testing
- Add tests for contribution flow
- Add tests for Stripe webhook handler
- Add tests for arc primitive type
- Test dual-layer rendering when implemented

---

## 🚀 How to Use (Current State)

### 1. Start the server
```bash
cd ~/clawd/projects/sprawl
node server.js
```

Migrations will run automatically, creating new tables and columns.

### 2. Seed starter canvases
```bash
node seed-canvases.js
```

Creates "Neon City" and "Wildflower" canvases.

### 3. Create a user
```bash
curl -X POST http://localhost:3500/api/users \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

Returns:
```json
{
  "id": "uuid",
  "email": "test@example.com",
  "credits": 0,
  "createdAt": 1234567890
}
```

### 4. Grant credits (testing only)
```bash
curl -X POST http://localhost:3500/api/purchases \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<user_id>",
    "type": "pack_10",
    "amountCents": 1600
  }'
```

Grants 10 credits.

### 5. Make a contribution
```bash
curl -X POST http://localhost:3500/api/canvas/<canvas_id>/contribute \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<user_id>",
    "seedWord": "neon"
  }'
```

Returns:
```json
{
  "contributionId": "uuid",
  "marks": [ /* 1-5 primitives placed */ ],
  "creditsRemaining": 9,
  "canvasContributionCount": 1,
  "renderTriggered": false
}
```

When `contribution_count % render_interval === 0`, `renderTriggered: true` — but no actual render happens yet (not implemented).

### 6. Get canvas info
```bash
curl http://localhost:3500/api/canvas/<canvas_id>
```

### 7. Create a custom canvas (admin)
```bash
curl -X POST http://localhost:3500/api/canvas/create \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "sprawl-admin",
    "name": "My Canvas",
    "theme": "A surreal dreamscape",
    "subject": "abstract dream",
    "stylePrompt": "surrealist, dreamlike, soft focus",
    "rules": {
      "colorPalette": ["#ff0000", "#00ff00", "#0000ff"],
      "allowedTypes": ["dot", "arc"],
      "maxPrimitives": 3
    },
    "renderInterval": 10
  }'
```

---

## 📋 Next Steps (Priority Order)

1. **Dual-layer rendering** (most important)
   - Add rasterization (canvas → PNG)
   - Add OpenAI image generation call
   - Async job system
   - Store renders in public/renders/

2. **Update UI**
   - Landing page: canvas grid
   - Canvas page: hero render, primitive toggle, contribute CTA
   - Contribute modal: seed word input, Stripe checkout

3. **Stripe testing**
   - Configure Stripe keys
   - Test checkout flow
   - Test webhook

4. **Archive system**
   - Timelapse generation from contribution history
   - Archive page UI

5. **Polish**
   - Error handling
   - Loading states
   - Rate limiting feedback
   - Canvas rotation logic (monthly/weekly)

---

## 🔧 Environment Variables

Required for full functionality:
```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...  # optional for development
BASE_URL=https://sprawl.place    # for Stripe redirects

# OpenAI (for rendering)
OPENAI_API_KEY=sk-...

# Admin
ADMIN_SECRET=sprawl-admin  # default, change in production

# Database
RAILWAY_VOLUME_MOUNT_PATH=/data  # production only
```

---

## 🧪 Testing

All existing tests pass:
```bash
npm test
```

**Test coverage:**
- ✅ Color processing (15 tests)
- ✅ Gardener module (13 tests)
- ✅ Archive pipeline (7 tests)
- ✅ API keys (19 tests)
- ✅ API (18 tests)

**Total: 72/72 passing**

New endpoints (users, contributions, purchases, Stripe) need test coverage.

---

## 📝 Notes

- The existing agent infrastructure is **completely intact** — Garden can still be built on top
- Canvas contributions use `agent_id='system'` to distinguish from agent-owned marks
- The LLM-driven primitive placement works well — tested with the existing `llmCall` function
- Arc primitive type added but not yet rendered in UI (needs canvas.ejs update)
- Stripe integration is ready but untested (needs real keys)
- The task explicitly said NOT to deploy yet — Kevin will review first

---

## 🎯 Summary

**What's done:** Full backend for Canvas pivot — users, credits, payments, LLM-driven contributions, arc primitives, seed data.

**What's needed:** Dual-layer rendering system (OpenAI image generation), UI updates, Stripe testing.

**Estimated remaining work:** 4-6 hours for rendering + UI + testing.

**Status:** Ready for review and next phase.
