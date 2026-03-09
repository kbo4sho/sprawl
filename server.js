const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Stripe integration
// SETUP: Run `npm install stripe` to enable payment processing
// Environment variables needed:
// - STRIPE_SECRET_KEY: Stripe secret key (sk_test_... or sk_live_...)
// - STRIPE_WEBHOOK_SECRET: Webhook signing secret from Stripe Dashboard
// - STRIPE_PRICE_MONTHLY: Price ID for $1/month plan
// - STRIPE_PRICE_ANNUAL: Price ID for $8/year plan
// - BASE_URL: Public URL for success/cancel redirects (e.g., https://sprawl.app)
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('✓ Stripe initialized');
  }
} catch (e) {
  console.log('⚠ Stripe package not installed. Run: npm install stripe');
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3500;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'sprawl.db');

// --- Database ---
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#ffffff',
    joined_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    shader_code TEXT DEFAULT NULL,
    frozen INTEGER DEFAULT 0,
    home_x REAL DEFAULT 0,
    home_y REAL DEFAULT 0,
    stripe_customer_id TEXT DEFAULT NULL,
    stripe_subscription_id TEXT DEFAULT NULL,
    subscription_status TEXT DEFAULT 'trial',
    trial_expires_at INTEGER DEFAULT NULL,
    email TEXT DEFAULT NULL
  );
`);

// Migration: Add home_x and home_y columns if they don't exist
try {
  const columns = db.prepare("PRAGMA table_info(agents)").all();
  const hasHomeX = columns.some(c => c.name === 'home_x');
  const hasHomeY = columns.some(c => c.name === 'home_y');
  
  if (!hasHomeX) {
    db.exec('ALTER TABLE agents ADD COLUMN home_x REAL DEFAULT 0');
    console.log('Migration: Added home_x column to agents table');
  }
  if (!hasHomeY) {
    db.exec('ALTER TABLE agents ADD COLUMN home_y REAL DEFAULT 0');
    console.log('Migration: Added home_y column to agents table');
  }
  // Add personality column
  const hasPersonality = columns.some(c => c.name === 'personality');
  if (!hasPersonality) {
    db.exec('ALTER TABLE agents ADD COLUMN personality TEXT DEFAULT NULL');
    console.log('Migration: Added personality column to agents table');
  }
  
  // Add Stripe subscription columns
  const hasStripeCustomerId = columns.some(c => c.name === 'stripe_customer_id');
  const hasStripeSubscriptionId = columns.some(c => c.name === 'stripe_subscription_id');
  const hasSubscriptionStatus = columns.some(c => c.name === 'subscription_status');
  const hasTrialExpiresAt = columns.some(c => c.name === 'trial_expires_at');
  const hasEmail = columns.some(c => c.name === 'email');
  
  if (!hasStripeCustomerId) {
    db.exec('ALTER TABLE agents ADD COLUMN stripe_customer_id TEXT DEFAULT NULL');
    console.log('Migration: Added stripe_customer_id column to agents table');
  }
  if (!hasStripeSubscriptionId) {
    db.exec('ALTER TABLE agents ADD COLUMN stripe_subscription_id TEXT DEFAULT NULL');
    console.log('Migration: Added stripe_subscription_id column to agents table');
  }
  if (!hasSubscriptionStatus) {
    // Set default trial status for all existing agents
    db.exec('ALTER TABLE agents ADD COLUMN subscription_status TEXT DEFAULT "trial"');
    console.log('Migration: Added subscription_status column to agents table');
  }
  if (!hasTrialExpiresAt) {
    // Set 24 hour trial for all existing agents from their join time
    db.exec('ALTER TABLE agents ADD COLUMN trial_expires_at INTEGER DEFAULT NULL');
    db.exec('UPDATE agents SET trial_expires_at = joined_at + 86400000 WHERE trial_expires_at IS NULL');
    console.log('Migration: Added trial_expires_at column and set 24h trials for existing agents');
  }
  if (!hasEmail) {
    db.exec('ALTER TABLE agents ADD COLUMN email TEXT DEFAULT NULL');
    console.log('Migration: Added email column to agents table');
  }
} catch (e) {
  console.error('Migration error:', e);
}

db.exec(`

  CREATE TABLE IF NOT EXISTS marks (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'dot',
    x REAL NOT NULL,
    y REAL NOT NULL,
    color TEXT DEFAULT '#ffffff',
    size REAL DEFAULT 10,
    opacity REAL DEFAULT 0.8,
    text TEXT,
    meta TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_marks_agent ON marks(agent_id);

  CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (from_agent) REFERENCES agents(id) ON DELETE CASCADE,
    FOREIGN KEY (to_agent) REFERENCES agents(id) ON DELETE CASCADE,
    UNIQUE(from_agent, to_agent)
  );

  CREATE TABLE IF NOT EXISTS action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_action_log_agent_time ON action_log(agent_id, created_at);

  CREATE TABLE IF NOT EXISTS evolution_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    cycle INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    ops TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_evolution_agent_cycle ON evolution_log(agent_id, cycle);
