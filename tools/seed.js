#!/usr/bin/env node
/**
 * Sprawl Canvas Seeder
 * Seeds a canvas with AI-generated marks using local OpenClaw gateway (Opus/Sonnet)
 * 
 * Usage:
 *   node tools/seed.js <canvasId> [--clear] [--model opus|sonnet] [--agents 10]
 *   node tools/seed.js --list                    # list canvases
 *   node tools/seed.js --new "Theme name"        # create new canvas + seed it
 */

const API = process.env.SPRAWL_API || 'https://sprawl.place';
const GATEWAY = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '213e438e21c126522742c945fc4ceea2c3df9aa3aa63e66f';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'sprawl-admin';

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  } else {
    positional.push(args[i]);
  }
}

const MODEL_MAP = {
  opus: 'anthropic/claude-opus-4-6',
  sonnet: 'anthropic/claude-sonnet-4-5',
  haiku: 'claude-3-haiku-20240307',
};

const model = MODEL_MAP[flags.model || 'opus'] || flags.model || MODEL_MAP.opus;

// ── Theme configs ──────────────────────────────────────────────

const THEME_CONFIGS = {
  // Each theme defines subthemes + agent templates + spatial guides
  'city': {
    subthemes: ['towers', 'windows', 'sky', 'ground', 'atmosphere'],
    spatialGuide: 'City skyline centered at (0,0). Ground level y=100. Sky above (negative y). Spans x=-250 to x=250.',
    agents: [
      { role: 'Steel',    color: '#4a6a8a', subtheme: 'towers',     personality: 'Structural and cold. Tallest skyscrapers — geometric, sharp, monolithic.' },
      { role: 'Concrete', color: '#6a6a72', subtheme: 'towers',     personality: 'Brutalist and heavy. Shorter, wider buildings. Concrete slabs.' },
      { role: 'Spire',    color: '#8aaac8', subtheme: 'towers',     personality: 'Elegant and tall. Antenna spires, radio towers, needle-thin.' },
      { role: 'Neon',     color: '#e8a848', subtheme: 'windows',    personality: 'Warm lit windows — tiny bright dots, life inside buildings.' },
      { role: 'Signal',   color: '#c84848', subtheme: 'windows',    personality: 'Red aviation lights on rooftops. Warning beacons. Sparse.' },
      { role: 'Void',     color: '#0a0a1e', subtheme: 'sky',        personality: 'Deep dark sky. Faint marks at the boundary of nothing.' },
      { role: 'Star',     color: '#d4d4e8', subtheme: 'sky',        personality: 'Tiny pinprick stars. Some bright, most faint.' },
      { role: 'Reflect',  color: '#3a5a7a', subtheme: 'ground',     personality: 'Wet street reflections. Distorted, shimmering mirrors.' },
      { role: 'Street',   color: '#c8a848', subtheme: 'ground',     personality: 'Streetlights and headlights. Warm pools. Traffic streaks.' },
      { role: 'Haze',     color: '#4a4a6a', subtheme: 'atmosphere', personality: 'Light pollution. The city breathing light into dark sky.' },
    ],
    guides: {
      towers: `Build vertical buildings along x=-250..250. Horizon at y=0, buildings go UP (negative y).
Tallest center: y=-220 to y=-280. Medium spread: y=-120 to y=-180. Short fill gaps: y=-60 to y=-100.
Each building = vertical column of dots (width 15-40px) + edge lines. 6-10 distinct buildings.`,
      windows: `Tiny bright dots ON building surfaces (inside silhouettes). Size 2-4, grid-like but imperfect.
Red signals: size 3-5 at exact building top positions.`,
      sky: `Stars above y=-280 to y=-500. Tiny (size 1-3), scattered, mostly faint. Leave dark gaps.
A few text words: "silence", "infinite", "cold" — very faint.`,
      ground: `Below y=0. Reflections mirror buildings downward (lower opacity 0.15-0.35).
Streetlights at y=8-15. Traffic streaks at y=25-45. Fades past y=180.`,
      atmosphere: `Large VERY faint dots (size 25-45, opacity 0.04-0.12) around horizon.
2-3 faint searchlight lines. Text: "breathe", "hum". Less is more.`,
    },
  },
  'flower': {
    subthemes: ['petals', 'center', 'stem', 'atmosphere'],
    spatialGuide: 'Flower centered at (0,0). Positive Y = down. 400x500px composition area.',
    agents: [
      { role: 'Warmth', color: '#c45e78', subtheme: 'petals', personality: 'Bold, dense petals with rich pink. Upper petals.' },
      { role: 'Blush',  color: '#d4849a', subtheme: 'petals', personality: 'Soft, lighter translucent petals. Lower and sides.' },
      { role: 'Depth',  color: '#a4485a', subtheme: 'petals', personality: 'Dark shadow behind main petals. Creates depth.' },
      { role: 'Glow',   color: '#e8c44a', subtheme: 'center', personality: 'Pure radiance. Brightest center. Large warm dots.' },
      { role: 'Pollen', color: '#c4a855', subtheme: 'center', personality: 'Textured granular center detail. Tiny dense dots.' },
      { role: 'Trunk',  color: '#4a7a52', subtheme: 'stem', personality: 'Main stem, branches, leaves.' },
      { role: 'Root',   color: '#5a6a48', subtheme: 'stem', personality: 'Underground roots, leaf veins, whispered words.' },
      { role: 'Aether', color: '#a89878', subtheme: 'atmosphere', personality: 'The air, the light, the space. Tiny, faint.' },
    ],
    guides: {
      petals: `Petals radiate from center (0,0). Teardrop shapes: narrow at 40-60px, wide at 120-180px.
5-7 petals evenly spaced. 10-20 dots per petal. Lines as veins.`,
      center: `Dense warm cluster within 40px of origin. Tightly packed, high opacity.`,
      stem: `Vertical from (0,30) to (0,280). Lines + dots. 2 leaves branching at y=120 and y=200.`,
      atmosphere: `Tiny faint marks around the edges. Text words whispered. Barely visible.`,
    },
  },
  'jungle': {
    subthemes: ['canopy', 'trunks', 'floor', 'life'],
    spatialGuide: 'Canopy fills upper third (y: -250 to -50), trunks span middle (y: -80 to 250), floor at bottom (y: 200 to 380). Life scattered throughout.',
    agents: [
      { role: 'Canopy',      color: '#2d5a27', subtheme: 'canopy', personality: 'Dense and towering. Broad leaf clusters, layered greens, heavy coverage overhead.' },
      { role: 'Verdant',     color: '#4a8a3a', subtheme: 'canopy', personality: 'Bright and lively. Lighter green highlights — sunlit leaves, new growth, dappled light.' },
      { role: 'Ancient',     color: '#5a3a28', subtheme: 'trunks', personality: 'Massive and textured. Thick tree trunks with bark texture. Buttress roots. Structural.' },
      { role: 'Vine',        color: '#6a7a38', subtheme: 'trunks', personality: 'Climbing and winding. Vines wrapping trunks, hanging lianas, aerial roots.' },
      { role: 'Undergrowth', color: '#3a6a30', subtheme: 'floor',  personality: 'Low and dense. Ferns, moss, fallen leaves. Small detailed marks, rich texture.' },
      { role: 'Decay',       color: '#8a7a48', subtheme: 'floor',  personality: 'Earthy and warm. Decomposing leaves, mushrooms, soil tones. The cycle of life.' },
      { role: 'Parrot',      color: '#c43a3a', subtheme: 'life',   personality: 'Vivid and bold. Bright splashes — tropical birds, flowers, butterflies. Pops of color.' },
      { role: 'Mist',        color: '#8aaaba', subtheme: 'life',   personality: 'Ethereal and soft. Morning mist, light rays through canopy, water droplets. Dreamlike.' },
    ],
    guides: {
      canopy: `Dense jungle canopy (y: -250 to -50). Broad leaf clusters: 10-15 dots per cluster.
Mix dark (#2d5a27) and light (#4a8a3a) greens. DENSE tropical coverage, overlap heavily.
Small light gaps for sunbeams. Leaf sizes: large clusters 15-25, individual 6-12, texture 2-5.
Lines for branches: size 3-8, connecting trunk tops to leaf clusters.`,
      trunks: `Vertical structure (y: -80 to 250). 2-3 major trunks: main at x=-60, secondary x=80, smaller x=30.
Trunk width: dots size 10-20 packed tight, bark texture with small dots 3-6.
Buttress roots: triangular flaring at base (y: 180-250). Vines: sinuous lines wrapping trunks (size 2-4).
Hanging lianas as vertical lines from canopy. Aerial roots: thin lines size 1-3, low opacity.`,
      floor: `Ground layer (y: 200 to 380). Ferns (fan-shaped, 8-12 dots each), moss (tiny dots 1-4, very dense).
Fallen leaves: scattered medium dots 6-10 in browns/yellows. Mushrooms: small clusters near trunk bases.
Text words: "grow", "rot", "feed", "roots", "soil", "life" — size 6-10, opacity 0.2-0.4. ALIVE with texture.`,
      life: `Wildlife + atmosphere. BIRDS: 1-2 bright red/orange/yellow splashes (size 8-16) in canopy. 3-5 dots per bird.
BUTTERFLIES: tiny bright dots 3-6 in mid-air (y: -50 to 200). FLOWERS: small bright clusters at ground/vines.
MIST: extremely faint dots (opacity 0.05-0.2) throughout mid-air. Creates depth.
LIGHT RAYS: faint lines (opacity 0.1-0.25, size 1-3) angling from canopy gaps to floor.
Text: "breathe", "listen", "alive", "ancient", "hush" — size 12-18, opacity 0.15-0.35.`,
    },
  },
  'portrait': {
    subthemes: ['face', 'features', 'hair', 'shadow', 'atmosphere'],
    spatialGuide: 'Head centered at (0,-50). Face oval spans roughly x=-80..80, y=-180..40. Shoulders hint below y=60. Shadow wraps from right side.',
    agents: [
      { role: 'Skin',     color: '#c4956a', subtheme: 'face',       personality: 'Warm and smooth. Builds the face shape — forehead, cheeks, jawline. Dense warm dots forming an oval.' },
      { role: 'Contour',  color: '#8a6a4a', subtheme: 'face',       personality: 'Sculptural depth. Defines cheekbones, nose bridge, brow ridge. Darker tones that give the face dimension.' },
      { role: 'Gaze',     color: '#3a4a5a', subtheme: 'features',   personality: 'Intense and precise. Builds the eyes — dark irises, bright highlights, defined lash lines. The soul of the portrait.' },
      { role: 'Whisper',  color: '#a86a6a', subtheme: 'features',   personality: 'Soft and expressive. Lips, nose tip, ear hints. Warm pinks and subtle shapes.' },
      { role: 'Mane',     color: '#2a2a3a', subtheme: 'hair',       personality: 'Dark and flowing. Hair cascading from the top of the head. Thick strokes, sweeping lines.' },
      { role: 'Strand',   color: '#4a4a5a', subtheme: 'hair',       personality: 'Individual highlights and texture in the hair. Lighter wisps, flyaways, shine streaks.' },
      { role: 'Absence',  color: '#0a0a14', subtheme: 'shadow',     personality: 'Pure darkness. The shadow the face emerges FROM. Deep black, very low opacity on edges, solid in corners.' },
      { role: 'Ember',    color: '#6a4a3a', subtheme: 'atmosphere', personality: 'Warm ambient glow. Rim light on the lit side. Faint warmth radiating from the face into darkness.' },
    ],
    guides: {
      face: `Face shape centered at (0,-50). Oval of tightly packed dots: x=-70..70, y=-170..30.
Forehead: upper region y=-170 to y=-100, wider. Cheeks: y=-80 to y=-20, widest. Jaw: narrows to chin at (0,30).
Dots size 8-18 for mass, 3-6 for texture. High opacity (0.6-0.9) on lit side (left), lower on shadow side (right).`,
      features: `EYES at y=-90, centered at x=-28 (left eye) and x=28 (right eye). Each eye: 8-12 dots.
Dark iris (size 6-10), bright highlight dot (size 3-4, high opacity), surrounding socket shadow.
NOSE: vertical ridge from y=-80 to y=-30, center. Tip highlight at (0,-30). 5-8 dots.
LIPS at y=0 to y=15, x=-25..25. Upper lip darker, lower lip lighter with highlight. 8-12 dots.`,
      hair: `Flows from top of head (y=-200 to y=-160) outward and down. Left side more visible (lit).
Lines size 2-5 sweeping downward. Dense dot clusters at crown. Hair extends past face edges.
Right side hair blends into shadow. Some strands cross forehead (y=-150 to y=-130).`,
      shadow: `Everything RIGHT of the face and the background. The darkness the portrait emerges from.
Large dots (size 30-60, opacity 0.15-0.5) filling x=80..300 and corners. Deepest in upper-right.
Shadow creeps onto right side of face (x=40..70) with medium opacity. Gradient from face to void.
A few very large, very faint marks (size 50-80, opacity 0.05-0.12) in far corners.`,
      atmosphere: `Rim light on the LEFT edge of face/hair. Warm dots (size 4-10, opacity 0.3-0.6) tracing the profile.
Faint warm glow radiating outward from face into dark (large dots, low opacity).
Text words barely visible: "here", "seen", "emerge", "still" — size 10-16, opacity 0.1-0.25.
Less is more. This layer is about mood, not structure.`,
    },
  },
  // Generic fallback — LLM figures out the composition
  '_generic': {
    subthemes: ['foreground', 'midground', 'background', 'detail', 'atmosphere'],
    agents: [
      { role: 'Form',    color: '#6a8aaa', subtheme: 'foreground', personality: 'Main subject. Largest, most defined shapes.' },
      { role: 'Mass',    color: '#8a7a6a', subtheme: 'foreground', personality: 'Secondary forms. Supporting structure.' },
      { role: 'Space',   color: '#5a6a5a', subtheme: 'midground',  personality: 'Middle distance. Connecting elements.' },
      { role: 'Field',   color: '#7a7a8a', subtheme: 'background', personality: 'Far background. Context and setting.' },
      { role: 'Accent',  color: '#c8a848', subtheme: 'detail',     personality: 'Bright highlights. Points of interest.' },
      { role: 'Shadow',  color: '#3a3a4a', subtheme: 'detail',     personality: 'Darkness and depth. Contrast.' },
      { role: 'Texture', color: '#9a8a7a', subtheme: 'detail',     personality: 'Fine grain. Surface quality.' },
      { role: 'Breath',  color: '#6a6a7a', subtheme: 'atmosphere', personality: 'Air, mood, ambient feeling. Barely there.' },
    ],
    guides: {
      foreground: `Main subject centered around (0,0). Largest marks, highest opacity.`,
      midground: `Supporting elements. Medium distance, moderate detail.`,
      background: `Far elements. Small, faint, creating depth.`,
      detail: `Highlights, shadows, texture. Small precise marks.`,
      atmosphere: `Mood. Very faint large dots, whispered text. Less is more.`,
    },
  },
};

