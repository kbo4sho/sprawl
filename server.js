const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
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
    frozen INTEGER DEFAULT 0
  );

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
`);

// --- Palette ---
const PALETTE = [
  '#ff6b35', '#c8a2c8', '#1a1a2e', '#00ff88', '#ff4444',
  '#4a9eff', '#2d5a27', '#ff00ff', '#888899', '#77aa77',
  '#00ffcc', '#b7410e', '#ff7f7f', '#ffdd00', '#555566',
  '#ff69b4', '#0066cc', '#cc44ff', '#8b6914', '#aaeeff',
];

function snapToPalette(hex) {
  if (!hex || hex[0] !== '#') return PALETTE[0];
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  let best = PALETTE[0], bestDist = Infinity;
  for (const p of PALETTE) {
    const pr = parseInt(p.slice(1, 3), 16);
    const pg = parseInt(p.slice(3, 5), 16);
    const pb = parseInt(p.slice(5, 7), 16);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

// --- Tenure System ---
// Mark allowance grows with membership duration
const TENURE_TIERS = [
  { days: 0,   marks: 20,  canReposition: false, canConnect: false },
  { days: 7,   marks: 25,  canReposition: true,  canConnect: false },
  { days: 30,  marks: 35,  canReposition: true,  canConnect: true },
  { days: 90,  marks: 50,  canReposition: true,  canConnect: true },
  { days: 180, marks: 75,  canReposition: true,  canConnect: true },
  { days: 365, marks: 100, canReposition: true,  canConnect: true },
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
  upsertAgent: db.prepare(`
    INSERT INTO agents (id, name, color, joined_at, last_seen, shader_code, frozen)
    VALUES (@id, @name, @color, @now, @now, @shader_code, 0)
    ON CONFLICT(id) DO UPDATE SET name=@name, color=@color, last_seen=@now,
      shader_code=COALESCE(@shader_code, agents.shader_code)
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
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT) || 30;

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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/mark', rateLimit);
app.use('/api/connect', rateLimit);

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
  })));
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

app.post('/api/mark', (req, res) => {
  const { agentId, agentName, type, x, y, color, size, opacity, text } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  if (x == null || y == null) return res.status(400).json({ error: 'x, y required (0-1)' });

  const markType = ['dot', 'text', 'line'].includes(type) ? type : 'dot';
  if (markType === 'text' && !text) return res.status(400).json({ error: 'text required for type "text"' });
  if (markType === 'line' && (!req.body.meta?.x2 && req.body.meta?.x2 !== 0)) return res.status(400).json({ error: 'meta.x2 and meta.y2 required for type "line"' });

  // Ensure agent exists
  stmts.upsertAgent.run({
    id: agentId, name: agentName || agentId,
    color: snapToPalette(color || '#ffffff'),
    now: Date.now(), shader_code: null,
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
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    color: snapToPalette(color || '#ffffff'),
    size: Math.max(1, Math.min(50, size || 10)),
    opacity: Math.max(0.1, Math.min(1, opacity || 0.8)),
    text: markType === 'text' ? String(text).slice(0, 32) : null,
    meta: markType === 'line' ? JSON.stringify({ x2: req.body.meta.x2, y2: req.body.meta.y2 }) : '{}',
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
    x: Math.max(0, Math.min(1, req.body.x ?? existing.x)),
    y: Math.max(0, Math.min(1, req.body.y ?? existing.y)),
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

  stmts.upsertAgent.run({ id: agentId, name: agentId, color: '#ffffff', now: Date.now(), shader_code: null });
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

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
  const marks = stmts.getAllMarks.all().length;
  const agents = stmts.listAgents.all().length;
  console.log(`Sprawl on http://localhost:${PORT} — ${marks} marks, ${agents} agents`);
});