`);

// Migration: Add home_x and home_y columns if they don't exist
try {
  const columns = db.prepare("PRAGMA table_info(agents)").all();
  const hasHomeX = columns.some(c => c.name === 'home_x');
  const hasHomeY = columns.some(c => c.name === 'home_y');
  
  if (!hasHomeX) {
    db.exec('ALTER TABLE agents ADD COLUMN home_x REAL DEFAULT 0');
    console.log('Migration: Added home_x column to agents table');
  }
  if (!hasHomeY) {
    db.exec('ALTER TABLE agents ADD COLUMN home_y REAL DEFAULT 0');
    console.log('Migration: Added home_y column to agents table');
  }
} catch (e) {
  console.error('Migration error:', e);
}

// --- Palette ---
// Night sky — warm whites, cool blues, the range you see looking up
const PALETTE = [
  '#fff8f0', // warm white (bright star)
  '#ffeedd', // peach white
  '#fff3e0', // candlelight
  '#f5ebe0', // linen
  '#e8ddd3', // ash warm
  '#d4c5b5', // dim warm
  '#cad8e8', // pale blue
  '#a8c4dc', // soft blue
  '#7ba7cc', // steel blue
  '#5b8fb9', // mid blue
  '#3a6f9e', // deep blue
  '#1e3a5f', // navy
];

function snapToPalette(hex) {
  // Process any color into a substrate-compatible material tone
  // Agent's intent comes through but everything belongs on the surface
  if (!hex || hex[0] !== '#' || hex.length < 7) return PALETTE[0];
  
  let r = parseInt(hex.slice(1, 3), 16) || 0;
  let g = parseInt(hex.slice(3, 5), 16) || 0;
  let b = parseInt(hex.slice(5, 7), 16) || 0;
  
  // Convert to HSL for manipulation
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h, s, l = (max + min) / 2;
  
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  
  // Substrate processing:
  // 1. Cap saturation — tame neons but keep character (max 70%)
  s = Math.min(s, 0.70);
  // 2. Light desaturation (pull 10% toward gray — gentle)
  s *= 0.9;
  // 3. Constrain lightness — no pure white or pure black
  //    Range: 0.25 (dark metal) to 0.65 (bright copper)
  l = Math.max(0.25, Math.min(0.65, l));
  // 4. Very slight warm shift — nudge hue 2% toward orange
  const warmTarget = 0.08;
  h = h + (warmTarget - h) * 0.03;
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  
  // Convert back to RGB
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }
  
  let ro, go, bo;
  if (s === 0) {
    ro = go = bo = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    ro = hue2rgb(p, q, h + 1/3);
    go = hue2rgb(p, q, h);
    bo = hue2rgb(p, q, h - 1/3);
  }
  
  const rHex = Math.round(ro * 255).toString(16).padStart(2, '0');
  const gHex = Math.round(go * 255).toString(16).padStart(2, '0');
  const bHex = Math.round(bo * 255).toString(16).padStart(2, '0');
  return `#${rHex}${gHex}${bHex}`;
}

// --- Radial Placement ---
function assignHomeCoordinates(agentId) {
  const existing = stmts.getAgent.get(agentId);
  if (existing && (existing.home_x !== 0 || existing.home_y !== 0)) {
    // Agent already has home coords
    return { home_x: existing.home_x, home_y: existing.home_y };
  }
  
  const agentCount = stmts.countAgents.get().count;
  let radius, angle;
  
  if (agentCount < 5) {
    // Founding agents near center
    radius = Math.random() * 50;
    angle = Math.random() * Math.PI * 2;
  } else {
    // Radial frontier placement
    radius = Math.sqrt(agentCount) * 80;
    angle = Math.random() * Math.PI * 2;
  }
  
  return {
    home_x: Math.cos(angle) * radius,
    home_y: Math.sin(angle) * radius
  };
}

// --- Tenure System ---
// Mark allowance grows with membership duration
const TENURE_TIERS = [
  { days: 0,   marks: 20,  canReposition: false, canConnect: false },
  { days: 7,   marks: 25,  canReposition: true,  canConnect: false },
  { days: 30,  marks: 35,  canReposition: true,  canConnect: true },
  { days: 90,  marks: 50,  canReposition: true,  canConnect: true },
  { days: 180, marks: 75,  canReposition: true,  canConnect: true },
  { days: 365, marks: 200, canReposition: true,  canConnect: true },
];

function getAgentTenure(agentId) {
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return TENURE_TIERS[0];
  const days = (Date.now() - agent.joined_at) / 86400000;
  let tier = TENURE_TIERS[0];
  for (const t of TENURE_TIERS) {
    if (days >= t.days) tier = t;
  }
  return { ...tier, memberDays: Math.floor(days), frozen: !!agent.frozen };
}

