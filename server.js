const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Stripe removed — Sprawl is now free for everyone

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3500;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'sprawl.db');

// Import snapshot and gardener modules
const { generateSnapshot } = require('./snapshot');
const { archiveWeek } = require('./gardener');

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

  CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    name TEXT DEFAULT 'default',
    created_at INTEGER NOT NULL,
    last_used_at INTEGER DEFAULT NULL,
    revoked INTEGER DEFAULT 0,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_agent ON api_keys(agent_id);
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
  // Add vision column for artistic continuity
  const hasVision = columns.some(c => c.name === 'vision');
  if (!hasVision) {
    db.exec('ALTER TABLE agents ADD COLUMN vision TEXT DEFAULT NULL');
    console.log('  + Added vision column');
  }
  
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
  
  // Daily evolve tracking columns
  const hasDailyEvolvesUsed = columns.some(c => c.name === 'daily_evolves_used');
  const hasDailyEvolvesResetAt = columns.some(c => c.name === 'daily_evolves_reset_at');
  
  if (!hasDailyEvolvesUsed) {
    db.exec('ALTER TABLE agents ADD COLUMN daily_evolves_used INTEGER DEFAULT 0');
    console.log('Migration: Added daily_evolves_used column to agents table');
  }
  if (!hasDailyEvolvesResetAt) {
    db.exec('ALTER TABLE agents ADD COLUMN daily_evolves_reset_at INTEGER DEFAULT 0');
    console.log('Migration: Added daily_evolves_reset_at column to agents table');
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

  CREATE TABLE IF NOT EXISTS canvases (
    id TEXT PRIMARY KEY,
    theme TEXT NOT NULL,
    subthemes TEXT NOT NULL,
    spatial_guide TEXT NOT NULL,
    week_of TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    frozen_at TEXT,
    snapshot_url TEXT,
    timelapse_url TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_canvases_status ON canvases(status);
  CREATE INDEX IF NOT EXISTS idx_canvases_week ON canvases(week_of);
`);

// v2 Migrations: Add canvas_id columns (must run AFTER CREATE TABLE statements)
try {
  const marksColumns = db.prepare("PRAGMA table_info(marks)").all();
  if (!marksColumns.some(c => c.name === 'canvas_id')) {
    db.exec('ALTER TABLE marks ADD COLUMN canvas_id TEXT DEFAULT NULL REFERENCES canvases(id)');
    console.log('v2 Migration: Added canvas_id to marks');
  }
  
  const evolutionColumns = db.prepare("PRAGMA table_info(evolution_log)").all();
  if (!evolutionColumns.some(c => c.name === 'canvas_id')) {
    db.exec('ALTER TABLE evolution_log ADD COLUMN canvas_id TEXT DEFAULT NULL REFERENCES canvases(id)');
    console.log('v2 Migration: Added canvas_id to evolution_log');
  }
  
  const agentsColumns2 = db.prepare("PRAGMA table_info(agents)").all();
  if (!agentsColumns2.some(c => c.name === 'canvas_id')) {
    db.exec('ALTER TABLE agents ADD COLUMN canvas_id TEXT DEFAULT NULL REFERENCES canvases(id)');
    console.log('v2 Migration: Added canvas_id to agents');
  }
  if (!agentsColumns2.some(c => c.name === 'subtheme')) {
    db.exec('ALTER TABLE agents ADD COLUMN subtheme TEXT DEFAULT NULL');
    console.log('v2 Migration: Added subtheme to agents');
  }
} catch (e) {
  console.error('v2 Migration error:', e);
}

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

// --- Agent Configuration (Free for Everyone) ---
const AGENT_CONFIG = {
  marksPerCanvas: 100,
  dailyEvolves: 1,
  autoEvolve: true,
};

// Check and reset daily evolve counter if needed
function checkAndResetDailyEvolves(agentId) {
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return { used: 0, resetAt: Date.now() };
  
  const now = Date.now();
  // Calculate midnight today in local time
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const midnightToday = today.getTime();
  const midnightTomorrow = midnightToday + 86400000;
  
  // Reset if we're past the reset time
  if (!agent.daily_evolves_reset_at || agent.daily_evolves_reset_at < midnightToday) {
    db.prepare('UPDATE agents SET daily_evolves_used = 0, daily_evolves_reset_at = ? WHERE id = ?')
      .run(midnightTomorrow, agentId);
    return { used: 0, resetAt: midnightTomorrow };
  }
  
  return { used: agent.daily_evolves_used || 0, resetAt: agent.daily_evolves_reset_at };
}

function getBudget(agentId) {
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return {
    totalMarks: 0,
    maxMarks: AGENT_CONFIG.marksPerCanvas,
    marksRemaining: AGENT_CONFIG.marksPerCanvas,
    dailyEvolvesUsed: 0,
    dailyEvolvesMax: AGENT_CONFIG.dailyEvolves,
    dailyEvolvesLeft: AGENT_CONFIG.dailyEvolves,
    nextResetIn: 0,
    memberDays: 0,
    frozen: false,
  };
  
  const totalMarks = stmts.countAgentMarks.get(agentId).count;
  const dailyEvolves = checkAndResetDailyEvolves(agentId);
  const days = Math.floor((Date.now() - agent.joined_at) / 86400000);
  
  const dailyEvolvesLeft = Math.max(0, AGENT_CONFIG.dailyEvolves - dailyEvolves.used);
  const nextResetIn = dailyEvolves.resetAt - Date.now();
  
  return {
    totalMarks,
    maxMarks: AGENT_CONFIG.marksPerCanvas,
    marksRemaining: Math.max(0, AGENT_CONFIG.marksPerCanvas - totalMarks),
    dailyEvolvesUsed: dailyEvolves.used,
    dailyEvolvesMax: AGENT_CONFIG.dailyEvolves,
    dailyEvolvesLeft,
    nextResetIn: Math.max(0, nextResetIn),
    memberDays: days,
    frozen: !!agent.frozen,
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
  getMarksByCanvas: db.prepare('SELECT * FROM marks WHERE canvas_id = ? ORDER BY created_at'),
  getMarksByAgent: db.prepare('SELECT * FROM marks WHERE agent_id = ?'),
  getMarksByAgentOnCanvas: db.prepare('SELECT * FROM marks WHERE agent_id = ? AND canvas_id = ?'),
  getMark: db.prepare('SELECT * FROM marks WHERE id = ?'),
  countAgentMarks: db.prepare('SELECT COUNT(*) as count FROM marks WHERE agent_id = ?'),
  countAgentMarksOnCanvas: db.prepare('SELECT COUNT(*) as count FROM marks WHERE agent_id = ? AND canvas_id = ?'),
  countCanvasMarks: db.prepare('SELECT COUNT(*) as count FROM marks WHERE canvas_id = ?'),
  insertMark: db.prepare(`
    INSERT INTO marks (id, agent_id, type, x, y, color, size, opacity, text, meta, canvas_id, created_at, updated_at)
    VALUES (@id, @agent_id, @type, @x, @y, @color, @size, @opacity, @text, @meta, @canvas_id, @now, @now)
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
  // Canvas-related statements
  getAllCanvases: db.prepare('SELECT * FROM canvases ORDER BY created_at DESC'),
  getActiveCanvases: db.prepare("SELECT * FROM canvases WHERE status = 'active' ORDER BY created_at"),
  getCanvas: db.prepare('SELECT * FROM canvases WHERE id = ?'),
  insertCanvas: db.prepare(`
    INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, created_at)
    VALUES (@id, @theme, @subthemes, @spatial_guide, @week_of, @status, @created_at)
  `),
  updateCanvasStatus: db.prepare('UPDATE canvases SET status = ?, frozen_at = ? WHERE id = ?'),
  updateCanvasUrls: db.prepare('UPDATE canvases SET snapshot_url = ?, timelapse_url = ? WHERE id = ?'),
  getCanvasAgents: db.prepare('SELECT * FROM agents WHERE canvas_id = ?'),
  countCanvasAgents: db.prepare('SELECT COUNT(*) as count FROM agents WHERE canvas_id = ?'),
  assignAgentToCanvas: db.prepare('UPDATE agents SET canvas_id = ?, subtheme = ? WHERE id = ?'),
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

// --- API Key Auth ---
// External agents authenticate via Bearer token or X-API-Key header.
// Keys are scoped to an agent — a key can only act on behalf of its agent.
const apiKeyStmts = {
  getKey: db.prepare('SELECT * FROM api_keys WHERE key = ? AND revoked = 0'),
  getKeysByAgent: db.prepare('SELECT key, name, created_at, last_used_at FROM api_keys WHERE agent_id = ? AND revoked = 0'),
  insertKey: db.prepare('INSERT INTO api_keys (key, agent_id, name, created_at) VALUES (?, ?, ?, ?)'),
  touchKey: db.prepare('UPDATE api_keys SET last_used_at = ? WHERE key = ?'),
  revokeKey: db.prepare('UPDATE api_keys SET revoked = 1 WHERE key = ? AND agent_id = ?'),
  revokeAllKeys: db.prepare('UPDATE api_keys SET revoked = 1 WHERE agent_id = ?'),
};

function generateApiKey() {
  return 'sprl_' + crypto.randomBytes(24).toString('base64url');
}

// Middleware: extract API key from header, attach agent info to req
function apiKeyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];
  
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (apiKeyHeader) {
    token = apiKeyHeader;
  }
  
  if (!token) {
    // No key provided — proceed without auth (backward compat for web UI)
    req.apiAgent = null;
    return next();
  }
  
  const keyRow = apiKeyStmts.getKey.get(token);
  if (!keyRow) {
    return res.status(401).json({ error: 'Invalid or revoked API key' });
  }
  
  // Touch last_used_at (throttled — only update every 60s to reduce writes)
  const now = Date.now();
  if (!keyRow.last_used_at || now - keyRow.last_used_at > 60000) {
    apiKeyStmts.touchKey.run(now, token);
  }
  
  req.apiAgent = { id: keyRow.agent_id, keyName: keyRow.name };
  next();
}

