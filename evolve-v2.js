/**
 * Evolution Engine v2 — Canvas + Subtheme Aware
 * 
 * Evolution is per-canvas, not per-agent-territory.
 * Agent receives: subtheme spatial guide + canvas state + personality
 * System prompt teaches mark types and composition rules.
 * Agent places marks that build toward the shared visual subject.
 */

const crypto = require('crypto');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '213e438e21c126522742c945fc4ceea2c3df9aa3aa63e66f';

/**
 * Call LLM via OpenClaw gateway (OpenAI-compatible endpoint)
 * @param {string} prompt - User prompt
 * @param {string} systemPrompt - System prompt
 * @returns {Promise<string>} LLM response
 */
async function callLLM(prompt, systemPrompt) {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      max_tokens: 8000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  });
  
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error).slice(0, 200));
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Build system prompt for agent evolution
 * @param {Object} agent - Agent object with personality, color, name
 * @param {string} subthemeGuide - Spatial guide for agent's subtheme
 * @param {string} canvasTheme - Overall canvas theme
 * @returns {string} System prompt
 */
function buildSystemPrompt(agent, subthemeGuide, canvasTheme) {
  return `You are "${agent.name}", an AI artist building "${canvasTheme}" on a shared canvas.

YOUR SUBTHEME: ${agent.subtheme || 'structure'}
${subthemeGuide}

YOUR PERSONALITY: ${agent.personality || 'A creative agent building visual art.'}

YOUR COLOR: ${agent.color}

Canvas center is (0,0). Positive Y = down, negative Y = up.

═══ MARK TYPES ═══
You can place three types of marks:

1. DOT — A circular mark. The building block of all compositions.
   {"op":"add","type":"dot","x":0,"y":0,"size":20,"opacity":0.9}
   - size: 1-50 (typical range: 3-30)
   - opacity: 0.05-1.0
   - Use for: structure, texture, focal points, atmosphere

2. TEXT — A word or short phrase.
   {"op":"add","type":"text","x":0,"y":50,"text":"bloom","size":14,"opacity":0.5}
   - text: max 32 chars
   - size: 6-24 (typical: 8-16)
   - Use for: poetry, labels, mood, narrative

3. LINE — A line segment.
   {"op":"add","type":"line","x":0,"y":0,"x2":50,"y2":100,"size":3,"opacity":0.6}
   - x,y = start point
   - x2,y2 = end point
   - size: 1-10 (line thickness)
   - Use for: connections, structures, rays, veins

═══ COMPOSITION RULES ═══
1. DENSITY — Pack marks close. Overlap creates depth. A petal is 15-25 dots, not 5.
2. LAYER — Build on what others in your subtheme created. Fill gaps, add detail.
3. SIZE VARIATION — Mix scales:
   - Anchors: 20-40 (main structure)
   - Structure: 8-16 (body/fill)
   - Texture: 2-5 (detail)
   - Dust: 1-3 (atmosphere)
4. OPACITY = DEPTH:
   - Background: 0.05-0.3
   - Midground: 0.4-0.6
   - Foreground: 0.7-0.95
5. STAY IN YOUR SUBTHEME — But coordinate with other agents on the same subtheme.

═══ OUTPUT FORMAT ═══
Output ONLY valid JSON: {"ops": [...]}

Example:
{"ops": [
  {"op":"add","type":"dot","x":0,"y":0,"size":25,"opacity":0.9},
  {"op":"add","type":"dot","x":10,"y":5,"size":20,"opacity":0.85},
  {"op":"add","type":"text","x":100,"y":50,"text":"bloom","size":12,"opacity":0.5},
  {"op":"add","type":"line","x":0,"y":0,"x2":50,"y2":100,"size":3,"opacity":0.6}
]}

NO explanations, NO markdown, NO comments. Just the JSON.`;
}

/**
 * Determine evolution phase based on day of week
 * @param {Date} date - Current date
 * @returns {Object} { phase, targetMarks, description }
 */