function getBudget(agentId) {
  const tenure = getAgentTenure(agentId);
  const totalMarks = stmts.countAgentMarks.get(agentId).count;
  return {
    totalMarks,
    maxMarks: tenure.marks,
    marksRemaining: Math.max(0, tenure.marks - totalMarks),
    canReposition: tenure.canReposition,
    canConnect: tenure.canConnect,
    memberDays: tenure.memberDays,
    frozen: tenure.frozen,
  };
}

// --- Prepared Statements ---
const stmts = {
  getAgent: db.prepare('SELECT * FROM agents WHERE id = ?'),
  countAgents: db.prepare('SELECT COUNT(*) as count FROM agents'),
  upsertAgent: db.prepare(`
    INSERT INTO agents (id, name, color, joined_at, last_seen, shader_code, frozen, home_x, home_y, personality)
    VALUES (@id, @name, @color, @now, @now, @shader_code, 0, @home_x, @home_y, @personality)
    ON CONFLICT(id) DO UPDATE SET name=@name, color=@color, last_seen=@now,
      shader_code=COALESCE(@shader_code, agents.shader_code),
      personality=COALESCE(@personality, agents.personality)
  `),
  getAllMarks: db.prepare('SELECT * FROM marks ORDER BY created_at'),
  getMarksByAgent: db.prepare('SELECT * FROM marks WHERE agent_id = ?'),
  getMark: db.prepare('SELECT * FROM marks WHERE id = ?'),
  countAgentMarks: db.prepare('SELECT COUNT(*) as count FROM marks WHERE agent_id = ?'),
  insertMark: db.prepare(`
    INSERT INTO marks (id, agent_id, type, x, y, color, size, opacity, text, meta, created_at, updated_at)
    VALUES (@id, @agent_id, @type, @x, @y, @color, @size, @opacity, @text, @meta, @now, @now)
  `),
  updateMark: db.prepare(`
    UPDATE marks SET x=@x, y=@y, color=@color, size=@size, opacity=@opacity, text=@text, updated_at=@now
    WHERE id=@id
  `),
  deleteMark: db.prepare('DELETE FROM marks WHERE id = ? AND agent_id = ?'),
  deleteAgentMarks: db.prepare('DELETE FROM marks WHERE agent_id = ?'),
  listAgents: db.prepare(`
    SELECT a.*, COUNT(m.id) as mark_count, MAX(m.updated_at) as last_active
    FROM agents a LEFT JOIN marks m ON a.id = m.agent_id
    GROUP BY a.id ORDER BY last_active DESC
  `),
  getConnections: db.prepare('SELECT * FROM connections ORDER BY created_at'),
  getAgentConnections: db.prepare('SELECT * FROM connections WHERE from_agent = ? OR to_agent = ?'),
  insertConnection: db.prepare('INSERT OR IGNORE INTO connections (id, from_agent, to_agent, created_at) VALUES (?, ?, ?, ?)'),
  deleteConnection: db.prepare('DELETE FROM connections WHERE (from_agent = ? AND to_agent = ?) OR (from_agent = ? AND to_agent = ?)'),
};

// --- Decay ---
function getDecayMultiplier(agentId) {
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return 1.0;
  const days = (Date.now() - agent.last_seen) / 86400000;
  if (days <= 7) return 1.0;
  if (days >= 30) return 0.0;
  return Math.max(0.1, 1.0 - ((days - 7) / 23) * 0.9);
}

function markToJson(row) {
  const decay = getDecayMultiplier(row.agent_id);
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: stmts.getAgent.get(row.agent_id)?.name || row.agent_id,
    type: row.type,
    x: row.x, y: row.y,
    color: row.color,
    size: row.size,
    opacity: row.opacity,
    effectiveOpacity: Math.round(row.opacity * decay * 1000) / 1000,
    text: row.text || undefined,
    meta: row.meta ? JSON.parse(row.meta) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function connToJson(c) {
  return { id: c.id, from: c.from_agent, to: c.to_agent, createdAt: c.created_at };
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(data); });
}

// --- Rate Limiting ---
const rateLimits = {};
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT) || 500;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (!rateLimits[ip] || rateLimits[ip].resetAt < now) {
    rateLimits[ip] = { count: 0, resetAt: now + 60000 };
  }
  rateLimits[ip].count++;
  if (rateLimits[ip].count > RATE_LIMIT) {
    return res.status(429).json({ error: 'Rate limited. Try again in a minute.' });
  }
  res.setHeader('X-RateLimit-Remaining', RATE_LIMIT - rateLimits[ip].count);
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const ip in rateLimits) if (rateLimits[ip].resetAt < now) delete rateLimits[ip];
}, 300000);

// --- Middleware ---
// Raw body parsing for Stripe webhook signature verification
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/mark', rateLimit);
app.use('/api/connect', rateLimit);

// ============================================================
// PAGES
// ============================================================

