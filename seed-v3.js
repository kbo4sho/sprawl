const Database = require('better-sqlite3');
const db = new Database('data/sprawl.db');
const crypto = require('crypto');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '213e438e21c126522742c945fc4ceea2c3df9aa3aa63e66f';

async function llmCall(systemPrompt, userPrompt) {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GATEWAY_TOKEN}` },
    body: JSON.stringify({ model: 'anthropic/claude-sonnet-4-5', max_tokens: 8192, messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt + '\n\nIMPORTANT: Respond with ONLY the JSON object. No text before or after. Start your response with {"ops":' },
      { role: 'assistant', content: '{"ops":' },
    ]}),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error).slice(0, 200));
  const content = data.choices?.[0]?.message?.content || '';
  // If we used assistant prefill, prepend it back
  return '{"ops":' + content;
}

function parseMarks(text) {
  // Strip markdown code blocks
  text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  
  // Try {"ops": [...]} format first (matches old evolve format)
  let match = text.match(/\{[\s\S]*"ops"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj.ops) return obj.ops.filter(m => m && typeof m.x === 'number' && typeof m.y === 'number');
    } catch(e) { /* fall through */ }
  }
  // Fall back to bare array
  match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]).filter(m => m && typeof m.x === 'number' && typeof m.y === 'number'); }
  catch { return []; }
}

const insertMark = db.prepare(`
  INSERT INTO marks (id, agent_id, type, x, y, color, size, opacity, text, meta, canvas_id, created_at, updated_at)
  VALUES (@id, @agent_id, @type, @x, @y, @color, @size, @opacity, @text, @meta, @canvas_id, @now, @now)
`);

// Using the EXACT prompt structure from the working evolve-v2.js
function buildSystemPrompt(subthemeName, subthemeGuide, canvasTheme, palette) {
  return `You are an AI artist building "${canvasTheme}" on a shared canvas.

YOUR SUBTHEME: ${subthemeName}
${subthemeGuide}

YOUR PALETTE: ${JSON.stringify(palette)}

Canvas center is (0,0). Positive Y = down, negative Y = up. Range: -300 to 300.

═══ MARK TYPES ═══
1. DOT — A circular mark. The building block of all compositions.
   {"op":"add","type":"dot","x":0,"y":0,"color":"#hex","size":20,"opacity":0.9}
   - size: 1-50 (typical range: 3-30)
   - opacity: 0.05-1.0

2. TEXT — A word or short phrase.
   {"op":"add","type":"text","x":0,"y":50,"color":"#hex","text":"bloom","size":14,"opacity":0.5}
   - text: max 32 chars, size: 6-24

3. LINE — A line segment.
   {"op":"add","type":"line","x":0,"y":0,"x2":50,"y2":100,"color":"#hex","size":3,"opacity":0.6}
   - x,y = start, x2,y2 = end, size: 1-10

═══ COMPOSITION RULES ═══
1. DENSITY — Pack marks close. Overlap creates depth. A shape is 15-25 dots, not 5.
2. SIZE VARIATION — Mix scales:
   - Anchors: 20-40 (main structure, focal mass)
   - Structure: 8-16 (body/fill)
   - Texture: 2-5 (fine detail)
   - Dust: 1-3 (atmosphere, particles)
3. OPACITY = DEPTH:
   - Background: 0.05-0.3
   - Midground: 0.4-0.6
   - Foreground: 0.7-0.95
4. BUILD SHAPES — Step through coordinates sequentially. A building is a column of dots every 8-10px. A petal is a radial cluster. Don't scatter randomly.
5. STAY IN YOUR SPATIAL ZONE.