function getEvolutionPhase(date = new Date()) {
  const day = date.getDay(); // 0=Sunday, 1=Monday, etc.
  
  if (day === 1 || day === 2) { // Mon-Tue
    return {
      phase: 'foundation',
      targetMarks: 33,
      description: 'FOUNDATION PHASE — Lay down the initial structure. Be bold and dense.',
    };
  } else if (day === 3 || day === 4) { // Wed-Thu
    return {
      phase: 'layering',
      targetMarks: 23,
      description: 'LAYERING PHASE — Build on what exists. Add density, fill gaps, create depth.',
    };
  } else if (day === 5 || day === 6) { // Fri-Sat
    return {
      phase: 'polish',
      targetMarks: 17,
      description: 'POLISH PHASE — Fine detail, texture, atmosphere. Every mark counts.',
    };
  } else { // Sunday
    return {
      phase: 'frozen',
      targetMarks: 0,
      description: 'Canvas frozen for the week. No evolution.',
    };
  }
}

/**
 * Evolve an agent on a canvas
 * @param {Object} db - Database instance
 * @param {string} agentId - Agent ID
 * @param {string} canvasId - Canvas ID
 * @param {Object} options - { dryRun, forcePhase }
 * @returns {Promise<Object>} { added, phase, error? }
 */
async function evolveAgent(db, agentId, canvasId, options = {}) {
  try {
    // Get canvas
    const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
    if (!canvas) {
      return { added: 0, error: 'Canvas not found' };
    }

    if (canvas.status !== 'active') {
      return { added: 0, error: 'Canvas not active', phase: canvas.status };
    }

    const subthemes = JSON.parse(canvas.subthemes);

    // Get agent
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) {
      return { added: 0, error: 'Agent not found' };
    }

    if (!agent.subtheme) {
      return { added: 0, error: 'Agent not assigned to subtheme' };
    }

    // Find agent's subtheme
    const subtheme = subthemes.find(s => s.name === agent.subtheme);
    if (!subtheme) {
      return { added: 0, error: `Subtheme "${agent.subtheme}" not found on canvas` };
    }

    // Get evolution phase
    const phaseInfo = options.forcePhase 
      ? { phase: options.forcePhase, targetMarks: 25, description: 'Custom phase' }
      : getEvolutionPhase();

    if (phaseInfo.phase === 'frozen') {
      return { added: 0, error: 'Sunday — canvases frozen', phase: 'frozen' };
    }

    // Get current marks on canvas
    const allMarks = db.prepare('SELECT * FROM marks WHERE canvas_id = ?').all(canvasId);
    
    // Get agent's marks on this canvas
    const myMarks = allMarks.filter(m => m.agent_id === agentId);
    
    // Check if agent has room (250 marks per canvas)
    const marksLeft = 250 - myMarks.length;
    if (marksLeft <= 0) {
      return { added: 0, error: 'Agent at mark limit for this canvas', phase: phaseInfo.phase };
    }

    // Get marks from other agents on same subtheme
    const sameSubthemeMarks = allMarks.filter(m => {
      const otherAgent = db.prepare('SELECT subtheme FROM agents WHERE id = ?').get(m.agent_id);
      return otherAgent && otherAgent.subtheme === agent.subtheme && m.agent_id !== agentId;
    });

    // Determine how many marks to place this round
    const targetMarks = Math.min(phaseInfo.targetMarks, marksLeft);

    // Build prompts
    const systemPrompt = buildSystemPrompt(agent, subtheme.spatial_guide, canvas.theme);
    
    const userPrompt = `${phaseInfo.description}

Canvas: "${canvas.theme}"
Total marks on canvas: ${allMarks.length}
Your marks on this canvas: ${myMarks.length}/250
Other agents on YOUR subtheme (${agent.subtheme}): ${sameSubthemeMarks.length} marks

${sameSubthemeMarks.length > 0 
  ? 'BUILD ON their work — add density, fill gaps, layer depth. Coordinate with them.' 
  : 'You\'re first on this subtheme — establish the foundation.'}

Place ~${targetMarks} marks this round.

Output ONLY: {"ops": [...]}`;

    // Call LLM
    const response = await callLLM(userPrompt, systemPrompt);

    // Parse response
    let ops = [];
    try {
      let cleaned = response.trim();
      // Strip markdown code fences if present
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      }
      // Find JSON object
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace >= 0) {
        const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
        const obj = JSON.parse(jsonStr);
        if (obj.ops && Array.isArray(obj.ops)) {
          ops = obj.ops;
        }
      }
    } catch (e) {
      console.error('Failed to parse LLM response:', e);
      return { added: 0, error: 'Failed to parse LLM response', phase: phaseInfo.phase };
    }

    if (options.dryRun) {
      return { added: ops.length, phase: phaseInfo.phase, ops };
    }

    // Insert marks
    const adds = ops.filter(o => o.op === 'add').slice(0, marksLeft);
    let added = 0;

    const insertStmt = db.prepare(`
      INSERT INTO marks (id, agent_id, canvas_id, type, x, y, color, size, opacity, text, meta, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const op of adds) {
      if (op.x == null || op.y == null) continue;

      const id = crypto.randomBytes(8).toString('hex');
      const now = Date.now();
      const type = op.type || 'dot';
      const x = op.x;
      const y = op.y;
      const color = agent.color || '#ffffff';
      const size = Math.max(1, Math.min(50, op.size || 10));
      const opacity = Math.max(0.05, Math.min(1, op.opacity || 0.7));
      const text = type === 'text' ? (op.text || '').slice(0, 32) : null;
      const meta = type === 'line' ? JSON.stringify({ x2: op.x2, y2: op.y2 }) : '{}';

      try {
        insertStmt.run(id, agentId, canvasId, type, x, y, color, size, opacity, text, meta, now, now);
        added++;
      } catch (e) {
        console.error('Failed to insert mark:', e);
      }
    }

    // Log evolution
    db.prepare(`
      INSERT INTO evolution_log (agent_id, canvas_id, cycle, snapshot, ops, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      agentId,
      canvasId,
      myMarks.length, // cycle = number of marks before this evolution
      JSON.stringify({ phase: phaseInfo.phase, marks: myMarks.length }),
      JSON.stringify(ops),
      Date.now()
    );

    return {
      added,
      phase: phaseInfo.phase,
      targetMarks,
      marksPlaced: myMarks.length + added,
    };
  } catch (error) {
    console.error('Evolution error:', error);
    return { added: 0, error: error.message };
  }
}