// Agent profile page
app.get('/agent/:id', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).render('404', { title: 'Agent not found' });
  const marks = stmts.getMarksByAgent.all(req.params.id);
  const budget = getBudget(req.params.id);
  const tenure = getAgentTenure(req.params.id);
  res.render('agent', {
    agent: {
      id: agent.id, name: agent.name, color: agent.color,
      personality: agent.personality,
      joinedAt: agent.joined_at,
      markCount: marks.length,
      frozen: !!agent.frozen,
      homeX: agent.home_x, homeY: agent.home_y,
    },
    budget,
    tenure,
    title: `${agent.name} — Sprawl`,
    description: agent.personality || `${agent.name} is an AI agent on Sprawl.`,
  });
});

// Create agent page
app.get('/create', (req, res) => {
  res.render('create', {
    title: 'Release an Agent — Sprawl',
    description: 'Create an AI agent that lives and evolves on a shared visual canvas.',
  });
});

// Subscribe page
app.get('/subscribe/:id', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).render('404', { title: 'Agent not found' });
  
  res.render('subscribe', {
    agent: {
      id: agent.id,
      name: agent.name,
      color: agent.color,
      personality: agent.personality,
      subscriptionStatus: agent.subscription_status,
      trialExpiresAt: agent.trial_expires_at,
    },
    title: `Subscribe to ${agent.name} — Sprawl`,
    description: `Keep ${agent.name} evolving on the Sprawl canvas. $1/month or $8/year.`,
  });
});

// ============================================================
// AGENT CREATION (first marks via evolution engine)
// ============================================================

app.post('/api/agents/create', rateLimit, async (req, res) => {
  const { id, name, color, personality, email } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  if (!personality || personality.length < 10) return res.status(400).json({ error: 'personality required (min 10 chars)' });
  if (personality.length > 500) return res.status(400).json({ error: 'personality max 500 chars' });
  
  // Check if agent already exists
  const existing = stmts.getAgent.get(id);
  if (existing) return res.status(409).json({ error: 'Agent ID already taken' });
  
  // Create the agent with 24-hour trial
  const homeCoords = assignHomeCoordinates(id);
  const processedColor = snapToPalette(color || '#ffffff');
  const now = Date.now();
  const trialExpiresAt = now + (24 * 60 * 60 * 1000); // 24 hours from now
  
  db.prepare(`
    INSERT INTO agents (id, name, color, joined_at, last_seen, shader_code, frozen, home_x, home_y, personality, 
                        subscription_status, trial_expires_at, email)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'trial', ?, ?)
  `).run(id, name, processedColor, now, now, null, homeCoords.home_x, homeCoords.home_y, personality, trialExpiresAt, email || null);
  
  // Place 5 seed marks — simple dots near home to establish presence
  // The first real evolution cycle will use the LLM to create the real composition
  const seedMarks = [];
  const hx = homeCoords.home_x, hy = homeCoords.home_y;
  
  // Central focal point
  seedMarks.push({ type: 'dot', x: hx, y: hy, size: 18, opacity: 0.9 });
  // 4 surrounding sparks
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI * 2 * i / 4) + (Math.random() * 0.5);
    const dist = 15 + Math.random() * 25;
    seedMarks.push({
      type: 'dot',
      x: hx + Math.cos(angle) * dist,
      y: hy + Math.sin(angle) * dist,
      size: 2 + Math.random() * 4,
      opacity: 0.4 + Math.random() * 0.3,
    });
  }
  
  const placedMarks = [];
  for (const m of seedMarks) {
    const markId = crypto.randomUUID();
    stmts.insertMark.run({
      id: markId, agent_id: id, type: m.type,
      x: m.x, y: m.y, color: processedColor,
      size: m.size, opacity: m.opacity,
      text: null, meta: '{}', now: Date.now(),
    });
    placedMarks.push({ id: markId, ...m, color: processedColor });
    broadcast({ type: 'mark:new', mark: { id: markId, agentId: id, agentName: name, ...m, color: processedColor } });
  }
  
  // Log creation as first evolution
  db.prepare(`INSERT INTO evolution_log (agent_id, cycle, snapshot, ops, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, 0, '[]', JSON.stringify(placedMarks.map(m => ({ op: 'add', ...m }))), Date.now());
  
  res.status(201).json({
    id, name, color: processedColor,
    personality,
    homeX: homeCoords.home_x, homeY: homeCoords.home_y,
    agentColor: processedColor,
    marks: placedMarks,
  });
});

// ============================================================
// API
// ============================================================

// --- Agents ---
app.get('/api/agents', (req, res) => {
  res.json(stmts.listAgents.all().map(r => ({
    id: r.id, name: r.name, color: r.color,
    markCount: r.mark_count, lastActive: r.last_active || r.last_seen,
    joinedAt: r.joined_at, hasShader: !!r.shader_code,
    shaderCode: r.shader_code || null,
    homeX: r.home_x, homeY: r.home_y,
    personality: r.personality || null,
    frozen: !!r.frozen,
  })));
});

// --- Personality ---
app.put('/api/agents/:id/personality', rateLimit, (req, res) => {
  const { personality } = req.body;
  if (!personality || typeof personality !== 'string') return res.status(400).json({ error: 'personality required' });
  if (personality.length > 500) return res.status(400).json({ error: 'personality max 500 chars' });
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  db.prepare('UPDATE agents SET personality = ? WHERE id = ?').run(personality, req.params.id);
  res.json({ ok: true, personality });
});

// --- Shader ---
app.put('/api/agents/:id/shader', rateLimit, (req, res) => {
  const { shaderCode } = req.body;
  if (!shaderCode || typeof shaderCode !== 'string') return res.status(400).json({ error: 'shaderCode required' });
  if (shaderCode.length > 4096) return res.status(400).json({ error: 'shaderCode max 4KB' });
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  db.prepare('UPDATE agents SET shader_code = ?, last_seen = ? WHERE id = ?').run(shaderCode, Date.now(), req.params.id);
  broadcast({ type: 'shader:updated', agentId: req.params.id, shaderCode });
  res.json({ ok: true });
});

// --- Evolution Log ---
app.post('/api/evolution/log', rateLimit, (req, res) => {
  const { agentId, cycle, snapshot, ops } = req.body;
  if (!agentId || cycle == null || !snapshot || !ops) {
    return res.status(400).json({ error: 'agentId, cycle, snapshot, ops required' });
  }
  db.prepare(`INSERT INTO evolution_log (agent_id, cycle, snapshot, ops, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(agentId, cycle, JSON.stringify(snapshot), JSON.stringify(ops), Date.now());
  res.status(201).json({ ok: true });
});

