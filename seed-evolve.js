/**
 * Seed canvases using the REAL evolve-v2 system.
 * Creates agents, assigns them to subthemes, runs 3 phases (foundation → layering → polish).
 */
const Database = require('better-sqlite3');
const db = new Database('data/sprawl.db');
const { evolveAgent } = require('./evolve-v2');

const NEON_ID = 'bb812353-526a-4e5f-9a19-2278051ca00b';
const WILD_ID = 'de2df769-5d44-4fab-9a55-eb8b9d8b31aa';

// Update subthemes on canvases
db.prepare('UPDATE canvases SET subthemes = ? WHERE id = ?').run(JSON.stringify([
  { name: 'buildings', spatial_guide: 'Tall building silhouettes y=-100 to y=120. Towers at x=-150 (tall, y=-200), x=-30 (medium, y=-120), x=80 (tallest, y=-250), x=180 (medium, y=-140). Each building is a COLUMN of tightly packed dots every 8px. Dark blues and deep cyan masses. Window grids: tiny bright dots in rows on building faces. Some buildings in BACKGROUND (lower opacity 0.1-0.3, smaller) creating depth behind foreground towers.', agent_cap: 3 },
  { name: 'neon_signs', spatial_guide: 'Glowing signs y=-50 to y=80 on building faces. TEXT marks: "HOTEL" at (-150,0), "BAR" at (-30,40), "CYBER" at (80,-20), "24HR" at (180,60). Surround text with glow dots (same color, 2x size, opacity 0.1-0.2). Bright magenta and cyan. Some signs BEHIND buildings (low opacity) for depth.', agent_cap: 2 },
  { name: 'street', spatial_guide: 'Road y=120 to y=200. Dense dark mass for pavement. Lane markings as dashed white dots at y=160. Sidewalk edges. A few cars as tight clusters of warm dots.', agent_cap: 2 },
  { name: 'reflections', spatial_guide: 'Wet ground y=200 to y=300. Mirror neon colors from above at LOW opacity (0.08-0.25). Vertical streaks of cyan/magenta. Blurrier = larger dots, lower opacity. This creates the rain-slicked street effect.', agent_cap: 1 },
  { name: 'atmosphere', spatial_guide: 'Sky y=-300 to y=-200. Sparse distant lights. Rain: tiny dots (1-3) scattered everywhere at 0.05-0.1 opacity. Fog near street level: large (30-40) very faint dots. Light halos near neon sources.', agent_cap: 1 }
]), NEON_ID);

db.prepare('UPDATE canvases SET subthemes = ? WHERE id = ?').run(JSON.stringify([
  { name: 'flowers', spatial_guide: 'Flower clusters at (-150,-50), (0,-100), (120,-30), (-80,50), (180,20). Each flower: center (3-4 warm small dots), surrounded by 12-20 petal dots (size 15-28) in a circle ~30-50px out. OVERLAP petals. Some flowers BEHIND others (lower opacity, smaller) for depth. Recognizable circular flower shapes.', agent_cap: 3 },
  { name: 'stems', spatial_guide: 'Green stems from flower centers down to y=100-180. Column of dots every 8px. Leaves: 2-3 dots branching at angles. Stems of background flowers thinner and lighter.', agent_cap: 2 },
  { name: 'grass', spatial_guide: 'Ground y=100 to y=280. Dense green fill. Mix light and dark green. Structure dots (10-18) for clumps, texture dots (3-6) for blades. FILL this area densely.', agent_cap: 2 },
  { name: 'sky', spatial_guide: 'Upper y=-300 to y=-180. Light blue sparse dots. Sun glow upper right: 2-3 large pale yellow dots at low opacity.', agent_cap: 1 },
  { name: 'details', spatial_guide: 'Pollen: tiny yellow dots scattered between flowers. Butterfly: paired arcs near flowers. Dewdrops: tiny bright white dots on petals.', agent_cap: 1 }
]), WILD_ID);

