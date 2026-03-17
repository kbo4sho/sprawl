const Database = require('better-sqlite3');
const db = new Database('data/sprawl.db');
const { evolveAgent } = require('./evolve-v2');

const WILD_ID = 'de2df769-5d44-4fab-9a55-eb8b9d8b31aa';

const AGENTS = [
  // Layer 1
  { name: 'Soil', color: '#2a3a1a', subtheme: 'earth', personality: 'Dark, grounding. Large faint marks that define the earth beneath everything. Sequential sweep across the ground area. Warm dark greens and browns.' },
  { name: 'Sky', color: '#aaccee', subtheme: 'sky_wash', personality: 'Barely there. Pale blue whispers in the upper canvas. The sun glow is warm yellow, very large, very faint. Mostly empty — the sky is open and light.' },
  // Layer 2
  { name: 'Behind', color: '#cc7799', subtheme: 'petals_back', personality: 'Painter of the distant flowers. These sit behind the heroes. Lower opacity, smaller, softer. Three flowers at their positions, each a careful radial cluster stepping through angles.' },
  { name: 'Rose', color: '#ff69b4', subtheme: 'petals_front', personality: 'The main flowers. Bold, bright, overlapping petal dots arranged in radial clusters. Step through angles 0-360°, placing a dot every 20-25°. Size tapers at edges. These are what people see first.' },
  { name: 'Peony', color: '#ee5588', subtheme: 'petals_front', personality: 'Second foreground flower agent. Same technique as Rose but slightly different pink. Fills in the hero flowers with additional petal density. Overlap with Rose creates rich, full blooms.' },
  { name: 'Pollen', color: '#ffaa33', subtheme: 'centers', personality: 'Warm, bright, dense. The glowing hearts of each flower. Tight clusters of orange-yellow dots. These are the brightest spots in the scene — they draw the eye.' },
  { name: 'Vine', color: '#1a6622', subtheme: 'stems', personality: 'Organic connector. Traces stems downward from each flower, curving slightly. Adds leaves as small branch clusters. Background flower stems are thinner and fainter.' },
  { name: 'Turf-A', color: '#55aa44', subtheme: 'grass_fill', personality: 'Fills the left half of the grass area (x=-250 to x=0). Sequential sweep, dense coverage. Light green mixed with darker tones. Make it feel like solid ground.' },
  { name: 'Turf-B', color: '#338833', subtheme: 'grass_fill', personality: 'Fills the right half of the grass area (x=0 to x=250). Same technique, slightly darker green for variety. Dense, sequential placement.' },
  // Layer 3
  { name: 'Blade', color: '#88cc66', subtheme: 'grass_blades', personality: 'Fine grass texture on top of the turf. Tiny upward-pointing marks that catch the light. Scattered but not random — cluster them in natural clumps.' },
  { name: 'Dew', color: '#ffccdd', subtheme: 'petal_detail', personality: 'The finishing touches on flower petals. Tiny bright highlights that define petal edges. White dewdrop dots that sparkle. Only on foreground flowers.' },
  // Layer 4
  { name: 'Breeze', color: '#fff4a0', subtheme: 'atmosphere', personality: 'The invisible connective tissue. Pollen dust drifting between flowers. A butterfly. Faint sun rays. Whispered words. Everything is barely there but makes the scene feel alive and unified.' },
];

function createAgent(a) {
  const id = `seed-${a.name.toLowerCase()}-wild`;
  db.prepare('INSERT OR REPLACE INTO agents (id, name, color, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(
    id, a.name, a.color, Date.now(), Date.now()
  );
  try { db.prepare('UPDATE agents SET subtheme = ?, personality = ?, canvas_id = ? WHERE id = ?').run(a.subtheme, a.personality, WILD_ID, id); }
  catch(e) { try { db.prepare('UPDATE agents SET subtheme = ?, personality = ? WHERE id = ?').run(a.subtheme, a.personality, id); } catch(e2) {} }
  return id;
}

async function runPhase(ids, phase, label) {
  console.log(`\n  ${label}`);
  for (const id of ids) {
    const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(id);
    try {
      const result = await evolveAgent(db, id, WILD_ID, { forcePhase: phase });
      console.log(`    ${agent.name}: +${result.added}`);
    } catch(e) {
      console.log(`    ${agent.name}: err — ${e.message.slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

async function main() {
  console.log('🌸 WILDFLOWER — Principles-based seed (12 agents, layered)');
  const ids = AGENTS.map(a => createAgent(a));
  
  const l1 = ids.slice(0, 2);
  const l2 = ids.slice(2, 9);
  const l3 = ids.slice(9, 11);
  const l4 = ids.slice(11);
  
  await runPhase(l1, 'foundation', 'Foundation — Layer 1 (shadow)');
  await runPhase(l2, 'foundation', 'Foundation — Layer 2 (structure)');
  await runPhase(l3, 'foundation', 'Foundation — Layer 3 (detail)');
  await runPhase(l4, 'foundation', 'Foundation — Layer 4 (atmosphere)');
  await runPhase(ids, 'foundation', 'Foundation Pass 2 — all');
  await runPhase(ids, 'layering', 'Layering Pass 1');
  await runPhase(ids, 'layering', 'Layering Pass 2');
  await runPhase([...l3, ...l4], 'polish', 'Polish — detail + atmosphere');
  
  const count = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(WILD_ID).c;
  console.log(`\n✅ Wildflower: ${count} marks`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