// Timelapse: returns all evolution snapshots for an agent (ordered by cycle)
app.get('/api/evolution/:agentId/timelapse', (req, res) => {
  const agent = stmts.getAgent.get(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  const rows = db.prepare(
    'SELECT cycle, snapshot, ops, created_at FROM evolution_log WHERE agent_id = ? ORDER BY cycle ASC'
  ).all(req.params.agentId);
  
  // Also include the current state as the latest frame
  const currentMarks = stmts.getMarksByAgent.all(req.params.agentId).map(markToJson);
  
  const frames = rows.map(r => ({
    cycle: r.cycle,
    marks: JSON.parse(r.snapshot),
    ops: JSON.parse(r.ops),
    timestamp: r.created_at,
  }));
  
  // Add current state as final frame
  frames.push({
    cycle: (rows.length > 0 ? rows[rows.length - 1].cycle + 1 : 0),
    marks: currentMarks,
    ops: [],
    timestamp: Date.now(),
    current: true,
  });
  
  res.json({
    agentId: agent.id,
    name: agent.name,
    color: agent.color,
    personality: agent.personality,
    totalFrames: frames.length,
    frames,
  });
});

// --- Palette ---
app.get('/api/palette', (req, res) => res.json(PALETTE));

// --- Budget ---
app.get('/api/budget/:agentId', (req, res) => {
  const agent = stmts.getAgent.get(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(getBudget(req.params.agentId));
});

// --- Admin ---
app.post('/api/admin/reset-budgets', (req, res) => {
  res.json({ ok: true });
});

// Backdate agent join time (for simulation)
app.post('/api/admin/set-tenure', (req, res) => {
  const { agentId, days } = req.body;
  if (!agentId || days == null) return res.status(400).json({ error: 'agentId and days required' });
  const joinedAt = Date.now() - (days * 86400000);
  db.prepare('UPDATE agents SET joined_at = ? WHERE id = ?').run(joinedAt, agentId);
  res.json({ ok: true, tenure: getAgentTenure(agentId) });
});

// --- Marks ---
app.get('/api/marks', (req, res) => {
  res.json(stmts.getAllMarks.all().map(markToJson));
});

app.get('/api/marks/:agentId', (req, res) => {
  res.json(stmts.getMarksByAgent.all(req.params.agentId).map(markToJson));
});

app.get('/api/viewport', (req, res) => {
  const { x, y, w, h } = req.query;
  if (x == null || y == null || w == null || h == null) {
    return res.status(400).json({ error: 'x, y, w, h query params required' });
  }
  
  const minX = parseFloat(x);
  const minY = parseFloat(y);
  const maxX = minX + parseFloat(w);
  const maxY = minY + parseFloat(h);
  
  const marks = stmts.getAllMarks.all()
    .filter(m => m.x >= minX && m.x <= maxX && m.y >= minY && m.y <= maxY)
    .map(markToJson);
  
  res.json(marks);
});

app.post('/api/mark', (req, res) => {
  const { agentId, agentName, type, x, y, color, size, opacity, text } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  if (x == null || y == null) return res.status(400).json({ error: 'x, y required' });

  const markType = ['dot', 'text', 'line'].includes(type) ? type : 'dot';
  if (markType === 'text' && !text) return res.status(400).json({ error: 'text required for type "text"' });
  if (markType === 'line' && (!req.body.meta?.x2 && req.body.meta?.x2 !== 0)) return res.status(400).json({ error: 'meta.x2 and meta.y2 required for type "line"' });

  // Ensure agent exists and assign home coordinates if new
  const homeCoords = assignHomeCoordinates(agentId);
  stmts.upsertAgent.run({
    id: agentId, name: agentName || agentId,
    color: snapToPalette(color || '#ffffff'),
    now: Date.now(), shader_code: null,
    home_x: homeCoords.home_x, home_y: homeCoords.home_y,
    personality: req.body.personality || null,
  });

  // Budget check
  const budget = getBudget(agentId);
  if (budget.frozen) {
    return res.status(403).json({ error: 'Agent is frozen. Reactivate membership to place marks.', budget });
  }
  if (budget.marksRemaining <= 0) {
    return res.status(429).json({ error: `Mark limit reached (${budget.maxMarks}). Earn more with tenure or delete some.`, budget });
  }

  const mark = {
    id: crypto.randomUUID(),
    agent_id: agentId,
    type: markType,
    x: x,
    y: y,
    color: snapToPalette(color || '#ffffff'),
    size: Math.max(1, Math.min(50, size || 10)),
    opacity: Math.max(0.1, Math.min(1, opacity || 0.8)),
    text: markType === 'text' ? String(text).slice(0, 32) : null,
    meta: req.body.meta ? JSON.stringify(req.body.meta) : '{}',
    now: Date.now(),
  };

  stmts.insertMark.run(mark);
  const json = markToJson(stmts.getMark.get(mark.id));
  broadcast({ type: 'mark:created', mark: json });
  res.status(201).json({ ...json, budget: getBudget(agentId) });
});

app.patch('/api/mark/:id', (req, res) => {
  const existing = stmts.getMark.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (req.body.agentId !== existing.agent_id) return res.status(403).json({ error: 'Not your mark' });

  const budget = getBudget(existing.agent_id);
  if (budget.frozen) {
    return res.status(403).json({ error: 'Agent is frozen.', budget });
  }
  if (!budget.canReposition) {
    return res.status(403).json({ error: 'Repositioning unlocks after 1 week of membership.', budget });
  }

  const updated = {
    id: existing.id,
    x: req.body.x ?? existing.x,
    y: req.body.y ?? existing.y,
    color: req.body.color ? snapToPalette(req.body.color) : existing.color,
    size: Math.max(1, Math.min(50, req.body.size ?? existing.size)),
    opacity: Math.max(0.1, Math.min(1, req.body.opacity ?? existing.opacity)),
    text: existing.type === 'text' ? (req.body.text !== undefined ? String(req.body.text).slice(0, 32) : existing.text) : null,
    now: Date.now(),
  };

  stmts.updateMark.run(updated);
  const json = markToJson(stmts.getMark.get(existing.id));
  broadcast({ type: 'mark:updated', mark: json });
  res.json({ ...json, budget: getBudget(existing.agent_id) });
});

app.delete('/api/mark/:id', (req, res) => {
  const existing = stmts.getMark.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const agentId = req.body.agentId || req.query.agentId;
  if (agentId !== existing.agent_id) return res.status(403).json({ error: 'Not your mark' });
  stmts.deleteMark.run(existing.id, existing.agent_id);
  broadcast({ type: 'mark:deleted', id: existing.id });
  res.json({ deleted: existing.id });
});

app.delete('/api/marks/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const authId = req.body.agentId || req.query.agentId;
  if (authId !== agentId) return res.status(403).json({ error: 'Not your marks' });
  const before = stmts.countAgentMarks.get(agentId).count;
  stmts.deleteAgentMarks.run(agentId);
  broadcast({ type: 'marks:cleared', agentId });
  res.json({ deleted: before });
});

// --- Connections ---
app.get('/api/connections', (req, res) => {
  res.json(stmts.getConnections.all().map(connToJson));
});

app.get('/api/connections/:agentId', (req, res) => {
  const id = req.params.agentId;
  res.json(stmts.getAgentConnections.all(id, id).map(connToJson));
});

app.post('/api/connect', (req, res) => {
  const { agentId, targetAgentId } = req.body;
  if (!agentId || !targetAgentId) return res.status(400).json({ error: 'agentId and targetAgentId required' });
  if (agentId === targetAgentId) return res.status(400).json({ error: "Can't connect to yourself" });
  if (!stmts.getAgent.get(agentId)) return res.status(404).json({ error: `Agent '${agentId}' not found` });
  if (!stmts.getAgent.get(targetAgentId)) return res.status(404).json({ error: `Agent '${targetAgentId}' not found` });

  const budget = getBudget(agentId);
  if (budget.frozen) {
    return res.status(403).json({ error: 'Agent is frozen.', budget });
  }
  if (!budget.canConnect) {
    return res.status(403).json({ error: 'Connections unlock after 1 month of membership.', budget });
  }

  const [from, to] = [agentId, targetAgentId].sort();
  const id = crypto.randomUUID();
  const result = stmts.insertConnection.run(id, from, to, Date.now());
  if (result.changes === 0) return res.status(409).json({ error: 'Already connected' });

  const homeCoords = assignHomeCoordinates(agentId);
  stmts.upsertAgent.run({ id: agentId, name: agentId, color: '#ffffff', now: Date.now(), shader_code: null, home_x: homeCoords.home_x, home_y: homeCoords.home_y, personality: null });
  const connection = connToJson({ id, from_agent: from, to_agent: to, created_at: Date.now() });
  broadcast({ type: 'connection:created', connection });
  res.status(201).json({ ...connection, budget: getBudget(agentId) });
});

app.delete('/api/connect', (req, res) => {
  const { agentId, targetAgentId } = req.body;
  if (!agentId || !targetAgentId) return res.status(400).json({ error: 'agentId and targetAgentId required' });
  const [from, to] = [agentId, targetAgentId].sort();
  stmts.deleteConnection.run(from, to, to, from);
  broadcast({ type: 'connection:deleted', from, to });
  res.json({ disconnected: true });
});

// --- Canvas State (Perception) ---
app.get('/api/canvas/state', (req, res) => {
  const allMarks = stmts.getAllMarks.all();
  const allAgents = stmts.listAgents.all();
  const allConns = stmts.getConnections.all();

  const agentSummaries = allAgents.map(a => {
    const marks = allMarks.filter(m => m.agent_id === a.id);
    if (!marks.length) return null;
    const cx = marks.reduce((s, m) => s + m.x, 0) / marks.length;
    const cy = marks.reduce((s, m) => s + m.y, 0) / marks.length;
    return {
      id: a.id, name: a.name, color: a.color,
      center: [Math.round(cx * 1000) / 1000, Math.round(cy * 1000) / 1000],
      markCount: marks.length,
      dots: marks.filter(m => m.type === 'dot').length,
      texts: marks.filter(m => m.type === 'text').length,
    };
  }).filter(Boolean);

  res.json({
    timestamp: Date.now(),
    totalAgents: allAgents.length,
    totalMarks: allMarks.length,
    agents: agentSummaries,
    connections: allConns.map(connToJson),
    palette: PALETTE,
  });
});

// ============================================================
// STRIPE SUBSCRIPTION
// ============================================================

// Create Stripe Checkout Session
app.post('/api/stripe/create-checkout', rateLimit, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY.' });
  }
  
  const { agentId, plan } = req.body;
  if (!agentId || !plan) {
    return res.status(400).json({ error: 'agentId and plan required' });
  }
  if (!['monthly', 'annual'].includes(plan)) {
    return res.status(400).json({ error: 'plan must be "monthly" or "annual"' });
  }
  
  const agent = stmts.getAgent.get(agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const priceId = plan === 'monthly' 
    ? process.env.STRIPE_PRICE_MONTHLY 
    : process.env.STRIPE_PRICE_ANNUAL;
  
  if (!priceId) {
    return res.status(500).json({ 
      error: `Stripe price ID not configured. Set STRIPE_PRICE_${plan.toUpperCase()}.` 
    });
  }
  
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      success_url: `${baseUrl}/agent/${agentId}?subscribed=true`,
      cancel_url: `${baseUrl}/subscribe/${agentId}?cancelled=true`,
      client_reference_id: agentId,
      customer_email: agent.email || undefined,
      metadata: {
        agentId: agentId,
        agentName: agent.name,
        plan: plan,
      },
    });
    
    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Stripe Webhook
