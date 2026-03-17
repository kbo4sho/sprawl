/**
 * Seed city canvas matching PRODUCTION quality.
 * Uses production subthemes, 8 agents, 6 phases, targeting 850+ marks.
 */
const Database = require('better-sqlite3');
const db = new Database('data/sprawl.db');
const { evolveAgent } = require('./evolve-v2');

const CITY_ID = 'bb812353-526a-4e5f-9a19-2278051ca00b';

const AGENTS = [
  // 3 tower agents (different areas)
  { name: 'Tower-Left', color: '#2244aa', subtheme: 'towers', personality: 'Builds the LEFT side of the skyline (x=-250 to x=-50). Creates 2-3 buildings of varying heights. Columns of tightly stacked dots. Vertical edge lines define building outlines.' },
  { name: 'Tower-Center', color: '#3355bb', subtheme: 'towers', personality: 'Builds the CENTER and tallest towers (x=-80 to x=80). The hero buildings. One reaches y=-300. Dense, imposing, with antenna spires at top.' },
  { name: 'Tower-Right', color: '#2255cc', subtheme: 'towers', personality: 'Builds the RIGHT side (x=50 to x=250). Medium-height buildings. Some slightly behind center towers (lower opacity) for depth.' },
  // 2 window agents
  { name: 'WindowGrid', color: '#ffcc44', subtheme: 'windows', personality: 'Places tiny bright window dots in GRID PATTERNS on the buildings. Rows and columns of small dots (size 2-4). Not every window lit — random 60-70%. This is what makes buildings look alive and defined.' },
  { name: 'WindowGlow', color: '#ffdd88', subtheme: 'windows', personality: 'Places slightly larger, brighter accent windows (size 4-6, opacity 0.9-1.0). Corner offices, penthouses. Also adds warm glow around some windows. Fewer marks but more impactful.' },
  // 2 sky agents
  { name: 'Stars', color: '#8888bb', subtheme: 'sky', personality: 'Fills the sky with scattered stars. Tiny dots (size 1-3) at low opacity. A few brighter ones. Adds the moon — cluster of warm dots in upper corner.' },
  { name: 'Clouds', color: '#334466', subtheme: 'sky', personality: 'Wispy cloud formations between buildings and in the upper sky. Faint clusters of medium dots. Text words scattered: night, vast, quiet, dream.' },
  // 2 ground agents
  { name: 'Reflections', color: '#1a3355', subtheme: 'ground', personality: 'Creates water reflections below the skyline. Mirror images of buildings but stretched, wobbly, low opacity (0.1-0.3). Streaks of light reflected in water.' },
  { name: 'Streets', color: '#dd8833', subtheme: 'ground', personality: 'Streetlights along ground line — bright warm dots. Sidewalk detail. Text: street, wander, hum. A few car headlights as paired dots.' },
  // 1 atmosphere agent
  { name: 'Haze', color: '#6644aa', subtheme: 'atmosphere', personality: 'Light pollution glow rising from skyline. Very faint large dots between buildings. Neon colored accents near building bases. Connecting lines between tower tops. Text: pulse, alive, glow, electric.' },
];

function createAgent(a) {
  const id = `seed-${a.name.toLowerCase().replace(/[^a-z0-9]/g, '')}-city`;
  try {
    db.prepare('INSERT OR REPLACE INTO agents (id, name, color, joined_at, last_seen, canvas_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, a.name, a.color, Date.now(), Date.now(), CITY_ID
    );
  } catch(e) {
    db.prepare('INSERT OR REPLACE INTO agents (id, name, color, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(
      id, a.name, a.color, Date.now(), Date.now()
    );
  }
  try { db.prepare('UPDATE agents SET subtheme = ?, personality = ? WHERE id = ?').run(a.subtheme, a.personality, id); }
  catch(e) {}
  return id;
}

async function runPhase(agentIds, phase) {
  console.log(`\n  Phase: ${phase}`);
  for (const agentId of agentIds) {
    const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(agentId);
    try {
      const result = await evolveAgent(db, agentId, CITY_ID, { forcePhase: phase });
      console.log(`    ${agent.name}: +${result.added} marks`);
    } catch(e) {
      console.log(`    ${agent.name}: error — ${e.message.slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

async function main() {
  console.log('🏙️  CITY SKYLINE — Production quality seed (10 agents, 6 phases)');
  
  const agentIds = AGENTS.map(a => createAgent(a));
  
  // 6 phases: foundation x2, layering x2, polish x2
  await runPhase(agentIds, 'foundation');
  await runPhase(agentIds, 'foundation');
  await runPhase(agentIds, 'layering');
  await runPhase(agentIds, 'layering');
  await runPhase(agentIds, 'polish');
  await runPhase(agentIds, 'polish');
  
  const count = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(CITY_ID).c;
  console.log(`\n✅ Done! City: ${count} marks`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