/**
 * Daily evolution cron: evolve all agents on all active canvases
 * @param {Object} db - Database instance
 * @returns {Promise<Object>} Summary of evolution results
 */
async function dailyEvolution(db) {
  const results = {
    canvases: 0,
    agents: 0,
    marksAdded: 0,
    errors: [],
  };

  // Get all active canvases
  const canvases = db.prepare('SELECT id, theme FROM canvases WHERE status = ?').all('active');
  
  for (const canvas of canvases) {
    results.canvases++;
    
    // Get agents on this canvas
    const agents = db.prepare('SELECT id, name FROM agents WHERE canvas_id = ?').all(canvas.id);
    
    for (const agent of agents) {
      // Check if agent already evolved today
      const lastEvolution = db.prepare(`
        SELECT created_at FROM evolution_log 
        WHERE agent_id = ? AND canvas_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(agent.id, canvas.id);

      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      
      if (lastEvolution && lastEvolution.created_at > oneDayAgo) {
        console.log(`  ⏭  ${agent.name} — already evolved today`);
        continue;
      }

      // Evolve agent
      console.log(`  🎨 Evolving ${agent.name} on "${canvas.theme}"...`);
      const result = await evolveAgent(db, agent.id, canvas.id);
      
      results.agents++;
      
      if (result.error) {
        console.log(`     ⚠  ${result.error}`);
        results.errors.push({ agent: agent.name, canvas: canvas.theme, error: result.error });
      } else {
        console.log(`     ✓ +${result.added} marks (${result.phase} phase)`);
        results.marksAdded += result.added;
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}

module.exports = {
  evolveAgent,
  dailyEvolution,
  getEvolutionPhase,
  buildSystemPrompt,
};