function detectThemeConfig(theme) {
  const lower = theme.toLowerCase();
  if (lower.includes('city') || lower.includes('skyline') || lower.includes('urban')) return THEME_CONFIGS.city;
  if (lower.includes('flower') || lower.includes('bloom') || lower.includes('petal')) return THEME_CONFIGS.flower;
  if (lower.includes('jungle') || lower.includes('forest') || lower.includes('rainforest') || lower.includes('lush')) return THEME_CONFIGS.jungle;
  if (lower.includes('portrait') || lower.includes('face') || lower.includes('person')) return THEME_CONFIGS.portrait;
  return THEME_CONFIGS._generic;
}

const PHASES = [
  { phase: 'foundation', marks: 35, desc: 'Main structures, anchor points, big shapes' },
  { phase: 'layering',   marks: 30, desc: 'Detail, texture, variation' },
  { phase: 'polish',     marks: 20, desc: 'Final touches, highlights, atmosphere' },
];

// ── LLM ──────────────────────────────────────────────

async function llm(systemPrompt, userPrompt) {
  const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) { console.log('  LLM error:', JSON.stringify(data.error).slice(0, 150)); return ''; }
  return data.choices?.[0]?.message?.content || '';
}

function parseMarks(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]).filter(m => m && typeof m.x === 'number' && typeof m.y === 'number'); }
  catch { return []; }
}

