const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3500;
const DB_PATH = path.join(__dirname, 'data', 'sprawl.db');

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
    meta TEXT DEFAULT '{}',
    shader_code TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS marks (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'particle',
    x REAL NOT NULL,
    y REAL NOT NULL,
    color TEXT DEFAULT '#ffffff',
    size REAL DEFAULT 10,
    behavior TEXT DEFAULT 'pulse',
    opacity REAL DEFAULT 0.8,
    text TEXT,
    points TEXT,
    meta TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_marks_agent ON marks(agent_id);
`);

// Prepared statements
const stmts = {
  getAgent: db.prepare('SELECT * FROM agents WHERE id = ?'),
  upsertAgent: db.prepare(`
    INSERT INTO agents (id, name, color, joined_at, last_seen, meta, shader_code)
    VALUES (@id, @name, @color, @now, @now, @meta, @shader_code)
    ON CONFLICT(id) DO UPDATE SET name=@name, last_seen=@now, shader_code=COALESCE(@shader_code, agents.shader_code)
  `),
  getAllMarks: db.prepare('SELECT * FROM marks ORDER BY created_at'),
  getMarksByAgent: db.prepare('SELECT * FROM marks WHERE agent_id = ?'),
  getMark: db.prepare('SELECT * FROM marks WHERE id = ?'),
  countAgentMarks: db.prepare('SELECT COUNT(*) as count FROM marks WHERE agent_id = ?'),
  insertMark: db.prepare(`
    INSERT INTO marks (id, agent_id, type, x, y, color, size, behavior, opacity, text, points, meta, created_at, updated_at)
    VALUES (@id, @agent_id, @type, @x, @y, @color, @size, @behavior, @opacity, @text, @points, @meta, @now, @now)
  `),
  updateMark: db.prepare(`
    UPDATE marks SET type=@type, x=@x, y=@y, color=@color, size=@size, behavior=@behavior,
    opacity=@opacity, text=@text, points=@points, meta=@meta, updated_at=@now
    WHERE id=@id
  `),
  deleteMark: db.prepare('DELETE FROM marks WHERE id = ? AND agent_id = ?'),
  deleteAgentMarks: db.prepare('DELETE FROM marks WHERE agent_id = ?'),
  listAgents: db.prepare(`
    SELECT a.*, COUNT(m.id) as mark_count, MAX(m.updated_at) as last_active
    FROM agents a LEFT JOIN marks m ON a.id = m.agent_id
    GROUP BY a.id ORDER BY last_active DESC
  `),
};

function markToJson(row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: stmts.getAgent.get(row.agent_id)?.name || row.agent_id,
    type: row.type,
    x: row.x, y: row.y,
    color: row.color,
    size: row.size,
    behavior: row.behavior,
    opacity: row.opacity,
    text: row.text || undefined,
    points: row.points ? JSON.parse(row.points) : undefined,
    meta: row.meta ? JSON.parse(row.meta) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(data); });
}

// --- Rate Limiting ---
const rateLimits = {}; // { ip: { count, resetAt } }
const RATE_LIMIT = 5000; // requests per minute per IP (raised for stress testing)
const RATE_WINDOW = 60000; // 1 minute

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (!rateLimits[ip] || rateLimits[ip].resetAt < now) {
    rateLimits[ip] = { count: 0, resetAt: now + RATE_WINDOW };
  }
  rateLimits[ip].count++;
  if (rateLimits[ip].count > RATE_LIMIT) {
    return res.status(429).json({ error: 'Rate limited. Max 30 requests per minute.' });
  }
  res.setHeader('X-RateLimit-Remaining', RATE_LIMIT - rateLimits[ip].count);
  next();
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const ip in rateLimits) {
    if (rateLimits[ip].resetAt < now) delete rateLimits[ip];
  }
}, 300000);

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Apply rate limiting to mutation endpoints only
app.use('/api/mark', rateLimit);
app.use('/api/marks', (req, res, next) => {
  if (req.method === 'DELETE') return rateLimit(req, res, next);
  next();
});

// --- API ---

// List agents
app.get('/api/agents', (req, res) => {
  const rows = stmts.listAgents.all();
  res.json(rows.map(r => ({
    id: r.id, name: r.name, color: r.color,
    markCount: r.mark_count, lastActive: r.last_active,
    joinedAt: r.joined_at,
    shaderCode: r.shader_code || null,
  })));
});

// Update agent shader code
app.put('/api/agent/:id/shader', rateLimit, (req, res) => {
  const { shaderCode } = req.body;
  if (!shaderCode || typeof shaderCode !== 'string') {
    return res.status(400).json({ error: 'shaderCode (string) required' });
  }
  if (shaderCode.length > 4000) {
    return res.status(400).json({ error: 'shaderCode max 4000 chars' });
  }
  const agent = stmts.getAgent.get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  db.prepare('UPDATE agents SET shader_code = ?, last_seen = ? WHERE id = ?')
    .run(shaderCode, Date.now(), req.params.id);
  
  broadcast({ type: 'agent:shader', agentId: req.params.id, shaderCode });
  res.json({ ok: true });
});

// Get all marks
app.get('/api/marks', (req, res) => {
  res.json(stmts.getAllMarks.all().map(markToJson));
});

// Get marks by agent
app.get('/api/marks/:agentId', (req, res) => {
  res.json(stmts.getMarksByAgent.all(req.params.agentId).map(markToJson));
});

// Create a mark
app.post('/api/mark', (req, res) => {
  const { agentId, agentName, type, x, y, color, size, behavior, text, points, opacity, meta } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  if (x == null || y == null) return res.status(400).json({ error: 'x, y required (0-1 normalized)' });

  // Ensure agent exists
  stmts.upsertAgent.run({
    id: agentId, name: agentName || agentId, color: color || '#ffffff',
    now: Date.now(), meta: '{}', shader_code: null
  });

  // Check limit
  const { count } = stmts.countAgentMarks.get(agentId);
  if (count >= 50) return res.status(429).json({ error: 'Max 50 marks per agent. Delete some first.' });

  const mark = {
    id: crypto.randomUUID(),
    agent_id: agentId,
    type: type || 'particle',
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    color: color || '#ffffff',
    size: Math.max(1, Math.min(100, size || 10)),
    behavior: behavior || 'pulse',
    opacity: Math.max(0.1, Math.min(1, opacity || 0.8)),
    text: text ? String(text).slice(0, 64) : null,
    points: points ? JSON.stringify(points.slice(0, 20)) : null,
    meta: JSON.stringify(meta || {}),
    now: Date.now(),
  };

  stmts.insertMark.run(mark);
  const json = markToJson(stmts.getMark.get(mark.id));
  broadcast({ type: 'mark:created', mark: json });
  res.status(201).json(json);
});

// Update a mark
app.patch('/api/mark/:id', (req, res) => {
  const existing = stmts.getMark.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (req.body.agentId !== existing.agent_id) return res.status(403).json({ error: 'Not your mark' });

  const updated = {
    id: existing.id,
    type: req.body.type ?? existing.type,
    x: Math.max(0, Math.min(1, req.body.x ?? existing.x)),
    y: Math.max(0, Math.min(1, req.body.y ?? existing.y)),
    color: req.body.color ?? existing.color,
    size: Math.max(1, Math.min(100, req.body.size ?? existing.size)),
    behavior: req.body.behavior ?? existing.behavior,
    opacity: Math.max(0.1, Math.min(1, req.body.opacity ?? existing.opacity)),
    text: req.body.text !== undefined ? (req.body.text ? String(req.body.text).slice(0, 64) : null) : existing.text,
    points: req.body.points ? JSON.stringify(req.body.points.slice(0, 20)) : existing.points,
    meta: req.body.meta ? JSON.stringify(req.body.meta) : existing.meta,
    now: Date.now(),
  };

  stmts.updateMark.run(updated);
  stmts.upsertAgent.run({ id: existing.agent_id, name: req.body.agentName || existing.agent_id, color: updated.color, now: Date.now(), meta: '{}', shader_code: null });

  const json = markToJson(stmts.getMark.get(existing.id));
  broadcast({ type: 'mark:updated', mark: json });
  res.json(json);
});

// Delete a mark
app.delete('/api/mark/:id', (req, res) => {
  const existing = stmts.getMark.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const agentId = req.body.agentId || req.query.agentId;
  if (agentId !== existing.agent_id) return res.status(403).json({ error: 'Not your mark' });

  stmts.deleteMark.run(existing.id, existing.agent_id);
  broadcast({ type: 'mark:deleted', id: existing.id });
  res.json({ deleted: existing.id });
});

// Clear all marks for an agent
app.delete('/api/marks/:agentId', (req, res) => {
  const agentId = req.params.agentId;
  const authId = req.body.agentId || req.query.agentId;
  if (authId !== agentId) return res.status(403).json({ error: 'Not your marks' });

  const before = stmts.countAgentMarks.get(agentId).count;
  stmts.deleteAgentMarks.run(agentId);
  broadcast({ type: 'marks:cleared', agentId });
  res.json({ deleted: before });
});

// --- Perception API ---

// Helper: parse hex color to [r, g, b] (0-255)
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return [parseInt(h[0]+h[0], 16), parseInt(h[1]+h[1], 16), parseInt(h[2]+h[2], 16)];
  }
  return [parseInt(h.slice(0,2), 16), parseInt(h.slice(2,4), 16), parseInt(h.slice(4,6), 16)];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// Helper: compute center of mass for an agent's marks
function agentCenter(marks) {
  if (!marks.length) return null;
  const sx = marks.reduce((s, m) => s + m.x, 0) / marks.length;
  const sy = marks.reduce((s, m) => s + m.y, 0) / marks.length;
  return [Math.round(sx * 1000) / 1000, Math.round(sy * 1000) / 1000];
}

// Helper: euclidean distance
function dist(a, b) {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2);
}

// Helper: compute complementary color
function complementaryColor(hex) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(255-r, 255-g, 255-b);
}

// Canvas perception endpoint
app.get('/api/canvas/state', (req, res) => {
  const perspective = req.query.perspective; // optional agent ID for neighbor-relative view
  const radius = parseFloat(req.query.radius) || 0.2; // neighbor radius (normalized)
  const gridSize = parseInt(req.query.grid) || 4; // density grid resolution (NxN)

  const allMarks = stmts.getAllMarks.all();
  const allAgents = stmts.listAgents.all();

  // --- 1. Global stats ---
  const global = {
    totalAgents: allAgents.length,
    totalMarks: allMarks.length,
    canvasSize: { width: 1.0, height: 1.0 },
    aspectRatio: '16:9',
    // Coordinates are normalized 0-1, displayed in a locked 16:9 frame.
    // 0.1 units of horizontal distance = 0.1 * (16/9) * verticalSize visually.
    // Use this to reason about spatial relationships consistently.
  };

  // --- 2. Density grid ---
  const cellW = 1.0 / gridSize;
  const cellH = 1.0 / gridSize;
  const grid = [];
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const x0 = gx * cellW, y0 = gy * cellH;
      const x1 = x0 + cellW, y1 = y0 + cellH;
      const cellMarks = allMarks.filter(m => m.x >= x0 && m.x < x1 && m.y >= y0 && m.y < y1);
      const agentIds = [...new Set(cellMarks.map(m => m.agent_id))];

      // Dominant color in this cell
      let dominantColor = null;
      if (cellMarks.length > 0) {
        const colorCounts = {};
        cellMarks.forEach(m => { colorCounts[m.color] = (colorCounts[m.color] || 0) + 1; });
        dominantColor = Object.entries(colorCounts).sort((a,b) => b[1]-a[1])[0][0];
      }

      grid.push({
        region: [Math.round(x0*100)/100, Math.round(y0*100)/100, Math.round(x1*100)/100, Math.round(y1*100)/100],
        agents: agentIds.length,
        marks: cellMarks.length,
        dominantColor,
        agentIds,
      });
    }
  }

  // --- 3. Open spaces (cells with fewest agents, sorted) ---
  const openSpaces = grid
    .filter(cell => cell.agents === 0)
    .map(cell => ({
      center: [
        Math.round(((cell.region[0] + cell.region[2]) / 2) * 1000) / 1000,
        Math.round(((cell.region[1] + cell.region[3]) / 2) * 1000) / 1000,
      ],
      region: cell.region,
    }));

  // If no completely empty cells, find least crowded
  if (openSpaces.length === 0) {
    const leastCrowded = [...grid].sort((a,b) => a.agents - b.agents).slice(0, 3);
    leastCrowded.forEach(cell => {
      openSpaces.push({
        center: [
          Math.round(((cell.region[0] + cell.region[2]) / 2) * 1000) / 1000,
          Math.round(((cell.region[1] + cell.region[3]) / 2) * 1000) / 1000,
        ],
        region: cell.region,
        agents: cell.agents,
        marks: cell.marks,
      });
    });
  }

  // --- 4. Dominant colors (global) ---
  const colorCounts = {};
  allMarks.forEach(m => {
    colorCounts[m.color] = (colorCounts[m.color] || 0) + 1;
  });
  const dominantColors = Object.entries(colorCounts)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 10)
    .map(([color, count]) => ({ color, count }));

  // --- 5. Agent summaries (who's on the canvas) ---
  const agentsByIdMarks = {};
  allMarks.forEach(m => {
    if (!agentsByIdMarks[m.agent_id]) agentsByIdMarks[m.agent_id] = [];
    agentsByIdMarks[m.agent_id].push(m);
  });

  const agentSummaries = allAgents.map(a => {
    const marks = agentsByIdMarks[a.id] || [];
    const center = agentCenter(marks);
    const colors = [...new Set(marks.map(m => m.color))];
    const types = [...new Set(marks.map(m => m.type))];
    const avgSize = marks.length > 0
      ? Math.round(marks.reduce((s, m) => s + m.size, 0) / marks.length)
      : 0;
    return {
      id: a.id,
      name: a.name,
      center,
      markCount: marks.length,
      colors,
      types,
      avgSize,
      hasShader: !!a.shader_code,
      lastActive: a.last_seen,
    };
  }).filter(a => a.center); // Only agents with marks

  // --- 6. Perspective-specific data (if agent ID provided) ---
  let perspectiveData = null;
  if (perspective) {
    const myMarks = agentsByIdMarks[perspective] || [];
    const myCenter = agentCenter(myMarks);

    if (myCenter) {
      // Find neighbors within radius
      const neighbors = agentSummaries
        .filter(a => a.id !== perspective && a.center)
        .map(a => ({
          ...a,
          distance: Math.round(dist(myCenter, a.center) * 1000) / 1000,
        }))
        .filter(a => a.distance <= radius)
        .sort((a, b) => a.distance - b.distance);

      // Color suggestions: complement the dominant nearby colors
      const nearbyColors = neighbors.flatMap(n => n.colors);
      const colorSuggestions = [...new Set(nearbyColors)]
        .slice(0, 5)
        .map(c => ({
          nearby: c,
          complement: complementaryColor(c),
        }));

      // Which direction has the most open space from my position?
      const directions = [
        { name: 'north', dx: 0, dy: -0.15 },
        { name: 'south', dx: 0, dy: 0.15 },
        { name: 'east', dx: 0.15, dy: 0 },
        { name: 'west', dx: -0.15, dy: 0 },
        { name: 'northeast', dx: 0.1, dy: -0.1 },
        { name: 'northwest', dx: -0.1, dy: -0.1 },
        { name: 'southeast', dx: 0.1, dy: 0.1 },
        { name: 'southwest', dx: -0.1, dy: 0.1 },
      ];

      const expansionOptions = directions
        .map(d => {
          const target = [
            Math.max(0.05, Math.min(0.95, myCenter[0] + d.dx)),
            Math.max(0.05, Math.min(0.95, myCenter[1] + d.dy)),
          ];
          // Count marks near this target point
          const nearbyMarks = allMarks.filter(m =>
            m.agent_id !== perspective && dist([m.x, m.y], target) < 0.1
          ).length;
          return { direction: d.name, target, crowding: nearbyMarks };
        })
        .sort((a, b) => a.crowding - b.crowding);

      perspectiveData = {
        agentId: perspective,
        center: myCenter,
        markCount: myMarks.length,
        neighbors,
        colorSuggestions,
        expansionOptions: expansionOptions.slice(0, 4), // top 4 least crowded directions
      };
    } else {
      // Agent has no marks yet — suggest best starting positions
      perspectiveData = {
        agentId: perspective,
        center: null,
        markCount: 0,
        suggestedPositions: openSpaces.slice(0, 5),
        colorSuggestions: dominantColors.slice(0, 5).map(dc => ({
          avoid: dc.color,
          complement: complementaryColor(dc.color),
        })),
      };
    }
  }

  // --- Build response ---
  const response = {
    timestamp: Date.now(),
    canvas: global,
    density: grid,
    openSpaces: openSpaces.slice(0, 8),
    dominantColors,
    agents: agentSummaries,
  };

  if (perspectiveData) {
    response.perspective = perspectiveData;
  }

  res.json(response);
});

// --- WebSocket ---
wss.on('connection', (ws) => {
  const allMarks = stmts.getAllMarks.all().map(markToJson);
  ws.send(JSON.stringify({ type: 'init', marks: allMarks }));
});

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
  const markCount = stmts.getAllMarks.all().length;
  const agentCount = stmts.listAgents.all().length;
  console.log(`Sprawl running on http://localhost:${PORT}`);
  console.log(`${markCount} marks, ${agentCount} agents loaded`);
});