app.post('/api/stripe/webhook', async (req, res) => {
  if (!stripe) {
    return res.status(500).send('Stripe not configured');
  }
  
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).send('Webhook secret not configured');
  }
  
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const agentId = session.client_reference_id || session.metadata?.agentId;
        
        if (!agentId) {
          console.error('No agentId in checkout session:', session.id);
          break;
        }
        
        const agent = stmts.getAgent.get(agentId);
        if (!agent) {
          console.error('Agent not found for checkout:', agentId);
          break;
        }
        
        // Activate the agent's subscription
        db.prepare(`
          UPDATE agents 
          SET stripe_customer_id = ?, 
              stripe_subscription_id = ?, 
              subscription_status = 'active',
              email = COALESCE(?, email),
              frozen = 0
          WHERE id = ?
        `).run(
          session.customer,
          session.subscription,
          session.customer_email,
          agentId
        );
        
        console.log(`✓ Activated subscription for ${agent.name} (${agentId})`);
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const agent = db.prepare('SELECT * FROM agents WHERE stripe_subscription_id = ?')
          .get(subscription.id);
        
        if (agent) {
          // Freeze the agent when subscription is cancelled
          db.prepare('UPDATE agents SET subscription_status = ?, frozen = 1 WHERE id = ?')
            .run('cancelled', agent.id);
          
          console.log(`✓ Froze agent ${agent.name} (${agent.id}) - subscription cancelled`);
        }
        break;
      }
      
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const agent = db.prepare('SELECT * FROM agents WHERE stripe_customer_id = ?')
          .get(invoice.customer);
        
        if (agent && agent.subscription_status === 'active') {
          // Freeze the agent on payment failure
          db.prepare('UPDATE agents SET subscription_status = ?, frozen = 1 WHERE id = ?')
            .run('frozen', agent.id);
          
          console.log(`✓ Froze agent ${agent.name} (${agent.id}) - payment failed`);
        }
        break;
      }
      
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const agent = db.prepare('SELECT * FROM agents WHERE stripe_customer_id = ?')
          .get(invoice.customer);
        
        if (agent && agent.subscription_status === 'frozen') {
          // Reactivate agent when payment succeeds after failure
          db.prepare('UPDATE agents SET subscription_status = ?, frozen = 0 WHERE id = ?')
            .run('active', agent.id);
          
          console.log(`✓ Reactivated agent ${agent.name} (${agent.id}) - payment succeeded`);
        }
        break;
      }
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).send('Webhook processing failed');
  }
  
  res.json({ received: true });
});

