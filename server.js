const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3501;
const DATA_FILE = path.join(__dirname, 'data', 'organisms.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Data ──────────────────────────────────────────────────────────────────────

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeData(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Ensure data file exists
if (!fs.existsSync(DATA_FILE)) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Seed with 5 demo agents
  const demoAgents = [
    { name: 'Phantom', color: '#c084fc', recipe: 'cloud' },
    { name: 'Ember', color: '#fb923c', recipe: 'spark' },
    { name: 'Drift', color: '#00ffcc', recipe: 'tendril' },
    { name: 'Nova', color: '#f43f5e', recipe: 'orbiter' },
    { name: 'Moss', color: '#34d399', recipe: 'nucleus' },
  ];

  const seeded = demoAgents.map(d => ({
    id: crypto.randomUUID(),
    name: d.name,
    color: d.color,
    recipe: d.recipe,
    params: null, // null = use default recipe params
    status: 'active',
    joinedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
    dormant: false,
  }));

  writeData(seeded);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Get all organisms (for the simulation client)
app.get('/api/state', (req, res) => {
  const data = readData();
  const now = Date.now();

  // Mark dormant if no heartbeat in 24h, remove if >7d
  const alive = [];
  for (const org of data) {
    const age = now - new Date(org.lastHeartbeat).getTime();
    if (age > 7 * 24 * 60 * 60 * 1000) continue; // expired
    org.dormant = age > 24 * 60 * 60 * 1000;
    alive.push(org);
  }

  res.json(alive);
});

// Join the hive
app.post('/api/join', (req, res) => {
  const { name, color, recipe } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });

  const data = readData();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const organism = {
    id,
    name: name.trim().slice(0, 24),
    color: color || '#00ffcc',
    recipe: recipe || 'nucleus',
    params: null,
    status: 'active',
    joinedAt: now,
    lastHeartbeat: now,
    dormant: false,
  };

  data.push(organism);
  writeData(data);

  res.json({ id, organism });
});

// Heartbeat with optional config (the expression API)
// Agents send their params to change their organism's behavior
app.post('/api/heartbeat', (req, res) => {
  const { id, params, color, status } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const data = readData();
  const org = data.find(o => o.id === id);
  if (!org) return res.status(404).json({ error: 'organism not found' });

  org.lastHeartbeat = new Date().toISOString();
  org.dormant = false;

  // Expression: agents can update their swarm params via heartbeat
  if (params) {
    // params can include: cohesion, alignment, separation, chaos, speed, maxSpeed, radius, glow
    org.params = {
      ...(org.params || {}),
      ...params,
    };
  }

  if (color) org.color = color;
  if (status) org.status = status;

  writeData(data);
  res.json({ ok: true, organism: org });
});

// Get neighbors (so agents can react to who's near them)
app.get('/api/neighbors', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  const data = readData();
  const org = data.find(o => o.id === id);
  if (!org) return res.status(404).json({ error: 'not found' });

  // Return all other active organisms (client handles proximity)
  const others = data
    .filter(o => o.id !== id && !o.dormant)
    .map(o => ({ id: o.id, name: o.name, recipe: o.recipe, color: o.color }));

  res.json({ neighbors: others });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`The Hive running on http://0.0.0.0:${PORT}`);
});
