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

async function seedCanvas(canvasId, theme, subject, palette, allowedTypes, batchCount) {
  console.log(`\n🎨 Seeding ${subject} (${batchCount} batches of 5 marks)...`);
  
  for (let i = 0; i < batchCount; i++) {
    const existingMarks = db.prepare('SELECT type, x, y, color, size FROM marks WHERE canvas_id = ? ORDER BY created_at DESC LIMIT 50').all(canvasId);
    const existingDesc = existingMarks.length > 0 
      ? `Existing marks: ${JSON.stringify(existingMarks.slice(0, 10))}` 
      : 'Canvas is empty - start building the composition.';
    
    const prompt = `You are composing a visual artwork on a 600x600 canvas. Theme: "${theme}". Subject: ${subject}.

${existingDesc}

Place 5 new primitives that build on what exists. Use ONLY these colors: ${JSON.stringify(palette)}. 
Use ONLY these types: ${JSON.stringify(allowedTypes)}.

Return a JSON array of marks. Each mark:
- dot: {"type":"dot","x":0-600,"y":0-600,"color":"#hex","size":2-18,"opacity":0.3-1.0}
- line: {"type":"line","x":start_x,"y":start_y,"x2":end_x,"y2":end_y,"color":"#hex","size":1-6,"opacity":0.3-1.0}
- text: {"type":"text","x":0-600,"y":0-600,"color":"#hex","size":8-24,"opacity":0.3-1.0,"text":"word"}
- arc: {"type":"arc","x":center_x,"y":center_y,"color":"#hex","size":2-8,"opacity":0.3-1.0,"meta":{"radius":10-60,"startAngle":0-360,"endAngle":0-360}}

Think about composition — build recognizable shapes, cluster related marks, create depth with opacity. Return ONLY the JSON array.`;

    try {
      const result = await llmCall('You are a visual artist placing primitives.', prompt);
      const marks = parseMarks(result);
      
      if (marks.length === 0) {
        console.log(`  Batch ${i+1}: no marks parsed, retrying...`);
        continue;
      }

      const now = Date.now();
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
      
      console.log(`  Batch ${i+1}: placed ${marks.length} marks`);
      
      // Small delay between batches
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(`  Batch ${i+1} error: ${err.message.slice(0, 100)}`);
    }
  }
  
  const total = db.prepare('SELECT COUNT(*) as c FROM marks WHERE canvas_id = ?').get(canvasId).c;
  console.log(`  ✅ Total marks on ${subject}: ${total}`);
}

async function main() {
  // Neon City - 40 batches × 5 = ~200 marks
  await seedCanvas(
    'bb812353-526a-4e5f-9a19-2278051ca00b',
    'A cyberpunk cityscape at night, glowing with neon lights reflecting off rain-slicked streets',
    'urban nightscape',
    ['#00ffff', '#ff00ff', '#0080ff', '#ffffff', '#00ccff', '#ff1493'],
    ['dot', 'line', 'text', 'arc'],
    40
  );

  // Wildflower - 40 batches × 5 = ~200 marks
  await seedCanvas(
    'de2df769-5d44-4fab-9a55-eb8b9d8b31aa',
    'A sun-drenched meadow bursting with wildflowers swaying in a gentle breeze',
    'wildflower meadow',
    ['#90ee90', '#228b22', '#ffff00', '#ffa500', '#ffb6c1', '#ff69b4', '#87ceeb'],
    ['dot', 'arc'],
    40
  );

  console.log('\n🎉 Done seeding both canvases!');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