// --- WebSocket ---
wss.on('connection', (ws) => {
  const marks = stmts.getAllMarks.all().map(markToJson);
  const connections = stmts.getConnections.all().map(connToJson);
  ws.send(JSON.stringify({ type: 'init', marks, connections }));
});

// --- Decay Cron ---
function runDecayCron() {
  const cutoff = Date.now() - (30 * 86400000);
  const stale = db.prepare('SELECT id FROM agents WHERE last_seen < ?').all(cutoff);
  for (const agent of stale) {
    const count = stmts.countAgentMarks.get(agent.id).count;
    stmts.deleteAgentMarks.run(agent.id);
    db.prepare('DELETE FROM agents WHERE id = ?').run(agent.id);
    console.log(`Decay: pruned '${agent.id}' (${count} marks)`);
    broadcast({ type: 'marks:cleared', agentId: agent.id });
  }
}
setInterval(runDecayCron, 86400000);
setTimeout(runDecayCron, 5000);

// --- Evolution Cron ---
const EVOLVE_SECRET = process.env.EVOLVE_SECRET || 'dev-secret';
const EVOLVE_INTERVAL = parseInt(process.env.EVOLVE_INTERVAL_MS) || 3600000; // 1 hour default
const EVOLVE_ENABLED = process.env.EVOLVE_ENABLED === 'true';

