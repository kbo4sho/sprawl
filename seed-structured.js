const Database = require('better-sqlite3');
const db = new Database('data/sprawl.db');
const crypto = require('crypto');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '213e438e21c126522742c945fc4ceea2c3df9aa3aa63e66f';

async function llmCall(systemPrompt, userPrompt, model = 'anthropic/claude-opus-4-6') {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GATEWAY_TOKEN}` },
    body: JSON.stringify({ model, max_tokens: 4096, messages: [
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

async function seedSubtheme(canvasId, theme, subtheme, palette, allowedTypes, batchCount) {
  console.log(`  🌿 ${subtheme.name} (${batchCount} batches)...`);
  
  for (let i = 0; i < batchCount; i++) {
    const existingMarks = db.prepare('SELECT type, x, y, color, size, text FROM marks WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 30').all(canvasId);
    const existingDesc = existingMarks.length > 0 
      ? `Existing marks nearby: ${JSON.stringify(existingMarks.slice(0, 8))}` 
      : 'Canvas is empty in this area.';
    
    const prompt = `You are placing primitives on a 600x600 canvas to create: "${theme}"

YOUR ROLE: ${subtheme.name}
YOUR SPATIAL GUIDE: ${subtheme.spatial_guide}

${existingDesc}

RULES:
- ONLY use colors from: ${JSON.stringify(palette)}
- ONLY use types from: ${JSON.stringify(allowedTypes)}
- Stay STRICTLY within your spatial guide coordinates
- Place 5-8 marks that form recognizable shapes
- For lines: include x, y (start) and meta: {x2, y2} (end point)
- For arcs: include meta: {radius, startAngle (radians), endAngle (radians)}
- For text: include a "text" field with 1-2 words max
- Think about what ${subtheme.name} looks like and use primitives to represent it

Return ONLY a JSON array of marks:
- dot: {"type":"dot","x":N,"y":N,"color":"#hex","size":2-18,"opacity":0.3-1.0}
- line: {"type":"line","x":N,"y":N,"color":"#hex","size":1-6,"opacity":0.3-1.0,"meta":{"x2":N,"y2":N}}
- text: {"type":"text","x":N,"y":N,"color":"#hex","size":8-20,"opacity":0.5-1.0,"text":"WORD"}
- arc: {"type":"arc","x":N,"y":N,"color":"#hex","size":2-6,"opacity":0.3-1.0,"meta":{"radius":10-60,"startAngle":0,"endAngle":3.14}}`;

    try {
      const result = await llmCall('You are a visual artist carefully placing primitives to create recognizable imagery. Follow the spatial guide precisely.', prompt);
      const marks = parseMarks(result);
      
      if (marks.length === 0) {
        console.log(`    Batch ${i+1}: no marks parsed`);
        continue;
      }

      const now = Date.now() + i; // slight offset for ordering
      for (const mark of marks) {
        insertMark.run({
          id: crypto.randomUUID(),
          agent_id: 'system',
          type: mark.type || 'dot',
          x: Math.round(mark.x || 0),
          y: Math.round(mark.y || 0),
          color: mark.color || palette[0],
          size: mark.size || 5,
          opacity: mark.opacity || 0.8,
          text: mark.text || null,
          meta: mark.meta ? JSON.stringify(mark.meta) : null,
          canvas_id: canvasId,
          now
        });
      }
      
      console.log(`    Batch ${i+1}: ${marks.length} marks`);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.log(`    Batch ${i+1} error: ${err.message.slice(0, 80)}`);
    }
  }
}

async function main() {
  const neonId = 'bb812353-526a-4e5f-9a19-2278051ca00b';
  const wildId = 'de2df769-5d44-4fab-9a55-eb8b9d8b31aa';
  
  const neon = db.prepare('SELECT * FROM canvases WHERE id = ?').get(neonId);
  const wild = db.prepare('SELECT * FROM canvases WHERE id = ?').get(wildId);
  
  const neonSubs = JSON.parse(neon.subthemes);
  const wildSubs = JSON.parse(wild.subthemes);
  
  const neonPalette = ['#00ffff', '#ff00ff', '#0080ff', '#ffffff', '#00ccff', '#ff1493'];
  const wildPalette = ['#90ee90', '#228b22', '#ffff00', '#ffa500', '#ffb6c1', '#ff69b4', '#87ceeb'];
  
  // Neon City — structured seeding
  console.log('\n🏙️  NEON CITY');
  for (const sub of neonSubs) {
    const batches = sub.name === 'skyline' ? 12 : sub.name === 'street' ? 8 : sub.name === 'neon_signs' ? 8 : 6;
    await seedSubtheme(neonId, neon.theme, sub, neonPalette, ['dot', 'line', 'text', 'arc'], batches);
  }
  
  // Wildflower — structured seeding
  console.log('\n🌸 WILDFLOWER MEADOW');
  for (const sub of wildSubs) {
    const batches = sub.name === 'flowers' ? 12 : sub.name === 'grass' ? 10 : sub.name === 'stems' ? 6 : 4;
    await seedSubtheme(wildId, wild.theme, sub, wildPalette, ['dot', 'arc'], batches);
  }
  
  const neonCount = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(neonId).c;
  const wildCount = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(wildId).c;
  console.log(`\n✅ Done! Neon City: ${neonCount} marks, Wildflower: ${wildCount} marks`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