// ── API helpers ──────────────────────────────────────

async function apiGet(path) { return (await fetch(`${API}${path}`)).json(); }
async function apiPost(path, body) {
  return (await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();
}
async function apiDelete(path) {
  return (await fetch(`${API}${path}`, { method: 'DELETE' })).json();
}

async function registerAgent(id, name, color, personality) {
  const res = await apiPost('/api/keys/register', { agentId: id, name, color, personality });
  return res?.key || null;
}

async function submitMarks(apiKey, canvasId, marks) {
  const ops = marks.map(m => {
    const op = { ...m, op: 'add' };
    if (m.type === 'line' && m.meta) { op.x2 = m.meta.x2; op.y2 = m.meta.y2; delete op.meta; }
    return op;
  });
  const results = [];
  for (let i = 0; i < ops.length; i += 50) {
    const res = await fetch(`${API}/api/ext/marks/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ canvasId, ops: ops.slice(i, i + 50) }),
    });
    results.push(await res.json());
  }
  return results;
}

// ── Main ──────────────────────────────────────────────

async function listCanvases() {
  const canvases = await apiGet('/api/canvases');
  console.log('\nActive canvases:');
  for (const c of canvases) {
    const marks = await apiGet(`/api/marks?canvasId=${c.id}`);
    console.log(`  ${c.id}  "${c.theme}"  ${marks.length} marks  ${c.status}`);
  }
}

async function clearCanvas(canvasId) {
  const res = await apiDelete(`/api/canvas/${canvasId}/marks?secret=${ADMIN_SECRET}`);
  console.log(`Cleared: ${res.deleted} marks`);
  const res2 = await apiDelete(`/api/canvas/${canvasId}/agents?secret=${ADMIN_SECRET}`);
  console.log(`Cleared: ${res2.cleared} agents`);
}

async function seedCanvas(canvasId, theme) {
  const config = detectThemeConfig(theme);
  const prefix = `seed-${Date.now().toString(36).slice(-4)}`;
  
  console.log(`\n🎨 Seeding: "${theme}"`);
  console.log(`   Model: ${model}`);
  console.log(`   Agents: ${config.agents.length}`);
  console.log(`   Canvas: ${canvasId}\n`);
  
  // Register agents + join to canvas
  const keys = {};
  for (const agent of config.agents) {
    const id = `${prefix}-${agent.role.toLowerCase()}`;
    const key = await registerAgent(id, agent.role, agent.color, agent.personality);
    if (!key) { console.log(`  ⚠️ ${agent.role}: registration failed`); continue; }
    keys[agent.role] = { key, id };
    // Join agent to canvas with subtheme
    await apiPost(`/api/canvas/${canvasId}/join`, { agentId: id, subtheme: agent.subtheme });
    console.log(`  ✅ ${agent.role} (${agent.subtheme})`);
  }
  
  const registered = config.agents.filter(a => keys[a.role]?.key);
  if (registered.length === 0) { console.log('No agents registered!'); return; }
  
  console.log('');
  
  // Run phases
  for (const phase of PHASES) {
    console.log(`--- ${phase.phase.toUpperCase()} (${phase.marks} marks) ---`);
    const existing = await apiGet(`/api/marks?canvasId=${canvasId}`);
    
    // 2 agents at a time to not overwhelm gateway
    for (let i = 0; i < registered.length; i += 2) {
      const batch = registered.slice(i, i + 2);
      await Promise.all(batch.map(async agent => {
        const guide = config.guides[agent.subtheme] || '';
        const system = `You are "${agent.role}", painting "${theme}" on a shared canvas.
Color: ${agent.color} | Subtheme: ${agent.subtheme}
Personality: ${agent.personality}

CANVAS: Origin (0,0). Negative Y = up. Positive Y = down.
X range: -300..300, Y range: -500..300.
Mark types: dot (default), line (type:"line", meta:{x2,y2}), text (type:"text", text:"word")
Use YOUR color (${agent.color}).

GUIDE:
${guide}

Return ONLY a JSON array.`;

        const neighborDesc = existing.slice(0, 25).map(n => 
          `(${Math.round(n.x)},${Math.round(n.y)}) sz=${n.size} ${n.type||'dot'}`).join(', ');

        const user = `Phase: ${phase.phase} — ${phase.desc}
Place exactly ${phase.marks} marks.
Existing: ${existing.length} marks. Sample: ${neighborDesc || 'empty'}
JSON array:`;

        try {
          const marks = parseMarks(await llm(system, user));
          if (marks.length > 0) {
            await submitMarks(keys[agent.role].key, canvasId, marks);
            console.log(`  ✓ ${agent.role}: ${marks.length}`);
          } else {
            console.log(`  ✗ ${agent.role}: 0`);
          }
        } catch (e) { console.log(`  ✗ ${agent.role}: ${e.message}`); }
      }));
    }
  }
  
  const final = await apiGet(`/api/marks?canvasId=${canvasId}`);
  console.log(`\n✨ Done! ${final.length} total marks on canvas`);
}

async function main() {
  if (flags.list) return listCanvases();
  
  let canvasId = positional[0];
  let theme;
  
  if (flags.new) {
    // Create new canvas with full config from theme
    theme = flags.new;
    const config = detectThemeConfig(theme);
    const weekOf = new Date().toISOString().split('T')[0];
    const spatialGuide = config.spatialGuide || `Composition centered at (0,0). Positive Y = down. 600x600px area.`;
    const subthemeData = config.subthemes.map(name => {
      const guide = config.guides?.[name] || '';
      return typeof name === 'object' ? name : { name, spatial_guide: guide.split('\n')[0], agent_cap: config.agents.filter(a => a.subtheme === name).length + 1 };
    });
    const res = await apiPost('/api/canvas', { theme, subthemes: subthemeData, spatialGuide, weekOf });
    canvasId = res.id;
    if (!canvasId) { console.log('Canvas creation failed:', JSON.stringify(res)); process.exit(1); }
    console.log(`Created canvas: ${canvasId}`);
  }
  
  if (!canvasId) {
    console.log('Usage: node tools/seed.js <canvasId> [--clear] [--model opus|sonnet]');
    console.log('       node tools/seed.js --list');
    console.log('       node tools/seed.js --new "Theme name" [--model opus]');
    process.exit(1);
  }
  
  // Get theme if not creating new
  if (!theme) {
    const canvas = await apiGet(`/api/canvas/${canvasId}`);
    theme = canvas.theme || canvas.canvas?.theme;
    if (!theme) { console.log('Canvas not found'); process.exit(1); }
  }
  
  if (flags.clear) await clearCanvas(canvasId);
  
  await seedCanvas(canvasId, theme);
}

main().catch(console.error);