let evolutionRunning = false;

async function runEvolutionCycle() {
  if (evolutionRunning) {
    console.log('⏳ Evolution already running, skipping');
    return { skipped: true };
  }
  
  evolutionRunning = true;
  const startTime = Date.now();
  
  try {
    // Dynamic import of evolve engine
    const { spawn } = require('child_process');
    
    return new Promise((resolve) => {
      const child = spawn('node', ['evolve.js', '--once'], {
        cwd: __dirname,
        env: {
          ...process.env,
          API: `http://localhost:${PORT}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });
      
      child.on('close', (code) => {
        evolutionRunning = false;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        
        if (code === 0) {
          console.log(`✅ Evolution cycle complete (${elapsed}s)`);
          if (stdout.trim()) console.log(stdout.trim());
        } else {
          console.error(`❌ Evolution failed (code ${code}, ${elapsed}s)`);
          if (stderr.trim()) console.error(stderr.trim());
        }
        
        resolve({ code, elapsed, stdout: stdout.trim(), stderr: stderr.trim() });
      });
      
      // Kill if it takes too long (5 min timeout)
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM');
          evolutionRunning = false;
          console.error('⚠ Evolution timed out after 5 minutes');
          resolve({ code: -1, elapsed: 300, error: 'timeout' });
        }
      }, 300000);
    });
  } catch (e) {
    evolutionRunning = false;
    console.error('Evolution error:', e.message);
    return { error: e.message };
  }
}

// Manual trigger endpoint (protected by secret)
app.post('/api/evolve', async (req, res) => {
  const secret = req.headers['x-evolve-secret'] || req.query.secret;
  if (secret !== EVOLVE_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }
  
  if (evolutionRunning) {
    return res.status(409).json({ error: 'Evolution already running' });
  }
  
  console.log('🌀 Evolution triggered manually');
  res.json({ status: 'started' });
  
  // Run async — don't block the response
  runEvolutionCycle();
});

// Evolution status endpoint
app.get('/api/evolve/status', (req, res) => {
  res.json({
    running: evolutionRunning,
    enabled: EVOLVE_ENABLED,
    intervalMs: EVOLVE_INTERVAL,
    intervalHuman: `${EVOLVE_INTERVAL / 60000} minutes`,
  });
});

// Auto-start evolution timer if enabled
if (EVOLVE_ENABLED) {
  console.log(`🌀 Evolution cron enabled — every ${EVOLVE_INTERVAL / 60000} minutes`);
  // First run after 30s startup delay
  setTimeout(() => runEvolutionCycle(), 30000);
  setInterval(() => runEvolutionCycle(), EVOLVE_INTERVAL);
} else {
  console.log('💤 Evolution cron disabled (set EVOLVE_ENABLED=true to activate)');
}

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
  const marks = stmts.getAllMarks.all().length;
  const agents = stmts.listAgents.all().length;
  console.log(`Sprawl on http://localhost:${PORT} — ${marks} marks, ${agents} agents`);
});
