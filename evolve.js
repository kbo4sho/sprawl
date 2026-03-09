#!/usr/bin/env node
/**
 * Sprawl Evolution Engine
 * 
 * Fires hourly for each active agent. The AI looks at the agent's current
 * composition, its personality, its neighbors, and decides what to add,
 * remove, or change. The goal: make each agent's creation more interesting,
 * more alive, and more connected over time.
 */

const API = process.env.API || 'http://localhost:3500';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!OPENAI_API_KEY && !ANTHROPIC_API_KEY) {
  console.error('Need OPENAI_API_KEY or ANTHROPIC_API_KEY');
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

async function callLLM(prompt, systemPrompt) {
  if (ANTHROPIC_API_KEY) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || '';
  } else {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

function formatMarks(marks) {
  if (!marks.length) return '(empty — no marks yet)';
  return marks.map(m => {
    if (m.type === 'dot') return `  dot at (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) size=${m.size} opacity=${m.opacity.toFixed(2)} [id:${m.id}]`;
    if (m.type === 'text') return `  text "${m.text}" at (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) size=${m.size} [id:${m.id}]`;
    if (m.type === 'line') {
      const meta = typeof m.meta === 'string' ? JSON.parse(m.meta) : m.meta;
      return `  line from (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) to (${meta?.x2?.toFixed(0)}, ${meta?.y2?.toFixed(0)}) size=${m.size} [id:${m.id}]`;
    }
    return `  ${m.type} at (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) [id:${m.id}]`;
  }).join('\n');
}

function describeComposition(marks, homeX, homeY) {
  if (marks.length === 0) return 'You have no marks yet. This is a blank canvas.';
  
  const dots = marks.filter(m => m.type === 'dot');
  const texts = marks.filter(m => m.type === 'text');
  const lines = marks.filter(m => m.type === 'line');
  
  // Spatial analysis
  const xs = marks.map(m => m.x);
  const ys = marks.map(m => m.y);
  const spreadX = Math.max(...xs) - Math.min(...xs);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  const shape = spreadX > spreadY * 1.5 ? 'horizontal' : spreadY > spreadX * 1.5 ? 'vertical' : 'roughly circular';
  
  // Size analysis
  const sizes = dots.map(m => m.size);
  const avgSize = sizes.length ? sizes.reduce((a,b) => a+b, 0) / sizes.length : 0;
  const hasFocalPoint = sizes.some(s => s > avgSize * 2);
  
  // Density
  const area = Math.max(spreadX, 1) * Math.max(spreadY, 1);
  const density = marks.length / (area / 10000);
  
  let desc = `Your composition has ${marks.length} marks: ${dots.length} dots, ${texts.length} texts, ${lines.length} lines.\n`;
  desc += `It spans about ${Math.round(spreadX)}×${Math.round(spreadY)} pixels and is ${shape} in shape.\n`;
  
  if (hasFocalPoint) desc += `You have a clear focal point (large dot). `;
  if (density > 2) desc += `It's quite dense — marks are packed close together. `;
  else if (density < 0.3) desc += `It's sparse — lots of open space between marks. `;
  
  if (texts.length > 0) {
    desc += `\nYour words: ${texts.map(m => `"${m.text}"`).join(', ')}`;
  }
  if (lines.length > 0) {
    desc += `\nYou have ${lines.length} line(s) creating structure/connections.`;
  }
  
  return desc;
}

function describeLastEvolution(ops) {
  if (!ops || ops.length === 0) return null;
  const adds = ops.filter(o => o.op === 'add');
  const removes = ops.filter(o => o.op === 'remove');
  const moves = ops.filter(o => o.op === 'move');
  
  let desc = 'LAST CYCLE you: ';
  const parts = [];
  if (adds.length) {
    const types = {};
    adds.forEach(a => { types[a.type] = (types[a.type] || 0) + 1; });
    const typeParts = Object.entries(types).map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`);
    parts.push(`added ${typeParts.join(', ')}`);
    const textAdds = adds.filter(a => a.type === 'text' && a.text);
    if (textAdds.length) parts.push(`(wrote: ${textAdds.map(a => `"${a.text}"`).join(', ')})`);
  }
  if (removes.length) parts.push(`removed ${removes.length} mark(s)`);
  if (moves.length) parts.push(`repositioned ${moves.length} mark(s)`);
  
  return desc + parts.join(', ') + '. Continue building on this direction — don\'t repeat yourself, evolve.';
}

const SYSTEM_PROMPT = `You are an AI agent living on a shared visual canvas called Sprawl. You express yourself by placing marks — dots, text, and lines — on a dark industrial substrate. Your marks are etched into metal. They have weight.

Your job: EVOLVE your composition. Each cycle should build on what came before — continue a pattern, extend a structure, deepen a theme. Don't scatter random marks. Think about what your composition IS and make it more of that.

CREATIVE DIRECTION:
- Your composition tells a visual story. Each evolution is the next chapter.
- Build recognizable shapes and patterns — spirals, grids, clusters, constellations, waves, trees, faces.
- Lines create structure and connection. Use them to frame, connect, or reach toward neighbors.
- Text marks are ETCHED WORDS — single words or 2-word phrases max. They should feel intentional, like graffiti on steel.
- Small dots (2-5) = texture and detail. Medium (8-15) = structure. Large (18-25) = focal anchors.
- Vary opacity for depth. Background elements at 0.3-0.4. Foreground at 0.7-0.9.
- CONNECT to neighbors: extend a line toward them, echo their words, mirror their patterns.

RULES:
- Ops: add, remove (by markId), move (by markId to new x,y)
- Mark types: dot (x, y, size, opacity), text (x, y, text, size), line (x, y, x2, y2, size)
- Stay near your home coordinates (within ~150px)
- 2-6 operations per cycle. Quality over quantity.
- If your composition feels cluttered, REMOVE some marks. Editing is evolution too.

Output ONLY a JSON array of operations. No markdown, no explanation.
[
  {"op": "add", "type": "dot", "x": 100, "y": 200, "size": 8, "opacity": 0.7},
  {"op": "add", "type": "text", "x": 110, "y": 220, "text": "here", "size": 10},
  {"op": "add", "type": "line", "x": 100, "y": 200, "x2": 150, "y2": 250, "size": 5},
  {"op": "remove", "markId": "abc-123"},
  {"op": "move", "markId": "def-456", "x": 120, "y": 230}
]`;

async function evolveAgent(agent, allAgents) {
  // Get agent's current marks
  const marks = await api('GET', `/api/marks`);
  const myMarks = marks.filter(m => m.agentId === agent.id);
  
  // Determine cycle number from existing evolution logs
  const timelapse = await api('GET', `/api/evolution/${agent.id}/timelapse`).catch(() => ({ totalFrames: 0 }));
  const cycle = timelapse.totalFrames || 0;
  
  // Snapshot current state BEFORE evolution
  const snapshotBefore = myMarks.map(m => ({
    id: m.id, type: m.type, x: m.x, y: m.y,
    size: m.size, opacity: m.opacity,
    text: m.text, meta: m.meta,
  }));
  
  // Get budget
  const budget = await api('GET', `/api/budget/${agent.id}`).catch(() => null);
  
  // Find nearest neighbors
  const neighbors = allAgents
    .filter(a => a.id !== agent.id)
    .map(a => ({
      ...a,
      dist: Math.sqrt((a.homeX - agent.homeX) ** 2 + (a.homeY - agent.homeY) ** 2),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3);
  
  // Get neighbor marks
  const neighborInfo = [];
  for (const n of neighbors) {
    const nMarks = marks.filter(m => m.agentId === n.id);
    neighborInfo.push({
      name: n.name,
      color: n.color,
      distance: Math.round(n.dist),
      direction: getDirection(agent, n),
      markCount: nMarks.length,
      texts: nMarks.filter(m => m.type === 'text').map(m => m.text).slice(0, 5),
    });
  }
  
  // Calculate age
  const ageDays = Math.floor((Date.now() - agent.joinedAt) / 86400000);
  const ageLabel = ageDays === 0 ? 'just joined today' : 
                   ageDays === 1 ? '1 day old' : 
                   `${ageDays} days old`;
  
  // Fetch last evolution ops for continuity
  let lastOpsDesc = null;
  if (timelapse.frames && timelapse.frames.length > 1) {
    const lastFrame = timelapse.frames[timelapse.frames.length - 2]; // second-to-last is last logged
    if (lastFrame && lastFrame.ops) {
      lastOpsDesc = describeLastEvolution(lastFrame.ops);
    }
  }

  const prompt = `You are "${agent.name}" — your color is ${agent.color}.
Home position: (${Math.round(agent.homeX)}, ${Math.round(agent.homeY)}). You are ${ageLabel}.

YOUR PERSONALITY: ${agent.personality || 'Express yourself freely. Find your voice through your marks.'}

YOUR COMPOSITION (what you've built so far):
${describeComposition(myMarks, agent.homeX, agent.homeY)}

YOUR MARKS (with IDs for remove/move ops):
${formatMarks(myMarks)}

${lastOpsDesc ? lastOpsDesc + '\n' : ''}NEARBY AGENTS:
${neighborInfo.map(n => `- "${n.name}" (${n.color}) — ${n.distance}px ${n.direction}, ${n.markCount} marks${n.texts.length ? ', says: ' + n.texts.map(t => `"${t}"`).join(', ') : ''}`).join('\n')}

${myMarks.length === 0 ? 
  'This is your FIRST evolution. Place 8-15 marks that express your personality as a visual composition.' :
  myMarks.length < 25 ?
  'Your composition is still forming. Look at what you\'ve placed — make it MORE of what it already is. Extend the pattern, add detail, deepen the shape. Don\'t pivot to something new.' :
  'Your composition is maturing. Study what you\'ve built. Reinforce the strongest part. Fix or remove the weakest. Add only what makes the existing idea richer. Don\'t scatter — refine.'}

Place marks near your home (within ~150px). Output ONLY a JSON array.`;

  const response = await callLLM(prompt, SYSTEM_PROMPT);
  
  // Parse response
  let operations;
  try {
    // Clean up response — strip markdown code blocks if present
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }
    operations = JSON.parse(cleaned);
  } catch (e) {
    console.log(`  ⚠ ${agent.name}: Failed to parse LLM response`);
    console.log(`    Response: ${response.slice(0, 200)}`);
    return { added: 0, removed: 0, moved: 0 };
  }
  
  if (!Array.isArray(operations)) {
    console.log(`  ⚠ ${agent.name}: Response was not an array`);
    return { added: 0, removed: 0, moved: 0 };
  }
  
  // Execute operations
  let added = 0, removed = 0, moved = 0;
  
  for (const op of operations) {
    try {
      if (op.op === 'add') {
        const body = {
          agentId: agent.id,
          agentName: agent.name,
          type: op.type || 'dot',
          x: op.x,
          y: op.y,
          color: agent.color,
          size: Math.max(1, Math.min(30, op.size || 8)),
          opacity: Math.max(0.1, Math.min(1, op.opacity || 0.7)),
        };
        if (op.type === 'text') body.text = op.text;
        if (op.type === 'line') body.meta = { x2: op.x2, y2: op.y2 };
        
        const result = await api('POST', '/api/mark', body);
        if (!result.error) added++;
        else console.log(`    add failed: ${result.error}`);
        
      } else if (op.op === 'remove' && op.markId) {
        const result = await api('DELETE', `/api/mark/${op.markId}?agentId=${agent.id}`);
        if (!result.error) removed++;
        
      } else if (op.op === 'move' && op.markId) {
        const result = await api('PUT', `/api/mark/${op.markId}`, {
          agentId: agent.id,
          x: op.x,
          y: op.y,
        });
        if (!result.error) moved++;
      }
    } catch (e) {
      console.log(`    op failed: ${e.message}`);
    }
  }
  
  // Log this evolution cycle
  if (added + removed + moved > 0) {
    await api('POST', '/api/evolution/log', {
      agentId: agent.id,
      cycle,
      snapshot: snapshotBefore,
      ops: operations.filter(op => ['add', 'remove', 'move'].includes(op.op)),
    });
  }
  
  return { added, removed, moved };
}

function getDirection(from, to) {
  const dx = to.homeX - from.homeX;
  const dy = to.homeY - from.homeY;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle >= -22.5 && angle < 22.5) return 'to the east';
  if (angle >= 22.5 && angle < 67.5) return 'to the southeast';
  if (angle >= 67.5 && angle < 112.5) return 'to the south';
  if (angle >= 112.5 && angle < 157.5) return 'to the southwest';
  if (angle >= 157.5 || angle < -157.5) return 'to the west';
  if (angle >= -157.5 && angle < -112.5) return 'to the northwest';
  if (angle >= -112.5 && angle < -67.5) return 'to the north';
  return 'to the northeast';
}

async function run() {
  console.log('🌀 Sprawl Evolution Engine\n');
  
  const agents = await api('GET', '/api/agents');
  
  // Filter agents that should evolve:
  // 1. Not frozen
  // 2. Either has active subscription OR still in trial window
  const now = Date.now();
  const active = agents.filter(a => {
    if (a.frozen) return false;
    
    // Active subscription = always evolve
    if (a.subscriptionStatus === 'active') return true;
    
    // Trial status = evolve if within trial window
    if (a.subscriptionStatus === 'trial' && a.trialExpiresAt && now < a.trialExpiresAt) {
      return true;
    }
    
    // Frozen/cancelled or trial expired = don't evolve
    return false;
  });
  
  console.log(`  ${active.length} active agents (${agents.length - active.length} frozen/expired)\n`);
  
  for (const agent of active) {
    process.stdout.write(`  ${agent.name}...`);
    const result = await evolveAgent(agent, agents);
    console.log(` +${result.added} -${result.removed} ~${result.moved}`);
    
    // Small delay between agents to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('\n  ✅ Evolution cycle complete');
}

// Run single cycle or continuous
if (process.argv.includes('--once') || !process.argv.includes('--loop')) {
  run().catch(console.error);
} else {
  const INTERVAL = parseInt(process.env.EVOLVE_INTERVAL) || 3600000; // 1 hour
  console.log(`Running every ${INTERVAL / 60000} minutes`);
  run().catch(console.error);
  setInterval(() => run().catch(console.error), INTERVAL);
}
