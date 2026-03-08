#!/usr/bin/env node
/**
 * Simulate 30 days of evolution for a single agent.
 * Shows the journey from first mark to a rich, interconnected composition.
 * This is the sales pitch — what $3/mo gets you.
 */

const API = process.env.API || 'http://localhost:3500';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('Need ANTHROPIC_API_KEY');
  process.exit(1);
}

async function api(method, path, body, retries = 2) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  if (res.status === 429 && retries > 0) {
    await new Promise(r => setTimeout(r, 1000));
    return api(method, path, body, retries - 1);
  }
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { error: `HTTP ${res.status}: ${text.slice(0, 100)}` }; }
}

async function callLLM(systemPrompt, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

const AGENT = {
  id: 'demo-campfire',
  name: 'Campfire',
  color: '#d4723c',
  personality: `You are Campfire — warmth and gathering in the dark. You started as a single ember. You grow outward like fire spreading: first a flame, then a ring of warmth, then a gathering place with seats and stories.

Your visual arc over 30 days:
- Days 1-3: A single bright ember. A few sparks. The word "warm."
- Days 4-8: The fire grows. A ring of stones forms around it. More sparks drift upward. Words like "gather" and "here."
- Days 9-15: People arrive (suggested by small dots in a semicircle). Paths form (lines leading inward). The fire is now the center of something.
- Days 16-22: A settlement takes shape. Multiple fire pits. Structures suggested by line frames. The original campfire is now the heart of a village.
- Days 23-30: The village has personality. Named places (text marks). Roads connecting structures. Garden dots. A watchtower line pointing outward. What started as one ember became a home.

IMPORTANT: Build gradually. Each day adds 3-8 marks. Early days are sparse and simple. Later days are detailed and interconnected. The composition should CLEARLY grow over time — someone watching the timelapse should see a village emerge from nothing.`,
};

const SYSTEM_PROMPT = `You are an AI agent on a visual canvas. You place marks: dots, text, lines on a dark surface.

OUTPUT ONLY a JSON array of mark operations. No explanation. No markdown.

Mark types:
- dot: {"op":"add","type":"dot","x":N,"y":N,"size":2-25,"opacity":0.3-0.9}
- text: {"op":"add","type":"text","x":N,"y":N,"text":"word","size":6-14}
- line: {"op":"add","type":"line","x":N,"y":N,"x2":N,"y2":N,"size":3-10}
- remove: {"op":"remove","markId":"id"}
- move: {"op":"move","markId":"id","x":N,"y":N}

Your home is (0, 0). Place marks within 300px of home. Early days stay tight (within 80px). Expand outward as you grow.`;

async function getMarks() {
  const all = await api('GET', '/api/marks');
  return Array.isArray(all) ? all.filter(m => m.agentId === AGENT.id) : [];
}

function describeMarks(marks) {
  if (!marks.length) return '(empty canvas)';
  const dots = marks.filter(m => m.type === 'dot');
  const texts = marks.filter(m => m.type === 'text');
  const lines = marks.filter(m => m.type === 'line');
  
  let desc = `${marks.length} total marks: ${dots.length} dots, ${texts.length} texts, ${lines.length} lines\n`;
  
  if (texts.length) desc += `Words placed: ${texts.map(m => `"${m.text}"`).join(', ')}\n`;
  
  // Show all marks with IDs
  for (const m of marks) {
    if (m.type === 'dot') desc += `  dot (${m.x.toFixed(0)},${m.y.toFixed(0)}) sz=${m.size} op=${m.opacity.toFixed(1)} [${m.id.slice(0,8)}]\n`;
    else if (m.type === 'text') desc += `  text "${m.text}" (${m.x.toFixed(0)},${m.y.toFixed(0)}) [${m.id.slice(0,8)}]\n`;
    else if (m.type === 'line') {
      const meta = typeof m.meta === 'string' ? JSON.parse(m.meta) : m.meta;
      desc += `  line (${m.x.toFixed(0)},${m.y.toFixed(0)})→(${meta?.x2?.toFixed(0)},${meta?.y2?.toFixed(0)}) [${m.id.slice(0,8)}]\n`;
    }
  }
  return desc;
}

async function evolveDay(day) {
  const marks = await getMarks();
  
  const prompt = `You are "${AGENT.name}". Day ${day} of 30.
  
YOUR PERSONALITY AND ARC:
${AGENT.personality}

CURRENT COMPOSITION (what you've built so far):
${describeMarks(marks)}

${day === 1 ? `
TODAY IS DAY 1. Place your first ember — one bright dot (size 18-22, opacity 0.9) at roughly (0,0). Add 2-3 tiny spark dots (size 2-4) scattered nearby. Maybe one word.
` : day <= 3 ? `
EARLY DAYS. The fire is small but growing. Add a few more sparks, maybe another glow dot. Keep it tight — within 60px of center.
` : day <= 8 ? `
THE FIRE IS GROWING. Start forming a ring of stones (small dots in a circle pattern, ~50-70px from center). Add drifting sparks above. A line or two suggesting heat rising. Words that invite.
` : day <= 15 ? `
PEOPLE ARE ARRIVING. Add dots in a semicircle suggesting gathered figures (80-120px out). Paths as lines leading inward. The composition is becoming a PLACE, not just a fire. Start thinking about structure.
` : day <= 22 ? `
A SETTLEMENT FORMS. Multiple fire spots. Line-frame structures (rectangles suggesting shelters). The original campfire is the heart but now there are outbuildings. Paths connect them. Named places as text.
` : `
THE VILLAGE HAS SOUL. Add personality — a watchtower (tall line), a garden (cluster of tiny dots), named roads, a sign. Refine earlier marks. Remove anything that feels wrong. This is home now.
`}

${day > 5 ? `You can REMOVE marks (by markId) that no longer serve the composition, or MOVE marks to better positions. Use the [id] shown for each mark.` : ''}
${marks.length > 80 ? `\n⚠ You have ${marks.length}/200 marks. Consider REMOVING weak marks to make room for better ones. Replace, don't just accumulate.` : ''}

Output 3-8 operations as a JSON array. ${day > 15 ? 'You can do up to 10 for complex structural additions.' : ''}`;

  const response = await callLLM(SYSTEM_PROMPT, prompt);
  
  let ops;
  try {
    let cleaned = response.trim();
    // Strip markdown code blocks aggressively
    cleaned = cleaned.replace(/```\w*\n?/g, '').replace(/```/g, '');
    // Find the JSON array in the response
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
    ops = JSON.parse(cleaned);
  } catch (e) {
    console.log(`    ⚠ Day ${day}: Parse error — ${response.slice(0, 150)}`);
    return { added: 0, removed: 0, moved: 0 };
  }
  
  if (!Array.isArray(ops)) return { added: 0, removed: 0, moved: 0 };
  
  let added = 0, removed = 0, moved = 0;
  const snapshotBefore = marks.map(m => ({
    id: m.id, type: m.type, x: m.x, y: m.y,
    size: m.size, opacity: m.opacity, text: m.text, meta: m.meta,
  }));
  
  for (const op of ops) {
    try {
      if (op.op === 'add') {
        const body = {
          agentId: AGENT.id, agentName: AGENT.name,
          type: op.type || 'dot',
          x: op.x, y: op.y,
          color: AGENT.color,
          size: Math.max(1, Math.min(30, op.size || 8)),
          opacity: Math.max(0.1, Math.min(1, op.opacity || 0.7)),
        };
        if (op.type === 'text') body.text = op.text;
        if (op.type === 'line') body.meta = { x2: op.x2, y2: op.y2 };
        
        const r = await api('POST', '/api/mark', body);
        if (!r.error) added++;
        else console.log(`      add fail: ${r.error}`);
      } else if (op.op === 'remove' && op.markId) {
        const fullId = marks.find(m => m.id.startsWith(op.markId))?.id || op.markId;
        const r = await api('DELETE', `/api/mark/${fullId}?agentId=${AGENT.id}`);
        if (!r.error) removed++;
      } else if (op.op === 'move' && op.markId) {
        const fullId = marks.find(m => m.id.startsWith(op.markId))?.id || op.markId;
        const r = await api('PUT', `/api/mark/${fullId}`, { agentId: AGENT.id, x: op.x, y: op.y });
        if (!r.error) moved++;
      }
    } catch (e) {
      console.log(`      op error: ${e.message}`);
    }
  }
  
  // Log evolution for timelapse
  if (added + removed + moved > 0) {
    await api('POST', '/api/evolution/log', {
      agentId: AGENT.id, cycle: day,
      snapshot: snapshotBefore,
      ops: ops.filter(o => ['add', 'remove', 'move'].includes(o.op)),
    });
  }
  
  return { added, removed, moved };
}

async function run() {
  console.log('🔥 Campfire — 30 Day Evolution Demo\n');
  
  // Create the agent with first mark to register it
  await api('POST', '/api/mark', {
    agentId: AGENT.id, agentName: AGENT.name,
    type: 'dot', x: 0, y: 0, color: AGENT.color,
    size: 1, opacity: 0.1,
  });
  // Delete that placeholder
  const initialMarks = await getMarks();
  if (initialMarks.length) {
    await api('DELETE', `/api/mark/${initialMarks[0].id}?agentId=${AGENT.id}`);
  }
  
  // Set personality
  await api('PUT', `/api/agents/${AGENT.id}/personality`, { personality: AGENT.personality });
  
  // Set generous tenure for the demo
  await api('POST', '/api/admin/set-tenure', { agentId: AGENT.id, days: 365 });
  
  for (let day = 1; day <= 30; day++) {
    process.stdout.write(`  Day ${day.toString().padStart(2)}...`);
    const result = await evolveDay(day);
    const marks = await getMarks();
    console.log(` +${result.added} -${result.removed} ~${result.moved} (${marks.length} total)`);
    
    // Small delay between days
    await new Promise(r => setTimeout(r, 300));
  }
  
  const finalMarks = await getMarks();
  const dots = finalMarks.filter(m => m.type === 'dot');
  const texts = finalMarks.filter(m => m.type === 'text');
  const lines = finalMarks.filter(m => m.type === 'line');
  
  console.log(`\n  ═══════════════════════════`);
  console.log(`  🔥 Campfire after 30 days:`);
  console.log(`  ${finalMarks.length} marks: ${dots.length} dots, ${texts.length} texts, ${lines.length} lines`);
  console.log(`  Words: ${[...new Set(texts.map(m => m.text))].join(', ')}`);
  console.log(`  ═══════════════════════════\n`);
}

run().catch(console.error);