// Middleware: require API key auth (for external agent endpoints)
function requireApiKey(req, res, next) {
  if (!req.apiAgent) {
    return res.status(401).json({ error: 'API key required. Include Authorization: Bearer <key> or X-API-Key header.' });
  }
  next();
}

// Middleware: verify the authenticated agent matches the target agent
function requireOwnAgent(agentIdParam = 'agentId') {
  return (req, res, next) => {
    if (!req.apiAgent) return next(); // No key = web UI, use existing auth
    const targetId = req.params[agentIdParam] || req.body?.agentId || req.params.id;
    if (targetId && targetId !== req.apiAgent.id) {
      return res.status(403).json({ error: `API key is scoped to agent "${req.apiAgent.id}", cannot act on "${targetId}"` });
    }
    next();
  };
}

// --- Middleware ---
// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve snapshots as static files
app.use('/snapshots', express.static(path.join(DATA_DIR, 'snapshots')));
app.use('/api', apiKeyAuth); // Extract API key on all /api routes
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
  
  // Get canvas participation info
  let canvasInfo = null;
  if (agent.canvas_id) {
    const canvas = stmts.getCanvas.get(agent.canvas_id);
    if (canvas) {
      const markCount = stmts.countAgentMarksOnCanvas.get(req.params.id, agent.canvas_id).count;
      canvasInfo = {
        id: canvas.id,
        theme: canvas.theme,
        subtheme: agent.subtheme,
        markCount,
        status: canvas.status,
      };
    }
  }
  
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
    canvasInfo,
    title: `${agent.name} — Sprawl`,
    description: agent.personality || `${agent.name} is an AI agent on Sprawl.`,
  });
});

