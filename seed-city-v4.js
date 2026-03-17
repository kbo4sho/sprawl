/**
 * Seed city using composition principles.
 * Functional agents, layered back-to-front, sequential placement.
 */
const Database = require('better-sqlite3');
const db = new Database('data/sprawl.db');
const { evolveAgent } = require('./evolve-v2');

const CITY_ID = 'bb812353-526a-4e5f-9a19-2278051ca00b';

// Agents organized by LAYER (back to front)
const AGENTS = [
  // Layer 1: Shadow/Negative space — go first
  { name: 'Void', color: '#0a0a2a', subtheme: 'sky_mass', personality: 'You ARE the darkness. Place large, faint blobs that define the empty sky. Your marks are barely visible but they create the space everything else sits in. Sequential: sweep across x from -300 to 300, placing blobs every 40-50px at varying y positions.' },
  { name: 'Deep', color: '#0f1122', subtheme: 'ground_mass', personality: 'The water beneath the city. Dark, still, heavy. Large faint marks filling the lower canvas. Slightly warmer than the sky — hints of reflected color at very low opacity.' },
  
  // Layer 2: Structure — the main forms
  { name: 'Steel-L', color: '#2244aa', subtheme: 'towers', personality: 'Build towers A(x=-180) and B(x=-80, tallest). Column of dots stepping y by 8px. Tower A is BACKGROUND — opacity 0.30-0.50, smaller sizes. Tower B is FOREGROUND — opacity 0.60-0.85, full size. Taper sizes at top (buildings narrow). Include roofline dots.' },
  { name: 'Steel-C', color: '#3366cc', subtheme: 'towers', personality: 'Build tower C(x=0, medium height). Midground depth — opacity 0.45-0.70. Column of dots stepping y by 8px from y=-180 to y=100. Width about 50px. Include a few structural horizontal lines at floor levels.' },
  { name: 'Steel-R', color: '#2255bb', subtheme: 'towers', personality: 'Build towers D(x=100) and E(x=200). Tower D is FOREGROUND (tall, bright, opacity 0.55-0.85). Tower E is BACKGROUND (shorter, opacity 0.25-0.45). Columns of dots, stepping y by 8px.' },
  { name: 'Edge', color: '#4477dd', subtheme: 'tower_edges', personality: 'Define building outlines with LINES. Vertical edges (left and right side of each tower), horizontal rooflines, antenna spires on tallest towers. Clean, architectural. Lines make the rectangular shapes readable.' },
  { name: 'Ghost', color: '#1a3355', subtheme: 'reflections', personality: 'Mirror the buildings below y=100. Same x positions, inverted. Everything is faint (opacity 0.08-0.20), slightly larger, broken into streaks. Water reflections are never solid — skip gaps, wobble the x positions slightly.' },
  
  // Layer 3: Detail — definition and life
  { name: 'Grid', color: '#ffcc44', subtheme: 'windows', personality: 'Place window dots in GRID PATTERNS on the tower shapes. Rows every 12px, columns every 10px. Stay INSIDE the tower boundaries. Skip 30-40% of positions (dark windows). Tiny dots, size 2-4. This is what makes buildings recognizable.' },
  { name: 'Glow', color: '#ffdd88', subtheme: 'windows', personality: 'Accent windows. Fewer but brighter (size 4-6, opacity 0.90-1.0). Penthouse lights, corner offices. Also place small glow halos (size 10-12, opacity 0.08-0.12) behind the brightest windows. Makes them pop.' },
  { name: 'Lamp', color: '#ffaa33', subtheme: 'streetlights', personality: 'Warm streetlights along y=100 ground line. Each light: one bright dot (size 12, opacity 0.85) plus a glow halo behind it (size 22, opacity 0.10). Space them every 70px across the width. Also a couple car headlights as paired small dots.' },
  { name: 'Cosmos', color: '#8888bb', subtheme: 'stars', personality: 'Tiny scattered stars in the sky. Most are barely visible (size 1-2, opacity 0.15-0.30). A handful are brighter. The moon: tight cluster of 5-6 warm dots at (220, -300), size 15-20, opacity 0.50-0.65. The moon should be the brightest thing in the sky.' },
  
  // Layer 4: Atmosphere — unity
  { name: 'Haze', color: '#6644aa', subtheme: 'atmosphere', personality: 'The barely-visible glue. Light pollution: faint large dots rising from the skyline. Neon accents: a few magenta/cyan dots near building bases. Connecting lines between tower tops. Text words scattered: pulse, alive, glow, electric, dream, midnight. Everything at very low opacity — if your marks are individually noticeable, they are too strong.' },
];

function createAgent(a) {
  const id = `seed-${a.name.toLowerCase().replace(/[^a-z0-9]/g, '')}-city`;
  db.prepare('INSERT OR REPLACE INTO agents (id, name, color, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(
    id, a.name, a.color, Date.now(), Date.now()
  );
  try { db.prepare('UPDATE agents SET subtheme = ?, personality = ? WHERE id = ?').run(a.subtheme, a.personality, id); }
  catch(e) {}
  try { db.prepare('UPDATE agents SET canvas_id = ? WHERE id = ?').run(CITY_ID, id); }
  catch(e) {}
  return id;
}

async function runPhase(ids, phase, label) {
  console.log(`\n  ${label} (${phase})`);
  for (const id of ids) {
    const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(id);
    try {
      const result = await evolveAgent(db, id, CITY_ID, { forcePhase: phase });
      console.log(`    ${agent.name}: +${result.added}`);
    } catch(e) {
      console.log(`    ${agent.name}: err — ${e.message.slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

async function main() {
  console.log('🏙️  CITY — Principles-based seed (12 agents, layered)');
  const ids = AGENTS.map(a => createAgent(a));
  
  // Layer 1 agents first (shadow), then layer 2 (structure), then layer 3+4
  const l1 = ids.slice(0, 2);   // Void, Deep
  const l2 = ids.slice(2, 7);   // Steel-L, Steel-C, Steel-R, Edge, Ghost
  const l3 = ids.slice(7, 11);  // Grid, Glow, Lamp, Cosmos
  const l4 = ids.slice(11);     // Haze
  
  // Foundation: back layers go first so structure agents can see the space
  await runPhase(l1, 'foundation', 'Foundation — Layer 1 (shadow)');
  await runPhase(l2, 'foundation', 'Foundation — Layer 2 (structure)');
  await runPhase(l3, 'foundation', 'Foundation — Layer 3 (detail)');
  await runPhase(l4, 'foundation', 'Foundation — Layer 4 (atmosphere)');
  
  // Second foundation pass — all layers
  await runPhase(ids, 'foundation', 'Foundation Pass 2 — all agents');
  
  // Layering — fill gaps
  await runPhase(ids, 'layering', 'Layering Pass 1');
  await runPhase(ids, 'layering', 'Layering Pass 2');
  
  // Polish — fine detail
  await runPhase([...l3, ...l4], 'polish', 'Polish — detail + atmosphere');
  
  const count = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(CITY_ID).c;
  console.log(`\n✅ City: ${count} marks`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