// Agent colors for visual coherence
const NEON_AGENTS = [
  { name: 'Architect', color: '#0080ff', subtheme: 'buildings', personality: 'Methodical, structural. Builds with precision. Creates recognizable building silhouettes with careful layering — background buildings dim, foreground buildings bright.' },
  { name: 'Neon', color: '#ff00ff', subtheme: 'neon_signs', personality: 'Electric and vivid. Places glowing text and sign shapes. Always adds glow halos around bright elements.' },
  { name: 'Pavement', color: '#1a1a33', subtheme: 'street', personality: 'Dark and grounded. Builds the road surface with dense, dark masses. Adds subtle detail — lane markings, curb edges.' },
  { name: 'Mirror', color: '#00ccff', subtheme: 'reflections', personality: 'Ethereal. Creates ghostly reflections of the scene above. Everything is lower opacity, stretched, dreamlike.' },
  { name: 'Rain', color: '#333355', subtheme: 'atmosphere', personality: 'Subtle and pervasive. Barely visible but everywhere. Tiny rain dots, fog banks, distant stars.' },
];

const WILD_AGENTS = [
  { name: 'Bloom', color: '#ff69b4', subtheme: 'flowers', personality: 'Joyful and abundant. Creates lush, overlapping flower heads. Uses radial clusters of dots to form clear circular flowers. Varies depth — some flowers behind others.' },
  { name: 'Vine', color: '#228b22', subtheme: 'stems', personality: 'Organic and connecting. Draws stems that curve naturally. Adds leaves at pleasing intervals.' },
  { name: 'Earth', color: '#90ee90', subtheme: 'grass', personality: 'Dense and foundational. Fills the ground with life. Mixes light and dark green for natural variation.' },
  { name: 'Breeze', color: '#87ceeb', subtheme: 'sky', personality: 'Light and airy. Barely there. A whisper of blue and warm sunlight.' },
  { name: 'Pollen', color: '#fff4a0', subtheme: 'details', personality: 'Delicate finishing touches. Tiny scattered beauty. The details that make you look twice.' },
];

function createAgent(a, canvasId) {
  const id = `seed-${a.name.toLowerCase()}-${canvasId.slice(0,8)}`;
  try {
    db.prepare(`INSERT OR REPLACE INTO agents (id, name, color, joined_at, last_seen, canvas_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
      id, a.name, a.color, Date.now(), Date.now(), canvasId
    );
  } catch(e) {
    // If canvas_id column doesn't exist, insert without it
    db.prepare(`INSERT OR REPLACE INTO agents (id, name, color, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)`).run(
      id, a.name, a.color, Date.now(), Date.now()
    );
  }
  // Set subtheme and personality
  try { db.prepare('UPDATE agents SET subtheme = ?, personality = ? WHERE id = ?').run(a.subtheme, a.personality, id); }
  catch(e) { /* columns may not exist */ }
  return id;
}

async function runPhase(agentIds, canvasId, phase, targetMarks) {
  console.log(`\n  Phase: ${phase} (${targetMarks} marks/agent)`);
  for (const agentId of agentIds) {
    const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(agentId);
    try {
      const result = await evolveAgent(db, agentId, canvasId, { forcePhase: phase });
      console.log(`    ${agent.name}: +${result.added} marks`);
    } catch(e) {
      console.log(`    ${agent.name}: error — ${e.message.slice(0, 80)}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

async function main() {
  // NEON CITY
  console.log('\n🏙️  NEON CITY — Creating agents and evolving...');
  const neonAgentIds = NEON_AGENTS.map(a => createAgent(a, NEON_ID));
  
  await runPhase(neonAgentIds, NEON_ID, 'foundation', 33);
  await runPhase(neonAgentIds, NEON_ID, 'foundation', 33); // second foundation pass
  await runPhase(neonAgentIds, NEON_ID, 'layering', 23);
  await runPhase(neonAgentIds, NEON_ID, 'layering', 23);
  await runPhase(neonAgentIds, NEON_ID, 'polish', 17);
  
  // WILDFLOWER
  console.log('\n🌸 WILDFLOWER — Creating agents and evolving...');
  const wildAgentIds = WILD_AGENTS.map(a => createAgent(a, WILD_ID));
  
  await runPhase(wildAgentIds, WILD_ID, 'foundation', 33);
  await runPhase(wildAgentIds, WILD_ID, 'foundation', 33);
  await runPhase(wildAgentIds, WILD_ID, 'layering', 23);
  await runPhase(wildAgentIds, WILD_ID, 'layering', 23);
  await runPhase(wildAgentIds, WILD_ID, 'polish', 17);
  
  const nc = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(NEON_ID).c;
  const wc = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(WILD_ID).c;
  console.log(`\n✅ Done! Neon City: ${nc}, Wildflower: ${wc}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
