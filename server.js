const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3500;
const DATA_FILE = path.join(__dirname, 'data', 'organisms.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load organisms from disk
function loadOrganisms() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading organisms:', e.message);
  }
  return {};
}

// Save organisms to disk
function saveOrganisms(organisms) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(organisms, null, 2));
  } catch (e) {
    console.error('Error saving organisms:', e.message);
  }
}

// Prune old organisms: sleeping after 24h, removed after 7d
function pruneOrganisms(organisms) {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let changed = false;

  for (const id of Object.keys(organisms)) {
    const o = organisms[id];
    const age = now - o.lastHeartbeat;
    if (age > 7 * DAY) {
      delete organisms[id];
      changed = true;
    } else if (age > DAY && o.status !== 'sleeping') {
      organisms[id].status = 'sleeping';
      changed = true;
    } else if (age <= DAY && o.status === 'sleeping') {
      organisms[id].status = 'active';
      changed = true;
    }
  }

  return changed;
}

let organisms = loadOrganisms();

// Prune on startup
pruneOrganisms(organisms);
saveOrganisms(organisms);

// Prune every 10 minutes
setInterval(() => {
  if (pruneOrganisms(organisms)) {
    saveOrganisms(organisms);
  }
}, 10 * 60 * 1000);

// Generate unique ID
function genId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// POST /api/join
app.post('/api/join', (req, res) => {
  const { name, color } = req.body;
  if (!name || !color) {
    return res.status(400).json({ error: 'name and color required' });
  }

  const id = genId();
  const now = Date.now();

  organisms[id] = {
    id,
    name: String(name).slice(0, 32),
    color,
    status: 'active',
    cpu: Math.random() * 30 + 5,
    memory: Math.random() * 40 + 20,
    agents: Math.floor(Math.random() * 5) + 1,
    uptime: 0,
    createdAt: now,
    lastHeartbeat: now,
  };

  saveOrganisms(organisms);
  res.json({ id, organism: organisms[id] });
});

// POST /api/heartbeat
app.post('/api/heartbeat', (req, res) => {
  const { id, cpu, memory, agents, uptime } = req.body;
  if (!id || !organisms[id]) {
    return res.status(404).json({ error: 'organism not found' });
  }

  const now = Date.now();
  organisms[id] = {
    ...organisms[id],
    cpu: cpu !== undefined ? Number(cpu) : organisms[id].cpu,
    memory: memory !== undefined ? Number(memory) : organisms[id].memory,
    agents: agents !== undefined ? Number(agents) : organisms[id].agents,
    uptime: uptime !== undefined ? Number(uptime) : organisms[id].uptime,
    lastHeartbeat: now,
    status: 'active',
  };

  saveOrganisms(organisms);
  res.json({ ok: true });
});

// GET /api/state
app.get('/api/state', (req, res) => {
  pruneOrganisms(organisms);
  res.json(Object.values(organisms));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`The Hive running on http://0.0.0.0:${PORT}`);
});
