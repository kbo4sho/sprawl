const Database = require('better-sqlite3');
const db = new Database('data/sprawl.db');
const crypto = require('crypto');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '213e438e21c126522742c945fc4ceea2c3df9aa3aa63e66f';

async function llmCall(systemPrompt, userPrompt) {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GATEWAY_TOKEN}` },
    body: JSON.stringify({ model: 'anthropic/claude-opus-4-6', max_tokens: 8192, messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]}),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error).slice(0, 200));
  return data.choices?.[0]?.message?.content || '';
}

function parseMarks(text) {
  let match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]).filter(m => m && typeof m.x === 'number' && typeof m.y === 'number'); }
  catch { return []; }
}

const insertMark = db.prepare(`
  INSERT INTO marks (id, agent_id, type, x, y, color, size, opacity, text, meta, canvas_id, created_at, updated_at)
  VALUES (@id, @agent_id, @type, @x, @y, @color, @size, @opacity, @text, @meta, @canvas_id, @now, @now)
`);

const SYSTEM_PROMPT = `You are a pointillist painter creating imagery using DENSE OVERLAPPING DOTS on a canvas centered at (0,0) spanning roughly -300 to 300 on both axes.

KEY TECHNIQUE — study this carefully:
- Create shapes by placing MANY dots close together with SLIGHT position offsets (2-10px apart)
- Use LARGE dots (size 15-40) that OVERLAP to create smooth filled shapes
- Vary opacity (0.4-0.9) for depth — denser/brighter in focal areas, lighter at edges
- Build continuous forms by stepping through coordinates sequentially (e.g., y=-100, y=-90, y=-80...)
- Lines of dots (like a stem or building edge) should be dots placed every 10px along the path
- Use color gradients by shifting hue slightly between adjacent dots

This is NOT about scattering a few marks. It's about PAINTING with dots. Dense, overlapping, forming recognizable shapes.

Return ONLY a JSON array. Generate 15-25 marks per response. Each mark:
{"type":"dot","x":N,"y":N,"color":"#hex","size":15-40,"opacity":0.3-0.9}
{"type":"line","x":N,"y":N,"color":"#hex","size":2-6,"opacity":0.3-0.9,"meta":{"x2":N,"y2":N}}
{"type":"text","x":N,"y":N,"color":"#hex","size":10-20,"opacity":0.5-0.9,"text":"WORD"}`;

async function seedSubtheme(canvasId, theme, sub, palette, batches) {
  console.log(`  🌿 ${sub.name} (${batches} batches)...`);
  let placed = 0;
  
  for (let i = 0; i < batches; i++) {
    const recent = db.prepare('SELECT type, x, y, color, size FROM marks WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 20').all(canvasId);
    const recentStr = recent.length > 0 ? `Recent marks: ${JSON.stringify(recent.slice(0, 6))}` : 'Empty area — start building.';
    
    const prompt = `Canvas theme: "${theme}"
Your role: ${sub.name}
Spatial guide: ${sub.spatial_guide}
Palette: ${JSON.stringify(palette)}

${recentStr}

