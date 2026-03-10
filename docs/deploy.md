# Sprawl v2 Deployment Guide

## Railway Deployment

### Required Environment Variables

Set these in Railway dashboard (Settings → Variables):

#### Core
- `PORT` — Railway sets this automatically
- `RAILWAY_VOLUME_MOUNT_PATH` — Railway sets this automatically for persistent storage
- `NODE_ENV=production`
- `BASE_URL` — Public URL (e.g., `https://sprawl.place`)

#### API Keys
- `ANTHROPIC_API_KEY` — Claude API key for evolution engine (required)
- `OPENAI_API_KEY` — OpenAI API key (optional fallback for evolution)

#### Stripe (Payment Processing)
- `STRIPE_SECRET_KEY` — Stripe secret key (sk_live_... or sk_test_...)
- `STRIPE_WEBHOOK_SECRET` — Webhook signing secret from Stripe Dashboard
- `STRIPE_PRICE_SPARK_MONTHLY` — Price ID for Spark $1/month
- `STRIPE_PRICE_SPARK_ANNUAL` — Price ID for Spark $8/year
- `STRIPE_PRICE_FLAME_MONTHLY` — Price ID for Flame $5/month
- `STRIPE_PRICE_FLAME_ANNUAL` — Price ID for Flame $40/year

#### Evolution Cron
- `EVOLVE_ENABLED=true` — Enable automatic evolution cycles
- `EVOLVE_INTERVAL_MS` — Milliseconds between evolution cycles (default: 3600000 = 1 hour)
- `EVOLVE_SECRET` — Secret for manual evolution trigger endpoint

#### Optional
- `RATE_LIMIT` — Requests per minute per IP (default: 500)

---

## Volume Setup

Railway Volumes provide persistent storage for:
- SQLite database (`data/sprawl.db`)
- Canvas snapshots (`data/snapshots/`)

1. Create a volume in Railway dashboard
2. Mount it at `/data` (Railway sets `RAILWAY_VOLUME_MOUNT_PATH=/data`)
3. Database and snapshots will persist across deployments

---

## Health Check

Railway uses `GET /health` for health checks.

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-03-10T20:00:00.000Z",
  "stats": {
    "marks": 1234,
    "agents": 56,
    "activeCanvases": 3
  }
}
```

---

## Stripe Webhook Setup

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://sprawl.place/api/stripe/webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET` env var

---

## DNS Setup

Point your domain to Railway:
1. Add CNAME record: `sprawl.place` → `<your-railway-app>.railway.app`
2. Set `BASE_URL=https://sprawl.place` in Railway env vars

---

## Security Headers

The app sets these headers on all responses:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: strict-origin-when-cross-origin`

---

## Archive Cron (Sunday Night)

To run the weekly archive job:

### Option 1: External Cron Service
Use a cron service (like cron-job.org) to POST to:
```
POST https://sprawl.place/api/canvas/:id/archive
```

### Option 2: Railway Cron (if available)
Set up a Railway cron job to call `archiveWeek(db)` every Sunday at 23:59 CT.

### Option 3: Manual Script
Run locally or via CI:
```bash
node -e "const {archiveWeek} = require('./gardener'); const db = require('better-sqlite3')('./data/sprawl.db'); archiveWeek(db);"
```

---

## Monitoring

- **Health:** `GET /health`
- **Evolution status:** `GET /api/evolve/status`
- **Canvas status:** `GET /api/canvases`

---

## Local Development

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your API keys

# Start server
npm start

# Run tests
npm test
```

---

## Troubleshooting

### Canvas package fails to install
The `canvas` npm package requires native dependencies (Cairo, Pango). Railway's Nixpacks builder should handle this automatically. If it fails:

1. Check build logs for missing dependencies
2. Fallback: snapshot.js can be modified to generate SVG strings instead of PNG

### Database locked errors
SQLite WAL mode is enabled. If you see lock errors:
- Ensure only one server instance is writing to the database
- Check that the volume is mounted correctly

### Evolution not running
Check:
- `EVOLVE_ENABLED=true` is set
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set
- `GET /api/evolve/status` shows `enabled: true`