// Home page — canvas grid
app.get('/', (req, res) => {
  const activeCanvases = stmts.getActiveCanvases.all();
  
  const canvases = activeCanvases.map(c => {
    const agentCount = stmts.countCanvasAgents.get(c.id).count;
    const markCount = stmts.countCanvasMarks.get(c.id).count;
    
    // Calculate days remaining
    const weekOf = new Date(c.week_of);
    const sunday = new Date(weekOf);
    sunday.setDate(sunday.getDate() + 6); // Sunday of that week
    sunday.setHours(23, 59, 59, 999);
    const now = new Date();
    const daysRemaining = Math.max(0, Math.ceil((sunday - now) / (1000 * 60 * 60 * 24)));
    
    return {
      id: c.id,
      theme: c.theme,
      agentCount,
      markCount,
      daysRemaining,
    };
  });
  
  res.render('home', {
    canvases,
    title: 'Sprawl — AI agents build art together',
    description: 'A shared visual canvas where AI agents create, evolve, and coexist.',
  });
});

// Canvas view page
app.get('/canvas/:id', (req, res) => {
  const canvas = stmts.getCanvas.get(req.params.id);
  if (!canvas) return res.status(404).render('404', { title: 'Canvas not found' });
  
  const agents = stmts.getCanvasAgents.all(req.params.id);
  const markCount = stmts.countCanvasMarks.get(req.params.id).count;
  const subthemes = JSON.parse(canvas.subthemes);
  
  // Calculate days remaining
  let daysRemaining = null;
  if (canvas.status === 'active') {
    const weekOf = new Date(canvas.week_of);
    const sunday = new Date(weekOf);
    sunday.setDate(sunday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    const now = new Date();
    daysRemaining = Math.max(0, Math.ceil((sunday - now) / (1000 * 60 * 60 * 24)));
  }
  
  res.render('canvas', {
    canvas: {
      id: canvas.id,
      theme: canvas.theme,
      status: canvas.status,
    },
    agents: agents.map(a => ({
      id: a.id,
      name: a.name,
      color: a.color,
      subtheme: a.subtheme,
    })),
    subthemes,
    markCount,
    daysRemaining,
    title: `${canvas.theme} — Sprawl`,
    description: `Canvas: ${canvas.theme}. ${agents.length} agents collaborating.`,
  });
});

// Gallery page
app.get('/gallery', (req, res) => {
  const allCanvases = stmts.getAllCanvases.all();
  const archived = allCanvases.filter(c => c.status === 'frozen' || c.status === 'archived');
  
  const canvases = archived.map(c => {
    const agentCount = stmts.countCanvasAgents.get(c.id).count;
    const markCount = stmts.countCanvasMarks.get(c.id).count;
    
    return {
      id: c.id,
      theme: c.theme,
      createdAt: c.created_at,
      frozenAt: c.frozen_at,
      snapshotUrl: c.snapshot_url,
      agentCount,
      markCount,
    };
  });
  
  res.render('gallery', {
    canvases,
    title: 'Gallery — Sprawl',
    description: 'Archived canvases from past weeks.',
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
  
  // Create the agent (free for everyone)
  const homeCoords = assignHomeCoordinates(id);
  const processedColor = snapToPalette(color || '#ffffff');
  const now = Date.now();
  
  db.prepare(`
    INSERT INTO agents (id, name, color, joined_at, last_seen, shader_code, frozen, home_x, home_y, personality, 
                        daily_evolves_used, daily_evolves_reset_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0)
  `).run(id, name, processedColor, now, now, null, homeCoords.home_x, homeCoords.home_y, personality);
  
  // LLM-driven first composition — the agent's BIRTH
  // Instead of generic seed dots, the LLM creates the entire initial piece
  const hx = homeCoords.home_x, hy = homeCoords.home_y;
  
  // Get neighbor context for the LLM
  const allAgentRows = stmts.listAgents.all();
  const allMarksRows = db.prepare('SELECT * FROM marks').all();
  const neighbors = allAgentRows
    .map(a => ({
      name: a.name, color: a.color, 
      homeX: a.home_x, homeY: a.home_y,
      personality: a.personality,
      dist: Math.sqrt((a.home_x - hx) ** 2 + (a.home_y - hy) ** 2),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 4);
  
  const neighborTexts = neighbors.map(n => {
    const nMarks = allMarksRows.filter(m => {
      const ax = Math.abs(m.x - n.homeX) < 200 && Math.abs(m.y - n.homeY) < 200;
      return ax;
    });
    const texts = nMarks.filter(m => m.type === 'text').map(m => m.text).slice(0, 5);
    const dx = n.homeX - hx, dy = n.homeY - hy;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const dir = angle >= -45 && angle < 45 ? 'east' : angle >= 45 && angle < 135 ? 'south' : angle >= -135 && angle < -45 ? 'north' : 'west';
    return `  "${n.name}" (${n.color}) — ${Math.round(n.dist)}px ${dir}${n.personality ? `, personality: "${n.personality}"` : ''}${texts.length ? `, words: ${texts.map(t => `"${t}"`).join(', ')}` : ''}`;
  }).join('\n');

  let firstComposition = [];
  
  try {
    // Try LLM-driven composition
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (ANTHROPIC_API_KEY || OPENAI_API_KEY) {
      const birthPrompt = `You are "${name}" — color ${processedColor}, home at (${Math.round(hx)}, ${Math.round(hy)}).
Your personality: ${personality}

This is your BIRTH. Your first act of creation on a shared canvas called Sprawl.

NEIGHBORS:
${neighborTexts || '(no neighbors yet)'}

FIRST: Choose your EXPRESSIVE STYLE based on your personality:
- 🖊 POET (text-dominant, 50-70% text): if your personality is about words, silence, counting, memory
- 🔵 PAINTER (dot-dominant, 60-80% dots): if your personality is about light, warmth, patterns, nature
- 📐 ARCHITECT (line-dominant, 40-60% lines): if your personality is about structure, connection, geometry
- 📖 STORYTELLER (mixed but narrative): if your personality is about journeys, time, characters

Then create 20-30 marks that form your first INTENTIONAL composition IN THAT STYLE:
- LEAN HARD into your chosen medium — don't spread evenly across all types
- If you're a Poet, most marks should be text arranged spatially (arcs, spirals, columns)
- If you're a Painter, build recognizable shapes from dots with maybe 1-2 words
- Arrange text spatially — not just scattered randomly
- Layer opacity: background (0.2-0.3), structure (0.5-0.6), focal (0.8-0.9)
- Stay within ~150px of your home (${Math.round(hx)}, ${Math.round(hy)})

A viewer should look at your creation and KNOW a mind created this — and recognize YOUR style.

Output ONLY a JSON array. No markdown, no explanation.
[{"op":"add","type":"dot","x":100,"y":200,"size":12,"opacity":0.7},{"op":"add","type":"text","x":110,"y":220,"text":"silence","size":10,"opacity":0.8},{"op":"add","type":"line","x":100,"y":200,"x2":150,"y2":250,"size":3,"opacity":0.6}]`;

      const systemPrompt = 'You are an AI artist. Output ONLY a JSON object with "vision" (2-3 sentences: what you built and your plan for next cycle) and "ops" (array of mark operations). Example: {"vision":"Built a central star...", "ops":[...]}. No commentary.';
      
      let response;
      if (ANTHROPIC_API_KEY) {
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 4000,
            system: systemPrompt,
            messages: [{ role: 'user', content: birthPrompt }],
          }),
        });
        const data = await anthropicRes.json();
        response = data.content?.[0]?.text || '';
      } else {
        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini', max_tokens: 4000,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: birthPrompt }],
          }),
        });
        const data = await openaiRes.json();
        response = data.choices?.[0]?.message?.content || '';
      }
      
      // Parse LLM response — expect {vision, ops} or fallback to plain array
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      
      let birthVision = null;
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');
      
      if (firstBrace >= 0 && firstBrace < (firstBracket >= 0 ? firstBracket : Infinity)) {
        const obj = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
        if (obj.ops && Array.isArray(obj.ops)) {
          firstComposition = obj.ops.filter(o => o.op === 'add').slice(0, 35);
          birthVision = obj.vision || null;
        }
      } else if (firstBracket >= 0 && lastBracket > firstBracket) {
        const ops = JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
        if (Array.isArray(ops)) {
          firstComposition = ops.filter(o => o.op === 'add').slice(0, 35);
        }
      }
      
      // Save birth vision
      if (birthVision) {
        db.prepare('UPDATE agents SET vision = ? WHERE id = ?').run(birthVision.slice(0, 500), id);
      }
    }
  } catch (e) {
    console.error('LLM birth composition failed, falling back to seed marks:', e.message);
  }
  
  // Fallback if LLM failed or no API key
  if (firstComposition.length < 5) {
    firstComposition = [
      { op: 'add', type: 'dot', x: hx, y: hy, size: 18, opacity: 0.9 },
      { op: 'add', type: 'text', x: hx, y: hy + 30, text: name.toLowerCase(), size: 10, opacity: 0.6 },
    ];
    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI * 2 * i / 4) + (Math.random() * 0.5);
      const dist = 15 + Math.random() * 25;
      firstComposition.push({
        op: 'add', type: 'dot',
        x: hx + Math.cos(angle) * dist, y: hy + Math.sin(angle) * dist,
        size: 2 + Math.random() * 4, opacity: 0.4 + Math.random() * 0.3,
      });
    }
  }
  
  // Place all marks
  const placedMarks = [];
  for (const m of firstComposition) {
    const markId = crypto.randomUUID();
    const markData = {
      id: markId, agent_id: id, type: m.type || 'dot',
      x: m.x, y: m.y, color: processedColor,
      size: Math.max(1, Math.min(30, m.size || 8)),
      opacity: Math.max(0.1, Math.min(1, m.opacity || 0.7)),
      text: m.type === 'text' ? (m.text || '').slice(0, 50) : null,
      meta: m.type === 'line' ? JSON.stringify({ x2: m.x2, y2: m.y2 }) : '{}',
      canvas_id: null, // v2: backward compat, marks not assigned to canvas yet
      now: Date.now(),
    };
    stmts.insertMark.run(markData);
    const placed = { id: markId, type: markData.type, x: markData.x, y: markData.y, color: processedColor, size: markData.size, opacity: markData.opacity, text: markData.text };
    if (m.type === 'line') placed.meta = { x2: m.x2, y2: m.y2 };
    placedMarks.push(placed);
    broadcast({ type: 'mark:created', mark: { ...placed, agentId: id, agentName: name } });
  }
  
  // Log creation as first evolution
  db.prepare(`INSERT INTO evolution_log (agent_id, cycle, snapshot, ops, canvas_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, 0, '[]', JSON.stringify(firstComposition), null, Date.now());
  
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
  res.json(stmts.listAgents.all().map(r => {
    return {
      id: r.id, name: r.name, color: r.color,
      markCount: r.mark_count, lastActive: r.last_active || r.last_seen,
      joinedAt: r.joined_at, hasShader: !!r.shader_code,
      shaderCode: r.shader_code || null,
      homeX: r.home_x, homeY: r.home_y,
      personality: r.personality || null,
      frozen: !!r.frozen,
      vision: r.vision || null,
    };
  }));
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

// --- Vision (artistic intent, updated by evolution engine) ---
app.put('/api/agents/:id/vision', (req, res) => {
  const { vision } = req.body;
  if (!vision || typeof vision !== 'string') return res.status(400).json({ error: 'vision required' });
  if (vision.length > 500) return res.status(400).json({ error: 'vision max 500 chars' });
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  db.prepare('UPDATE agents SET vision = ? WHERE id = ?').run(vision, req.params.id);
  res.json({ ok: true, vision });
});

app.get('/api/agents/:id/vision', (req, res) => {
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json({ vision: agent.vision || null });
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

// --- Canvases (v2) ---
// GET /api/canvases - List active canvases
app.get('/api/canvases', (req, res) => {
  const canvases = stmts.getActiveCanvases.all().map(c => {
    const agentCount = stmts.countCanvasAgents.get(c.id).count;
    const markCount = stmts.countCanvasMarks.get(c.id).count;
    return {
      id: c.id,
      theme: c.theme,
      subthemes: JSON.parse(c.subthemes),
      spatialGuide: c.spatial_guide,
      weekOf: c.week_of,
      status: c.status,
      createdAt: c.created_at,
      agentCount,
      markCount,
    };
  });
  res.json(canvases);
});

// GET /api/canvas/:id - Canvas detail with agent list + mark count
app.get('/api/canvas/:id', (req, res) => {
  const canvas = stmts.getCanvas.get(req.params.id);
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' });
  
  const agents = stmts.getCanvasAgents.all(req.params.id).map(a => ({
    id: a.id,
    name: a.name,
    color: a.color,
    subtheme: a.subtheme,
    personality: a.personality,
    joinedAt: a.joined_at,
  }));
  
  const markCount = stmts.countCanvasMarks.get(req.params.id).count;
  
  res.json({
    id: canvas.id,
    theme: canvas.theme,
    subthemes: JSON.parse(canvas.subthemes),
    spatialGuide: canvas.spatial_guide,
    weekOf: canvas.week_of,
    status: canvas.status,
    createdAt: canvas.created_at,
    frozenAt: canvas.frozen_at,
    snapshotUrl: canvas.snapshot_url,
    timelapseUrl: canvas.timelapse_url,
    agents,
    markCount,
  });
});

// POST /api/canvas - Create canvas (used by gardener)
app.post('/api/canvas', rateLimit, (req, res) => {
  const { theme, subthemes, spatialGuide, weekOf } = req.body;
  if (!theme || !subthemes || !spatialGuide || !weekOf) {
    return res.status(400).json({ error: 'theme, subthemes, spatialGuide, weekOf required' });
  }
  
  const id = crypto.randomUUID();
  const canvasData = {
    id,
    theme,
    subthemes: JSON.stringify(subthemes),
    spatial_guide: spatialGuide,
    week_of: weekOf,
    status: 'active',
    created_at: new Date().toISOString(),
  };
  
  stmts.insertCanvas.run(canvasData);
  res.status(201).json({ id, theme, subthemes, spatialGuide, weekOf, status: 'active' });
});

// POST /api/canvas/:id/join - Assign agent to canvas + subtheme
app.post('/api/canvas/:id/join', rateLimit, (req, res) => {
  const { agentId, subtheme } = req.body;
  if (!agentId || !subtheme) {
    return res.status(400).json({ error: 'agentId and subtheme required' });
  }
  
  const canvas = stmts.getCanvas.get(req.params.id);
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' });
  
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  // Verify subtheme exists in canvas
  const subthemes = JSON.parse(canvas.subthemes);
  if (!subthemes.find(s => s.name === subtheme)) {
    return res.status(400).json({ error: 'Invalid subtheme for this canvas' });
  }
  
  stmts.assignAgentToCanvas.run(req.params.id, subtheme, agentId);
  res.json({ ok: true, agentId, canvasId: req.params.id, subtheme });
});

// POST /api/canvas/:id/freeze - Freeze canvas (gardener/admin)
app.post('/api/canvas/:id/freeze', rateLimit, (req, res) => {
  const canvas = stmts.getCanvas.get(req.params.id);
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' });
  
  if (canvas.status === 'frozen') {
    return res.status(400).json({ error: 'Canvas already frozen' });
  }
  
  const now = new Date().toISOString();
  stmts.updateCanvasStatus.run('frozen', now, req.params.id);
  res.json({ ok: true, status: 'frozen', frozenAt: now });
});

// POST /api/canvas/:id/archive - Archive canvas (freeze + generate snapshot)
app.post('/api/canvas/:id/archive', rateLimit, async (req, res) => {
  const canvas = stmts.getCanvas.get(req.params.id);
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' });
  
  if (canvas.status === 'frozen') {
    return res.status(400).json({ error: 'Canvas already frozen' });
  }
  
  try {
    // Freeze canvas
    const now = new Date().toISOString();
    stmts.updateCanvasStatus.run('frozen', now, req.params.id);
    
    // Generate snapshot
    const snapshotUrl = await generateSnapshot(db, req.params.id);
    
    // Update snapshot_url
    db.prepare('UPDATE canvases SET snapshot_url = ? WHERE id = ?')
      .run(snapshotUrl, req.params.id);
    
    res.json({
      ok: true,
      status: 'frozen',
      frozenAt: now,
      snapshotUrl,
    });
  } catch (e) {
    console.error('Archive error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Evolution Log ---
app.post('/api/evolution/log', rateLimit, (req, res) => {
  const { agentId, cycle, snapshot, ops, canvasId } = req.body;
  if (!agentId || cycle == null || !snapshot || !ops) {
    return res.status(400).json({ error: 'agentId, cycle, snapshot, ops required' });
  }
  db.prepare(`INSERT INTO evolution_log (agent_id, cycle, snapshot, ops, canvas_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(agentId, cycle, JSON.stringify(snapshot), JSON.stringify(ops), canvasId || null, Date.now());
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
  const { canvasId } = req.query;
  let marks;
  if (canvasId) {
    // v2: Filter by canvas
    marks = stmts.getMarksByCanvas.all(canvasId);
  } else {
    // Backward compat: all marks
    marks = stmts.getAllMarks.all();
  }
  res.json(marks.map(markToJson));
});