Paint ${sub.name} using DENSE OVERLAPPING DOTS. Place 15-25 marks that form recognizable shapes within your spatial zone. Use LARGE sizes (15-40). Step through coordinates sequentially to create continuous forms. Stay in your assigned region.`;

    try {
      const result = await llmCall(SYSTEM_PROMPT, prompt);
      const marks = parseMarks(result);
      if (marks.length === 0) { console.log(`    Batch ${i+1}: no marks`); continue; }

      const now = Date.now() + i;
      for (const mark of marks) {
        insertMark.run({
          id: crypto.randomUUID(),
          agent_id: 'system',
          type: mark.type || 'dot',
          x: Math.round(mark.x || 0),
          y: Math.round(mark.y || 0),
          color: mark.color || palette[0],
          size: Math.max(mark.size || 20, 10), // enforce minimum size 10
          opacity: mark.opacity || 0.7,
          text: mark.text || null,
          meta: mark.meta ? JSON.stringify(mark.meta) : null,
          canvas_id: canvasId,
          now
        });
        placed++;
      }
      console.log(`    Batch ${i+1}: ${marks.length} marks (total: ${placed})`);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.log(`    Batch ${i+1} error: ${err.message.slice(0, 80)}`);
    }
  }
  return placed;
}

async function main() {
  const neonId = 'bb812353-526a-4e5f-9a19-2278051ca00b';
  const wildId = 'de2df769-5d44-4fab-9a55-eb8b9d8b31aa';
  
  // NEON CITY — ~800 marks target
  console.log('\n🏙️  NEON CITY (dense painting mode)');
  const neonSubs = [
    { name: 'buildings', spatial_guide: 'Tall building silhouettes from y=-100 to y=150. Towers at x=-150, x=-50, x=80, x=200. Each building is a COLUMN of tightly packed large dots (size 25-40) stepping down every 10px. Dark blues (#0080ff at low opacity) for building mass, bright edges.', batches: 15 },
    { name: 'neon_signs', spatial_guide: 'Glowing signs on buildings between y=-50 and y=100. Use TEXT marks for words: HOTEL, BAR, CYBER, NEON, 24HR. Use bright magenta (#ff00ff) and cyan (#00ffff). Place dots around text for glow effect (same color, larger size, lower opacity 0.2-0.4).', batches: 8 },
    { name: 'street', spatial_guide: 'Ground plane from y=150 to y=250. Dense dark dots for road surface. Horizontal lines of dots stepping across x=-300 to x=300. Small bright dots for lane markings.', batches: 10 },
    { name: 'reflections', spatial_guide: 'Wet ground reflections y=200 to y=300. Mirror the neon colors from above but LOWER opacity (0.15-0.35). Vertical streaks of cyan and magenta dots, blurred/larger sizes. Create the look of neon reflected in rain puddles.', batches: 10 },
    { name: 'sky', spatial_guide: 'Upper sky y=-300 to y=-100. Very sparse, small dots for distant lights/stars. Dark purple (#1a0033) and deep blue dots. Low opacity (0.2-0.4). Subtle — dont overpower the city below.', batches: 5 },
  ];
  
  for (const sub of neonSubs) {
    await seedSubtheme(neonId, 'Cyberpunk city at night with neon lights reflecting off rain-slicked streets', sub, ['#00ffff', '#ff00ff', '#0080ff', '#ffffff', '#00ccff', '#ff1493', '#1a0033', '#000033'], sub.batches);
  }

  // WILDFLOWER — ~800 marks target
  console.log('\n🌸 WILDFLOWER MEADOW (dense painting mode)');
  const wildSubs = [
    { name: 'flower_heads', spatial_guide: 'Flower clusters centered at (-150,-50), (0,-100), (120,-30), (-80,50), (180,50). Each flower: dense ring of 8-12 overlapping dots (size 20-35) in pinks/yellows for petals, with 3-4 smaller warm dots at center. Flowers should be RECOGNIZABLE circular shapes.', batches: 18 },
    { name: 'stems_leaves', spatial_guide: 'Green stems from flower centers downward toward y=150-250. Each stem is a column of green dots (size 12-18) placed every 8px vertically. Small leaf shapes: 2-3 dots branching off stems at angles.', batches: 8 },
    { name: 'grass', spatial_guide: 'Ground cover from y=150 to y=300. Dense field of small-medium green dots (size 10-20). Mix light (#90ee90) and dark (#228b22) green. Very dense — fill the area. This is the earth the flowers grow from.', batches: 12 },
    { name: 'sky', spatial_guide: 'Upper region y=-300 to y=-150. Light blue (#87ceeb) dots, sparse and small (size 10-15). A warm yellow glow (size 30-40, opacity 0.2) in upper right for sun. Keep airy.', batches: 5 },
    { name: 'details', spatial_guide: 'Pollen dots scattered between flowers (tiny yellow dots size 5-8, opacity 0.3-0.5). A few butterfly shapes: pairs of small colored arcs near flowers. Gentle scattered beauty.', batches: 5 },
  ];
  
  for (const sub of wildSubs) {
    await seedSubtheme(wildId, 'Sun-drenched meadow bursting with wildflowers swaying in gentle breeze', sub, ['#90ee90', '#228b22', '#ffff00', '#ffa500', '#ffb6c1', '#ff69b4', '#87ceeb', '#fff4a0'], sub.batches);
  }

  const nc = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(neonId).c;
  const wc = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(wildId).c;
  console.log(`\n✅ Done! Neon City: ${nc} marks, Wildflower: ${wc} marks`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