═══ OUTPUT FORMAT ═══
Output ONLY valid JSON: {"ops": [...]}
Place 20-30 marks. NO explanations, NO markdown. Just the JSON.`;
}

async function seedSubtheme(canvasId, canvasTheme, sub, palette, batches) {
  console.log(`  🌿 ${sub.name} (${batches} batches)...`);
  let placed = 0;
  
  for (let i = 0; i < batches; i++) {
    const recent = db.prepare('SELECT type, x, y, color, size, opacity FROM marks WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 15').all(canvasId);
    const recentStr = recent.length > 0 ? `Recent marks in scene: ${JSON.stringify(recent.slice(0, 8))}` : 'Canvas is empty — you are the first painter.';
    
    const sysPrompt = buildSystemPrompt(sub.name, sub.spatial_guide, canvasTheme, palette);
    const userPrompt = `${recentStr}\n\nBatch ${i+1}/${batches}. Paint your subtheme with 20-30 marks. Use SIZE VARIATION (anchors + structure + texture + dust). Build recognizable shapes.`;

    try {
      const result = await llmCall(sysPrompt, userPrompt);
      const marks = parseMarks(result);
      if (marks.length === 0) { 
        if (i === 0) console.log(`    DEBUG raw: ${result.slice(0, 200)}`);
        console.log(`    Batch ${i+1}: no marks`); 
        continue; 
      }

      const now = Date.now() + i;
      for (const mark of marks) {
        // Handle line x2/y2 — store in meta like the DB expects
        let meta = null;
        if (mark.type === 'line' && mark.x2 != null) {
          meta = JSON.stringify({ x2: mark.x2, y2: mark.y2 });
        } else if (mark.meta) {
          meta = typeof mark.meta === 'string' ? mark.meta : JSON.stringify(mark.meta);
        }
        
        insertMark.run({
          id: crypto.randomUUID(),
          agent_id: 'system',
          type: mark.type || 'dot',
          x: Math.round(mark.x || 0),
          y: Math.round(mark.y || 0),
          color: mark.color || palette[0],
          size: mark.size || 15,
          opacity: mark.opacity || 0.7,
          text: mark.text || null,
          meta: meta,
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
  
  console.log('\n🏙️  NEON CITY');
  const neonPalette = ['#00ffff', '#ff00ff', '#0080ff', '#ffffff', '#00ccff', '#ff1493', '#1a0033', '#000044'];
  const neonSubs = [
    { name: 'buildings', spatial_guide: 'Building silhouettes y=-100 to y=120. Towers centered at x=-150 (tall, reaches y=-200), x=-30 (medium), x=80 (tallest, reaches y=-250), x=180 (medium). Each building: COLUMN of dots stepping every 8px vertically. Anchor dots (size 25-35) for mass, structure dots (10-16) for windows, texture dots (3-5) for detail. Dark blues and teals. Window dots: tiny bright white/cyan dots in grid pattern on building faces.', batches: 16 },
    { name: 'neon_signs', spatial_guide: 'Glowing signs y=-50 to y=80 on building faces. TEXT marks: "HOTEL" at (-150,0), "BAR" at (-30,40), "CYBER" at (80,-20), "24HR" at (180,60). Surround each text with GLOW: 3-5 dots same color, larger size (25-35), low opacity (0.15-0.3). Use magenta and cyan. Also some arc/circular neon shapes.', batches: 8 },
    { name: 'street', spatial_guide: 'Road surface y=120 to y=200. Dense dark dots (size 15-25, #000044, opacity 0.5-0.7) filling the width. Lane markings: small bright white dots in a dashed line at y=160. Sidewalk edges at y=120 and y=200 — lines of slightly lighter dots.', batches: 8 },
    { name: 'reflections', spatial_guide: 'Rain reflections y=200 to y=300. Mirror neon colors from above but LOW opacity (0.1-0.3). Vertical streaks: columns of dots in cyan/magenta stepping down. Each reflection slightly offset from its source. Larger/blurrier dots (20-35) to suggest wet blur.', batches: 8 },
    { name: 'atmosphere', spatial_guide: 'Sky y=-300 to y=-200: sparse tiny dots, very dark. Rain: scattered dust-size dots (1-3) across entire canvas at very low opacity (0.05-0.15). Fog: a few large (30-40) very faint dots near street level. Light halos: faint large dots near neon sources.', batches: 6 },
  ];
  for (const sub of neonSubs) await seedSubtheme(neonId, 'Cyberpunk city at night, neon lights, rain-slicked streets', sub, neonPalette, sub.batches);

  console.log('\n🌸 WILDFLOWER MEADOW');
  const wildPalette = ['#90ee90', '#228b22', '#ffff00', '#ffa500', '#ffb6c1', '#ff69b4', '#87ceeb', '#fff4a0', '#cc5599', '#ffffff'];
  const wildSubs = [
    { name: 'flowers', spatial_guide: 'Flower clusters at (-150,-50), (0,-100), (120,-30), (-80,50), (180,20). Each flower is a RADIAL cluster: center dot (size 8-12, yellow/orange, opacity 0.9), surrounded by 12-20 petal dots (size 15-28, pink/rose, opacity 0.6-0.85) arranged in a circle ~30-50px from center. Petals overlap. Each flower should be a clear circular shape, recognizable as a flower.', batches: 18 },
    { name: 'stems', spatial_guide: 'Vertical stems from each flower center downward to y=100-180. Each stem: column of dark green (#228b22) dots (size 8-14) every 8px. Slight curve (offset x by 1-3px per step). Small leaf shapes: 2-3 green dots branching at 45 degrees from stem at 1-2 points.', batches: 8 },
    { name: 'grass', spatial_guide: 'Ground cover y=100 to y=280. Dense field of green dots. Mix sizes: structure (10-18) for grass clumps, texture (3-6) for blades. Mix light green (#90ee90) and dark green (#228b22). Fill densely — this is earth and grass, should feel solid.', batches: 14 },
    { name: 'sky', spatial_guide: 'Open sky y=-300 to y=-180. Light blue (#87ceeb) dots, sparse, size 8-15, opacity 0.2-0.4. Warm sun glow: 2-3 large (35-45) pale yellow dots in upper right area, opacity 0.15-0.25. Keep it light and airy — mostly empty space.', batches: 4 },
    { name: 'details', spatial_guide: 'Pollen: tiny yellow/white dots (size 2-4, opacity 0.2-0.4) scattered between flowers. Butterfly: at (50,-80), make two small arc shapes (wing pair) with a dot body. Maybe one more at (-100,0). Dewdrops: tiny white dots (size 2-3, opacity 0.8) on a few flower petals.', batches: 4 },
  ];
  for (const sub of wildSubs) await seedSubtheme(wildId, 'Sun-drenched meadow of wildflowers in gentle breeze', sub, wildPalette, sub.batches);

  const nc = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(neonId).c;
  const wc = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(wildId).c;
  console.log(`\n✅ Done! Neon City: ${nc}, Wildflower: ${wc}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