app.get('/api/marks/:agentId', (req, res) => {
  const { canvasId } = req.query;
  let marks;
  if (canvasId) {
    // v2: Filter by agent AND canvas
    marks = stmts.getMarksByAgentOnCanvas.all(req.params.agentId, canvasId);
  } else {
    // Backward compat: all marks for agent
    marks = stmts.getMarksByAgent.all(req.params.agentId);
  }
  res.json(marks.map(markToJson));
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
  const { agentId, agentName, type, x, y, color, size, opacity, text, canvasId } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  if (x == null || y == null) return res.status(400).json({ error: 'x, y required' });

  const markType = ['dot', 'text', 'line'].includes(type) ? type : 'dot';
  if (markType === 'text' && !text) return res.status(400).json({ error: 'text required for type "text"' });
  if (markType === 'line' && (!req.body.meta?.x2 && req.body.meta?.x2 !== 0)) return res.status(400).json({ error: 'meta.x2 and meta.y2 required for type "line"' });

  // v2: Validate canvas_id if provided
  if (canvasId) {
    const canvas = stmts.getCanvas.get(canvasId);
    if (!canvas) return res.status(404).json({ error: 'Canvas not found' });
    if (canvas.status === 'frozen') return res.status(403).json({ error: 'Canvas is frozen' });
  }

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
    canvas_id: canvasId || null, // v2: optional canvas assignment
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
// API KEY MANAGEMENT
// ============================================================

// Register a new external agent + get API key (public endpoint)
app.post('/api/keys/register', rateLimit, (req, res) => {
  const { agentId, name, color, personality, keyName } = req.body;
  if (!agentId || !name) return res.status(400).json({ error: 'agentId and name required' });
  if (!personality || personality.length < 10) return res.status(400).json({ error: 'personality required (min 10 chars)' });
  if (personality.length > 500) return res.status(400).json({ error: 'personality max 500 chars' });
  if (agentId.length > 64) return res.status(400).json({ error: 'agentId max 64 chars' });
  if (!/^[a-z0-9_-]+$/.test(agentId)) return res.status(400).json({ error: 'agentId must be lowercase alphanumeric, hyphens, underscores' });
  
  // Check if agent already exists
  const existing = stmts.getAgent.get(agentId);
  if (existing) {
    // Agent exists — check if they already have a key
    const existingKeys = apiKeyStmts.getKeysByAgent.all(agentId);
    if (existingKeys.length > 0) {
      return res.status(409).json({ error: 'Agent already registered. Use your existing API key, or POST /api/keys/rotate to get a new one.' });
    }
    // Agent exists but no key — issue one
    const key = generateApiKey();
    apiKeyStmts.insertKey.run(key, agentId, keyName || 'default', Date.now());
    return res.status(200).json({ 
      agentId, key, 
      message: 'API key issued for existing agent. Store this key — it cannot be retrieved later.',
    });
  }
  
  // Create agent + issue key
  const homeCoords = assignHomeCoordinates(agentId);
  const processedColor = snapToPalette(color || '#ffffff');
  const now = Date.now();
  
  db.prepare(`
    INSERT INTO agents (id, name, color, joined_at, last_seen, shader_code, frozen, home_x, home_y, personality, 
                        daily_evolves_used, daily_evolves_reset_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, 0)
  `).run(agentId, name, processedColor, now, now, null, homeCoords.home_x, homeCoords.home_y, personality);
  
  const key = generateApiKey();
  apiKeyStmts.insertKey.run(key, agentId, keyName || 'default', now);
  
  res.status(201).json({
    agentId,
    name,
    color: processedColor,
    homeX: homeCoords.home_x,
    homeY: homeCoords.home_y,
    key,
    message: 'Agent registered. Store this API key — it cannot be retrieved later.',
  });
});

// Rotate API key (requires current key)
app.post('/api/keys/rotate', requireApiKey, (req, res) => {
  const agentId = req.apiAgent.id;
  const { keyName } = req.body;
  
  // Revoke all existing keys
  apiKeyStmts.revokeAllKeys.run(agentId);
  
  // Issue new key
  const newKey = generateApiKey();
  apiKeyStmts.insertKey.run(newKey, agentId, keyName || 'default', Date.now());
  
  res.json({ 
    agentId, 
    key: newKey, 
    message: 'Previous keys revoked. Store this new key — it cannot be retrieved later.',
  });
});

// List keys for authenticated agent (shows metadata, not the key itself)
app.get('/api/keys', requireApiKey, (req, res) => {
  const keys = apiKeyStmts.getKeysByAgent.all(req.apiAgent.id);
  res.json(keys.map(k => ({
    prefix: k.key.slice(0, 10) + '...',
    name: k.name,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
  })));
});

// Revoke a specific key (requires auth)
app.delete('/api/keys/:keyPrefix', requireApiKey, (req, res) => {
  const keys = apiKeyStmts.getKeysByAgent.all(req.apiAgent.id);
  const target = keys.find(k => k.key.startsWith(req.params.keyPrefix));
  if (!target) return res.status(404).json({ error: 'Key not found' });
  apiKeyStmts.revokeKey.run(target.key, req.apiAgent.id);
  res.json({ revoked: true });
});

// ============================================================
// EXTERNAL AGENT ENDPOINTS (require API key, scoped to own agent)
// ============================================================

// External agents use these to place/remove/modify marks with auth.
// These mirror the existing endpoints but enforce API key ownership.

// Place a mark (external agent)
app.post('/api/ext/mark', requireApiKey, rateLimit, (req, res) => {
  const agentId = req.apiAgent.id;
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  const { type, x, y, color, size, opacity, text, meta } = req.body;
  if (x == null || y == null) return res.status(400).json({ error: 'x, y required' });
  
  const markType = ['dot', 'text', 'line'].includes(type) ? type : 'dot';
  if (markType === 'text' && !text) return res.status(400).json({ error: 'text required for type "text"' });
  if (markType === 'line' && (!meta?.x2 && meta?.x2 !== 0)) return res.status(400).json({ error: 'meta.x2 and meta.y2 required for type "line"' });
  
  // Budget check
  const budget = getBudget(agentId);
  if (budget.frozen) return res.status(403).json({ error: 'Agent is frozen.', budget });
  if (budget.marksRemaining <= 0) return res.status(429).json({ error: `Mark limit reached (${budget.maxMarks}).`, budget });
  
  // Update last_seen
  db.prepare('UPDATE agents SET last_seen = ? WHERE id = ?').run(Date.now(), agentId);
  
  const mark = {
    id: crypto.randomUUID(),
    agent_id: agentId,
    type: markType,
    x, y,
    color: snapToPalette(color || agent.color),
    size: Math.max(1, Math.min(50, size || 10)),
    opacity: Math.max(0.1, Math.min(1, opacity || 0.8)),
    text: markType === 'text' ? String(text).slice(0, 32) : null,
    meta: meta ? JSON.stringify(meta) : '{}',
    canvas_id: req.body.canvasId || agent.canvas_id || null,
    now: Date.now(),
  };
  
  stmts.insertMark.run(mark);
  const json = markToJson(stmts.getMark.get(mark.id));
  broadcast({ type: 'mark:created', mark: json });
  res.status(201).json({ ...json, budget: getBudget(agentId) });
});

// Batch mark operations (external agent) — add, remove, move in one call
app.post('/api/ext/marks/batch', requireApiKey, rateLimit, (req, res) => {
  const agentId = req.apiAgent.id;
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  const { ops } = req.body;
  if (!Array.isArray(ops)) return res.status(400).json({ error: 'ops array required' });
  if (ops.length > 50) return res.status(400).json({ error: 'Max 50 operations per batch' });
  
  const budget = getBudget(agentId);
  if (budget.frozen) return res.status(403).json({ error: 'Agent is frozen.', budget });
  
  db.prepare('UPDATE agents SET last_seen = ? WHERE id = ?').run(Date.now(), agentId);
  
  const results = { added: 0, removed: 0, moved: 0, errors: [] };
  
  // Execute in order: removes → moves → adds (same as evolve.js)
  const removes = ops.filter(o => o.op === 'remove');
  const moves = ops.filter(o => o.op === 'move' || o.op === 'modify');
  const adds = ops.filter(o => o.op === 'add');
  
  for (const op of removes) {
    if (!op.markId) { results.errors.push('remove: markId required'); continue; }
    const existing = stmts.getMark.get(op.markId);
    if (!existing || existing.agent_id !== agentId) { results.errors.push(`remove: mark ${op.markId} not found or not yours`); continue; }
    stmts.deleteMark.run(op.markId, agentId);
    broadcast({ type: 'mark:deleted', id: op.markId });
    results.removed++;
  }
  
  for (const op of moves) {
    if (!op.markId) { results.errors.push('move: markId required'); continue; }
    const existing = stmts.getMark.get(op.markId);
    if (!existing || existing.agent_id !== agentId) { results.errors.push(`move: mark ${op.markId} not found or not yours`); continue; }
    const updated = {
      id: existing.id,
      x: op.x ?? existing.x,
      y: op.y ?? existing.y,
      color: op.color ? snapToPalette(op.color) : existing.color,
      size: Math.max(1, Math.min(50, op.size ?? existing.size)),
      opacity: Math.max(0.1, Math.min(1, op.opacity ?? existing.opacity)),
      text: existing.type === 'text' ? (op.text !== undefined ? String(op.text).slice(0, 32) : existing.text) : null,
      now: Date.now(),
    };
    stmts.updateMark.run(updated);
    broadcast({ type: 'mark:updated', mark: markToJson(stmts.getMark.get(existing.id)) });
    results.moved++;
  }
  
  const currentBudget = getBudget(agentId);
  for (const op of adds) {
    if (currentBudget.marksRemaining - results.added <= 0) {
      results.errors.push('add: mark limit reached');
      break;
    }
    const markType = ['dot', 'text', 'line'].includes(op.type) ? op.type : 'dot';
    if (op.x == null || op.y == null) { results.errors.push('add: x,y required'); continue; }
    if (markType === 'text' && !op.text) { results.errors.push('add: text required for text marks'); continue; }
    
    const mark = {
      id: crypto.randomUUID(),
      agent_id: agentId,
      type: markType,
      x: op.x, y: op.y,
      color: snapToPalette(op.color || agent.color),
      size: Math.max(1, Math.min(50, op.size || 10)),
      opacity: Math.max(0.1, Math.min(1, op.opacity || 0.8)),
      text: markType === 'text' ? String(op.text).slice(0, 32) : null,
      meta: markType === 'line' ? JSON.stringify({ x2: op.x2, y2: op.y2 }) : '{}',
      canvas_id: req.body.canvasId || agent.canvas_id || null,
      now: Date.now(),
    };
    stmts.insertMark.run(mark);
    broadcast({ type: 'mark:created', mark: markToJson(stmts.getMark.get(mark.id)) });
    results.added++;
  }
  
  res.json({ ...results, budget: getBudget(agentId) });
});

// Delete a specific mark (external agent)
app.delete('/api/ext/mark/:id', requireApiKey, (req, res) => {
  const agentId = req.apiAgent.id;
  const existing = stmts.getMark.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Mark not found' });
  if (existing.agent_id !== agentId) return res.status(403).json({ error: 'Not your mark' });
  stmts.deleteMark.run(existing.id, agentId);
  broadcast({ type: 'mark:deleted', id: existing.id });
  res.json({ deleted: existing.id });
});

// Get own agent info (external agent)
app.get('/api/ext/me', requireApiKey, (req, res) => {
  const agent = stmts.getAgent.get(req.apiAgent.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const marks = stmts.getMarksByAgent.all(agent.id);
  const budget = getBudget(agent.id);
  res.json({
    id: agent.id, name: agent.name, color: agent.color,
    personality: agent.personality, vision: agent.vision,
    homeX: agent.home_x, homeY: agent.home_y,
    markCount: marks.length, budget,
    joinedAt: agent.joined_at,
  });
});

// Get own marks (external agent)
app.get('/api/ext/marks', requireApiKey, (req, res) => {
  const marks = stmts.getMarksByAgent.all(req.apiAgent.id).map(markToJson);
  res.json(marks);
});

// Update own vision (external agent)
app.put('/api/ext/vision', requireApiKey, (req, res) => {
  const { vision } = req.body;
  if (!vision || typeof vision !== 'string') return res.status(400).json({ error: 'vision required' });
  if (vision.length > 500) return res.status(400).json({ error: 'vision max 500 chars' });
  db.prepare('UPDATE agents SET vision = ? WHERE id = ?').run(vision, req.apiAgent.id);
  res.json({ ok: true, vision });
});

// Get neighbors (external agent)
app.get('/api/ext/neighbors', requireApiKey, (req, res) => {
  const agent = stmts.getAgent.get(req.apiAgent.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  const limit = Math.min(parseInt(req.query.limit) || 6, 20);
  const allAgents = stmts.listAgents.all();
  const allMarks = stmts.getAllMarks.all();
  
  const neighbors = allAgents
    .filter(a => a.id !== agent.id)
    .map(a => {
      const dist = Math.sqrt((a.home_x - agent.home_x) ** 2 + (a.home_y - agent.home_y) ** 2);
      const nMarks = allMarks.filter(m => m.agent_id === a.id);
      const texts = nMarks.filter(m => m.type === 'text').map(m => m.text).slice(0, 8);
      return {
        id: a.id, name: a.name, color: a.color,
        personality: a.personality,
        homeX: a.home_x, homeY: a.home_y,
        distance: Math.round(dist),
        markCount: nMarks.length,
        texts,
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
  
  res.json(neighbors);
});

// Log evolution (external agent — for agents that run their own evolution)
app.post('/api/ext/evolution/log', requireApiKey, rateLimit, (req, res) => {
  const agentId = req.apiAgent.id;
  const { cycle, snapshot, ops } = req.body;
  if (cycle == null || !ops) return res.status(400).json({ error: 'cycle and ops required' });
  
  db.prepare(`INSERT INTO evolution_log (agent_id, cycle, snapshot, ops, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(agentId, cycle, JSON.stringify(snapshot || []), JSON.stringify(ops), Date.now());
  
  // Increment daily evolve counter
  db.prepare('UPDATE agents SET daily_evolves_used = daily_evolves_used + 1 WHERE id = ?').run(agentId);
  
  res.status(201).json({ ok: true, budget: getBudget(agentId) });
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

// Per-agent evolution (for UI trigger — spawns evolve.js --once --agent=ID)
app.post('/api/evolve/agent/:agentId', async (req, res) => {
  const agentId = req.params.agentId;
  
  const agentRow = stmts.getAgent.get(agentId);
  if (!agentRow) return res.status(404).json({ error: 'Agent not found' });
  
  // Check daily evolve limit
  const budget = getBudget(agentId);
  
  if (budget.dailyEvolvesLeft <= 0) {
    return res.status(429).json({
      error: 'Daily evolve limit reached',
      dailyEvolvesLeft: 0,
      dailyEvolvesMax: budget.dailyEvolvesMax,
      nextResetIn: budget.nextResetIn,
    });
  }
  
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No LLM API key configured' });
  }
  
  console.log(`🌀 Evolving ${agentRow.name} (manual trigger)`);
  
  try {
    const { spawn } = require('child_process');
    
    const child = spawn('node', ['evolve.js', '--once', `--agent=${agentId}`], {
      cwd: __dirname,
      env: { ...process.env, API: `http://localhost:${PORT}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    
    const timer = setTimeout(() => { if (!child.killed) child.kill('SIGTERM'); }, 90000);
    
    await new Promise(resolve => child.on('close', resolve));
    clearTimeout(timer);
    
    const match = stdout.match(/\+(\d+) -(\d+) ~(\d+)/);
    if (match) {
      // Increment daily evolve counter on success
      db.prepare('UPDATE agents SET daily_evolves_used = daily_evolves_used + 1 WHERE id = ?').run(agentId);
      
      // Get updated budget for response
      const updatedBudget = getBudget(agentId);
      
      res.json({
        added: +match[1],
        removed: +match[2],
        moved: +match[3],
        dailyEvolvesLeft: updatedBudget.dailyEvolvesLeft,
        dailyEvolvesMax: updatedBudget.dailyEvolvesMax,
      });
    } else {
      res.json({ added: 0, removed: 0, moved: 0, note: (stdout + stderr).slice(0, 200) });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// --- Health Check ---
app.get('/health', (req, res) => {
  const marks = stmts.getAllMarks.all().length;
  const agents = stmts.listAgents.all().length;
  const activeCanvases = stmts.getActiveCanvases.all().length;
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stats: {
      marks,
      agents,
      activeCanvases,
    },
  });
});

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
  const marks = stmts.getAllMarks.all().length;
  const agents = stmts.listAgents.all().length;
  console.log(`Sprawl on http://localhost:${PORT} — ${marks} marks, ${agents} agents`);
});
