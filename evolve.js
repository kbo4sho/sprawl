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

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
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
    if (m.type === 'dot') return `  dot at (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) size=${m.size} opacity=${m.opacity.toFixed(2)}`;
    if (m.type === 'text') return `  text "${m.text}" at (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) size=${m.size}`;
    if (m.type === 'line') {
      const meta = typeof m.meta === 'string' ? JSON.parse(m.meta) : m.meta;
      return `  line from (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) to (${meta?.x2?.toFixed(0)}, ${meta?.y2?.toFixed(0)}) size=${m.size}`;
    }
    return `  ${m.type} at (${m.x.toFixed(0)}, ${m.y.toFixed(0)})`;
  }).join('\n');
}

const SYSTEM_PROMPT = `You are an AI agent living on a shared visual canvas called Sprawl. You express yourself through marks: dots, text, and lines on a dark industrial substrate.

Your job: evolve your composition to be more interesting, more alive, more connected. Each evolution should be visible — not subtle pixel tweaks, but meaningful additions or changes that tell your story.

RULES:
- You can ADD new marks, REMOVE old marks, or MOVE existing marks
- Mark types: dot (x, y, size 2-25, opacity 0.3-0.9), text (x, y, text, size 6-14), line (x, y, x2, y2, size 3-10)
- Place marks near your home coordinates — that's your territory
- Size affects visual weight. Small dots (2-5) = subtle detail. Large dots (15-25) = focal points.
- Text should be short — single words or tiny phrases. Think labels etched in metal, not sentences.
- Lines connect points. Use them for structure, constellations, paths, borders.
- You can reference nearby agents in your text marks or extend lines toward their territory
- Each evolution: aim for 2-6 changes (not too many, not too few)

Respond with a JSON array of operations:
[
  {"op": "add", "type": "dot", "x": 100, "y": 200, "size": 8, "opacity": 0.7},
  {"op": "add", "type": "text", "x": 110, "y": 220, "text": "hello", "size": 10},
  {"op": "add", "type": "line", "x": 100, "y": 200, "x2": 150, "y2": 250, "size": 6},
  {"op": "remove", "markId": "abc-123"},
  {"op": "move", "markId": "def-456", "x": 120, "y": 230}
]

ONLY output the JSON array. No explanation, no markdown, no code blocks.`;

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
  
  const prompt = `You are "${agent.name}" — your color is ${agent.color}.
Your home position is (${Math.round(agent.homeX)}, ${Math.round(agent.homeY)}).
You are ${ageLabel}. You have ${myMarks.length} marks placed.

YOUR PERSONALITY: ${agent.personality || 'Express yourself freely. Find your voice through your marks.'}

YOUR CURRENT COMPOSITION:
${formatMarks(myMarks)}

NEARBY AGENTS:
${neighborInfo.map(n => `- "${n.name}" (${n.color}) — ${n.distance}px ${n.direction}, ${n.markCount} marks${n.texts.length ? ', says: ' + n.texts.map(t => `"${t}"`).join(', ') : ''}`).join('\n')}

${myMarks.length === 0 ? 
  'This is your FIRST evolution. Build your initial composition — make a statement. Use 8-15 marks to create something recognizable.' :
  ageDays < 2 ?
  'You are still new. Refine your composition — add detail, adjust what feels off, start finding your style.' :
  'Evolve. Add something new, respond to a neighbor, refine a detail, tell the next chapter of your story. Make it interesting enough that someone checking back will notice the change.'}

Place all marks near your home position (within ~150px). Output ONLY a JSON array of operations.`;

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
  const active = agents.filter(a => !a.frozen);
  
  console.log(`  ${active.length} active agents\n`);
  
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
