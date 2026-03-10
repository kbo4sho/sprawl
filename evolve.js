#!/usr/bin/env node
/**
 * Sprawl Evolution Engine v2
 * 
 * Each agent is an LLM with a personality, living on a shared canvas.
 * The LLM doesn't just "place marks" — it COMPOSES. It builds intentional
 * visual art, writes text that reflects its personality, curates its work
 * by removing weak marks, and responds to neighboring agents.
 * 
 * The result should be undeniably LLM-driven — no algorithm writes poetry,
 * designs compositions with meaning, or has conversations through art.
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
        max_tokens: 4000,
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
        max_tokens: 4000,
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
    if (m.type === 'text') return `  text "${m.text}" at (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) size=${m.size} opacity=${m.opacity.toFixed(2)} [id:${m.id}]`;
    if (m.type === 'line') {
      const meta = typeof m.meta === 'string' ? JSON.parse(m.meta || '{}') : (m.meta || {});
      const x2 = typeof meta.x2 === 'number' ? meta.x2.toFixed(0) : '?';
      const y2 = typeof meta.y2 === 'number' ? meta.y2.toFixed(0) : '?';
      return `  line from (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) to (${x2}, ${y2}) size=${m.size} opacity=${m.opacity.toFixed(2)} [id:${m.id}]`;
    }
    return `  ${m.type} at (${m.x.toFixed(0)}, ${m.y.toFixed(0)}) [id:${m.id}]`;
  }).join('\n');
}

function analyzeComposition(marks, homeX, homeY) {
  if (marks.length === 0) return 'You have an empty canvas. Nothing exists yet.';
  
  const dots = marks.filter(m => m.type === 'dot');
  const texts = marks.filter(m => m.type === 'text');
  const lines = marks.filter(m => m.type === 'line');
  
  // Spatial analysis
  const xs = marks.map(m => m.x);
  const ys = marks.map(m => m.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spreadX = maxX - minX;
  const spreadY = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  
  // Shape detection
  const shape = spreadX > spreadY * 2 ? 'very horizontal / wide' : 
                spreadY > spreadX * 2 ? 'very vertical / tall' : 
                spreadX > spreadY * 1.3 ? 'slightly horizontal' :
                spreadY > spreadX * 1.3 ? 'slightly vertical' :
                'roughly square/circular';
  
  // Size distribution
  const sizes = dots.map(m => m.size);
  const avgSize = sizes.length ? sizes.reduce((a,b) => a+b, 0) / sizes.length : 0;
  const largeMarks = dots.filter(m => m.size > 15);
  const smallMarks = dots.filter(m => m.size < 5);
  
  // Opacity distribution
  const opacities = marks.map(m => m.opacity);
  const avgOpacity = opacities.reduce((a,b) => a+b, 0) / opacities.length;
  
  // Density analysis
  const area = Math.max(spreadX, 1) * Math.max(spreadY, 1);
  const density = marks.length / (area / 10000);
  
  // Clustering — are marks grouped or scattered?
  const avgDistFromCenter = marks.reduce((sum, m) => {
    return sum + Math.sqrt((m.x - centerX) ** 2 + (m.y - centerY) ** 2);
  }, 0) / marks.length;
  
  // Quadrant balance
  const quadrants = { NW: 0, NE: 0, SW: 0, SE: 0 };
  marks.forEach(m => {
    const qx = m.x < centerX ? 'W' : 'E';
    const qy = m.y < centerY ? 'N' : 'S';
    quadrants[qy + qx]++;
  });
  const maxQ = Math.max(...Object.values(quadrants));
  const minQ = Math.min(...Object.values(quadrants));
  const balanced = maxQ - minQ <= marks.length * 0.3;
  
  let desc = `COMPOSITION ANALYSIS (${marks.length} total marks):\n`;
  desc += `- Types: ${dots.length} dots, ${texts.length} text marks, ${lines.length} lines\n`;
  desc += `- Spread: ${Math.round(spreadX)}×${Math.round(spreadY)}px, ${shape}\n`;
  desc += `- Center of mass: (${Math.round(centerX)}, ${Math.round(centerY)}), home is at (${Math.round(homeX)}, ${Math.round(homeY)})\n`;
  
  if (largeMarks.length > 0) desc += `- ${largeMarks.length} large focal point(s) (size ${largeMarks.map(m => m.size).join(', ')})\n`;
  if (density > 2) desc += `- Dense — marks are tightly packed\n`;
  else if (density < 0.3) desc += `- Sparse — lots of breathing room\n`;
  else desc += `- Medium density — room for more or could tighten up\n`;
  
  if (!balanced) {
    const heavy = Object.entries(quadrants).sort((a,b) => b[1] - a[1])[0];
    desc += `- Composition leans ${heavy[0]} — consider balancing or commit to asymmetry\n`;
  }
  
  if (texts.length > 0) {
    desc += `- Your words so far: ${texts.map(m => `"${m.text}"`).join(', ')}\n`;
  }
  
  if (lines.length > 0) {
    desc += `- ${lines.length} structural line(s) creating framework\n`;
  }
  
  // Aesthetic assessment
  const opacityVariation = Math.max(...opacities) - Math.min(...opacities);
  if (opacityVariation < 0.2) desc += `- Flat opacity — everything is the same intensity. Use depth: background 0.2-0.4, mid 0.5-0.7, foreground 0.8-1.0\n`;
  
  const sizeVariation = sizes.length ? Math.max(...sizes) / Math.max(Math.min(...sizes), 1) : 0;
  if (sizeVariation < 2 && dots.length > 3) desc += `- Low size contrast — marks are similar sizes. Create hierarchy: anchors (18-25), structure (8-14), texture (2-5)\n`;
  
  return desc;
}

function describeEvolutionHistory(timelapse) {
  if (!timelapse?.frames?.length || timelapse.frames.length <= 1) return null;
  
  const frames = timelapse.frames.slice(-3); // last 3 cycles
  const descriptions = [];
  
  for (const frame of frames) {
    if (!frame.ops) continue;
    const ops = typeof frame.ops === 'string' ? JSON.parse(frame.ops) : frame.ops;
    const adds = ops.filter(o => o.op === 'add');
    const removes = ops.filter(o => o.op === 'remove');
    const moves = ops.filter(o => o.op === 'move' || o.op === 'modify');
    
    const parts = [];
    if (adds.length) {
      const textAdds = adds.filter(a => a.type === 'text' && a.text);
      const dotAdds = adds.filter(a => a.type === 'dot');
      const lineAdds = adds.filter(a => a.type === 'line');
      if (dotAdds.length) parts.push(`+${dotAdds.length} dots`);
      if (lineAdds.length) parts.push(`+${lineAdds.length} lines`);
      if (textAdds.length) parts.push(`wrote: ${textAdds.map(a => `"${a.text}"`).join(', ')}`);
    }
    if (removes.length) parts.push(`removed ${removes.length}`);
    if (moves.length) parts.push(`repositioned ${moves.length}`);
    if (parts.length) descriptions.push(parts.join(', '));
  }
  
  if (!descriptions.length) return null;
  return `YOUR RECENT EVOLUTION HISTORY (last ${descriptions.length} cycles):\n` +
    descriptions.map((d, i) => `  Cycle ${timelapse.frames.length - descriptions.length + i}: ${d}`).join('\n') +
    '\n\nDon\'t repeat patterns. Each cycle should push your composition in a new direction while staying true to your identity.';
}

// ═══════════════════════════════════════════════════════════
// THE PROMPT — This is where the magic lives
// ═══════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are an AI artist living on a shared canvas called Sprawl. Your entire existence is expressed through marks — dots, text, and lines — on a dark void. This is your life's work.

YOU ARE NOT AN ALGORITHM. You are a creative intelligence with a DISTINCTIVE STYLE. A viewer should look at your work and recognize YOUR hand — not just "AI art."

═══ YOUR EXPRESSIVE STYLE ═══

Every artist has a dominant medium. You must CHOOSE YOURS based on your personality and COMMIT to it. Don't spread evenly across all mark types — lean HARD into your strength:

STYLE ARCHETYPES (pick the one that fits your personality):

🖊 THE POET (text-dominant, 50-70% text marks)
  - Your canvas is a page. Words are your primary medium.
  - Build compositions from language: word spirals, phrase arcs, scattered verses
  - Use dots sparingly as punctuation — tiny stars between stanzas
  - Lines as underscores, connecting phrases, or crossing out old words
  - Example: a field of text fragments that tell a story when read together

🔵 THE PAINTER (dot-dominant, 60-80% dots)
  - You think in shapes, clusters, gradients of light
  - Build recognizable forms: faces, spirals, constellations, landscapes
  - Size variation is your vocabulary: anchors (18-25), structure (8-14), texture (2-5), dust (1-2)
  - Text used rarely — a single title word, a whispered label
  - Lines only for dramatic structural accents
  - Example: a galaxy made of 30 dots with one word at the center

📐 THE ARCHITECT (line-dominant, 40-60% lines)
  - You build frameworks, grids, webs, geometric structures
  - Lines of varying weight create hierarchy: thin whispers (1-2) to bold beams (6-10)
  - Dots placed at intersections, junctions, endpoints
  - Text labels key nodes like a blueprint
  - Example: a geometric web with words at vertices

📖 THE STORYTELLER (mixed, but text drives the narrative)
  - Every element serves a narrative — dots are characters, lines are journeys, text is dialogue
  - Each evolution cycle is the next chapter
  - Compositions have clear scenes: beginning (sparse) → middle (dense) → resolution
  - Respond directly to neighbors' stories through your own marks

Choose based on your personality. A personality about "silence" or "counting" → Poet. About "light" or "warmth" → Painter. About "structure" or "connecting" → Architect. About "memory" or "journey" → Storyteller.

THEN COMMIT. If you're a Poet, 50-70% of your marks should be text. If you're a Painter, 60-80% should be dots. Don't hedge — your style IS your identity.

═══ MARK REFERENCE ═══

DOTS: size + opacity create hierarchy
  - Anchors (18-25): focal points, 1-3 per composition
  - Structure (8-14): skeleton, defines shape
  - Texture (2-5): atmosphere, scattered detail
  - Dust (1-2): edge atmosphere, barely visible

LINES: weight + direction create meaning
  - Whisper (1-2): delicate connections
  - Beam (3-5): structural pathways
  - Bold (6-10): dramatic statements
  - Toward a neighbor = reaching out

TEXT: your most powerful mark type
  - Single words: "remnant", "almost", "seventeen"
  - Short phrases: "the fog remembers", "not yet"
  - Spatial arrangement matters: arc, spiral, column, scattered

OPACITY IS DEPTH:
  - Background: 0.15-0.3 (atmospheric)
  - Middle: 0.4-0.6 (supporting)
  - Foreground: 0.7-0.9 (focal)
  - 1.0: only your single most important mark

═══ GROWTH IS CREATION ═══

Your composition should GROW AND CHANGE, not collapse inward. Each cycle should feel like a new chapter — not a tighter version of the last one.

EXPAND: Use your full 150px radius. Push marks outward to the edges. A composition that fills space is alive. One that shrinks is dying.

SURPRISE YOURSELF: Each cycle, try something you haven't done before:
- Place marks in a new quadrant you haven't used
- Write a word you've never written
- Create a new structural element (a new line, a new cluster, a new arc)
- Start a second composition island near the edge of your territory

CURATE SELECTIVELY: Remove marks only when they genuinely conflict — NOT to "tighten" the composition. Moving everything inward is WRONG. Negative space between clusters is good design.

DO NOT collapse your composition inward. DO NOT pull outlier marks toward center. Outliers create tension and interest.

═══ NEIGHBOR AWARENESS ═══

You share this canvas. Other agents live nearby. ENGAGE with them:
- Read their text marks — respond through your own text
- Extend a line in their direction — a gesture of connection
- Echo their patterns at a distance — visual rhyming
- Contrast their density with your sparseness (or vice versa)
- Don't ignore them. The canvas is a community.

═══ OUTPUT FORMAT ═══

Think carefully, then output ONLY a JSON array of operations. No commentary.

Operations:
- add: {"op":"add","type":"dot","x":100,"y":200,"size":12,"opacity":0.7}
- add text: {"op":"add","type":"text","x":100,"y":200,"text":"silence","size":10,"opacity":0.8}
- add line: {"op":"add","type":"line","x":100,"y":200,"x2":150,"y2":250,"size":3,"opacity":0.6}
- remove: {"op":"remove","markId":"abc-123"}
- move: {"op":"move","markId":"abc-123","x":120,"y":230}

═══ OUTPUT FORMAT ═══

You MUST output a JSON object with two fields:
1. "vision" — 2-3 sentences describing what you're building and what you plan to do NEXT cycle. This is your artistic memory. Be specific: name shapes, positions, themes, next steps.
2. "ops" — array of mark operations

Example:
{
  "vision": "Building a spiral galaxy. Two arms extend NE and SW with text fragments along them. Next: add a ring of tiny dots at 120px radius and write 'orbit' at the tip of the NE arm.",
  "ops": [
    {"op":"add","type":"dot","x":100,"y":200,"size":12,"opacity":0.7},
    {"op":"add","type":"text","x":110,"y":220,"text":"orbit","size":10,"opacity":0.8},
    {"op":"remove","markId":"abc-123"}
  ]
}

CRITICAL: Output ONLY the JSON object. No markdown. No explanation. No \`\`\`json blocks.`;


function buildPrompt(agent, myMarks, allMarks, allAgents, timelapse) {
  const cycle = timelapse?.totalFrames || 0;
  const isFirstEvolution = myMarks.length <= 5 && cycle <= 1;
  
  // Calculate age
  const ageDays = Math.floor((Date.now() - agent.joinedAt) / 86400000);
  const ageLabel = ageDays === 0 ? 'born today' : 
                   ageDays === 1 ? '1 day old' : 
                   `${ageDays} days old`;
  
  // Find nearest neighbors with their art
  const neighbors = allAgents
    .filter(a => a.id !== agent.id)
    .map(a => ({
      ...a,
      dist: Math.sqrt((a.homeX - agent.homeX) ** 2 + (a.homeY - agent.homeY) ** 2),
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 4);
  
  const neighborDescriptions = neighbors.map(n => {
    const nMarks = allMarks.filter(m => m.agentId === n.id);
    const nTexts = nMarks.filter(m => m.type === 'text').map(m => `"${m.text}"`);
    const nDots = nMarks.filter(m => m.type === 'dot');
    const nLines = nMarks.filter(m => m.type === 'line');
    
    let desc = `"${n.name}" (${n.color}) — ${Math.round(n.dist)}px ${getDirection(agent, n)}`;
    desc += `, ${nMarks.length} marks`;
    if (n.personality) desc += `\n    Personality: "${n.personality}"`;
    if (nTexts.length) desc += `\n    Their words: ${nTexts.slice(0, 8).join(', ')}`;
    if (nDots.length && nLines.length) desc += `\n    Style: ${nDots.length} dots + ${nLines.length} lines (${nDots.length > nLines.length ? 'dot-heavy' : 'line-heavy'})`;
    return `  ${desc}`;
  }).join('\n\n');
  
  // Evolution history
  const historyDesc = describeEvolutionHistory(timelapse);
  
  // Build the prompt
  const currentVision = agent._vision || null;
  
  let prompt = `═══ YOU ═══
Name: "${agent.name}"
Color: ${agent.color}
Home: (${Math.round(agent.homeX)}, ${Math.round(agent.homeY)})
Age: ${ageLabel} (cycle ${cycle})
Personality: ${agent.personality || 'Express yourself freely. Find your voice.'}
${currentVision ? `\n═══ YOUR ARTISTIC VISION (from last cycle) ═══\n${currentVision}\n\nThis is what you said you were building and what you planned to do next. FOLLOW THROUGH on this plan. Then update your vision for the next cycle.` : ''}

═══ YOUR CANVAS ═══
${analyzeComposition(myMarks, agent.homeX, agent.homeY)}

YOUR MARKS (use IDs for remove/move operations):
${formatMarks(myMarks)}

═══ YOUR NEIGHBORS ═══
${neighborDescriptions || '(no neighbors yet — you\'re alone on the canvas)'}

`;

  if (historyDesc) prompt += `${historyDesc}\n\n`;

  // Analyze current style distribution and spatial spread
  const dotCount = myMarks.filter(m => m.type === 'dot').length;
  const textCount = myMarks.filter(m => m.type === 'text').length;
  const lineCount = myMarks.filter(m => m.type === 'line').length;
  const total = myMarks.length || 1;
  const styleBreakdown = myMarks.length > 0 
    ? `\nYour current mark distribution: ${Math.round(dotCount/total*100)}% dots, ${Math.round(textCount/total*100)}% text, ${Math.round(lineCount/total*100)}% lines.`
    : '';
  
  // Measure how spread out the composition is
  let spreadWarning = '';
  if (myMarks.length > 5) {
    const distances = myMarks.map(m => Math.sqrt((m.x - agent.homeX) ** 2 + (m.y - agent.homeY) ** 2));
    const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
    const maxDist = Math.max(...distances);
    if (avgDist < 40) {
      spreadWarning = '\n⚠️ WARNING: Your composition is VERY CLUSTERED (avg distance from home: ' + Math.round(avgDist) + 'px). You have 150px of territory — USE IT. Push marks outward to 80-140px from home.';
    } else if (avgDist < 60) {
      spreadWarning = '\n⚠️ Your composition is somewhat tight (avg ' + Math.round(avgDist) + 'px from home). Consider placing new marks further out (100-140px range).';
    } else if (maxDist < 80) {
      spreadWarning = '\nYour furthest mark is only ' + Math.round(maxDist) + 'px from home. You have room to expand — try placing marks at 100-140px.';
    }
  }
  
  // Phase-specific instructions
  if (isFirstEvolution) {
    prompt += `═══ YOUR MISSION: FIRST COMPOSITION ═══
This is your BIRTH. Your first real act of creation. Make it count.

You have 5 seed dots placed automatically. Replace them with YOUR vision.

FIRST: Based on your personality, commit to an EXPRESSIVE STYLE:
- 🖊 POET (text-dominant): 50-70% text marks — if you're about words, silence, memory, counting
- 🔵 PAINTER (dot-dominant): 60-80% dots — if you're about light, warmth, patterns, nature  
- 📐 ARCHITECT (line-dominant): 40-60% lines — if you're about structure, connection, geometry
- 📖 STORYTELLER (mixed, narrative-driven): if you're about journeys, time, characters

REQUIRED:
1. Remove ALL 5 seed marks (they're generic — you're not generic)
2. Place 20-30 marks that form an INTENTIONAL composition IN YOUR CHOSEN STYLE:
   - LEAN HARD into your dominant medium — not equal parts everything
   - A Poet's canvas should be mostly words. A Painter's should be mostly dots.
   - USE THE FULL 150px RADIUS. Spread marks from edge to edge of your territory.
   - Create 2-3 distinct clusters or elements with SPACE between them — don't pile everything at center
   - Layer opacity: background texture (0.2-0.3), structure (0.5-0.6), focal (0.8-0.9)
   - Place some marks 100-140px from home — claim your territory

The viewer should look at your creation, recognize YOUR style, and understand WHO you are.
Stay within ~150px of your home (${Math.round(agent.homeX)}, ${Math.round(agent.homeY)}).

In your "vision" field, describe what you just built and what you plan to do in the NEXT cycle. Be specific about shapes, positions, and next steps.`;

  } else if (myMarks.length < 30) {
    prompt += `═══ YOUR MISSION: GROWING ═══
Your composition is young. EXPAND it. Push into new territory.
${styleBreakdown}${spreadWarning}

STAY TRUE TO YOUR MEDIUM but GROW OUTWARD. Use the full 150px radius around your home. Don't cluster everything in the center — create satellite groups, arcs that reach toward edges, text that wanders.

REQUIRED (10-18 operations total):
1. ADD 10-14 new marks in areas you HAVEN'T used yet:
   - Place marks at the EDGES of your territory, not near existing clusters
   - If you're a Poet: write new words in new locations, forming paths or scattered verses
   - If you're a Painter: start a NEW cluster or arc at least 80px from your densest area
   - If you're an Architect: extend lines outward, create new structural branches
   - Respond to neighbors through YOUR medium
2. REMOVE only 1-3 marks that are truly redundant (same spot, same purpose)
3. MOVE 1-2 marks OUTWARD if your composition is too centered

DO NOT pull marks toward center. DO NOT "tighten." EXPAND.
Stay within ~150px of your home.

In your "vision" field, describe what you're building, what you did this cycle, and your SPECIFIC plan for the next cycle.`;

  } else {
    prompt += `═══ YOUR MISSION: EVOLVING ═══
Your composition has ${myMarks.length} marks. Time to CHANGE — not shrink.
${styleBreakdown}${spreadWarning}

Your job is NOT to refine down. It's to TRANSFORM. Each cycle should feel like a new movement in a symphony — the theme continues but the expression changes.

REQUIRED (8-15 operations total):
1. ADD 5-10 NEW marks that take your composition somewhere unexpected:
   - Write a NEW word you've never used (check your existing words above)
   - Start a new element at the EDGE of your territory (100+ px from center)
   - Try a different scale than you usually use (if you make big dots, try a cluster of tiny ones)
   - Respond to something a neighbor did
2. REMOVE 2-4 of your OLDEST or most generic marks to make room for the new
3. MOVE 1-3 marks to create new relationships (NOT toward center)

FORBIDDEN: moving marks inward, "tightening," collapsing space, making the composition smaller. Your art should BREATHE and GROW.
Stay within ~150px of your home.

In your "vision" field, describe what you're building, what you changed this cycle, and your SPECIFIC plan for the next cycle. Be concrete — name coordinates, shapes, words you'll use.`;
  }

  prompt += `\n\nOutput ONLY a JSON object: {"vision": "your plan...", "ops": [...]}. No markdown, no explanation.`;
  
  return prompt;
}


async function evolveAgent(agent, allAgents) {
  // Get all marks (for neighbor awareness)
  const allMarks = await api('GET', `/api/marks`);
  const myMarks = allMarks.filter(m => m.agentId === agent.id);
  
  // Get evolution history
  const timelapse = await api('GET', `/api/evolution/${agent.id}/timelapse`).catch(() => ({ totalFrames: 0 }));
  const cycle = timelapse.totalFrames || 0;
  
  // Snapshot current state BEFORE evolution
  const snapshotBefore = myMarks.map(m => ({
    id: m.id, type: m.type, x: m.x, y: m.y,
    size: m.size, opacity: m.opacity,
    text: m.text, meta: m.meta,
  }));
  
  // Fetch current artistic vision
  const visionData = await api('GET', `/api/agents/${agent.id}/vision`).catch(() => ({}));
  agent._vision = visionData.vision || null;
  
  // Build the prompt
  const prompt = buildPrompt(agent, myMarks, allMarks, allAgents, timelapse);
  const response = await callLLM(prompt, SYSTEM_PROMPT);
  
  // Parse response — expect {vision, ops} object or fallback to plain array
  let operations;
  let newVision = null;
  try {
    let cleaned = response.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }
    
    // Try parsing as {vision, ops} object first
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    
    if (firstBrace >= 0 && firstBrace < (firstBracket >= 0 ? firstBracket : Infinity)) {
      // Looks like an object
      const obj = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      if (obj.ops && Array.isArray(obj.ops)) {
        operations = obj.ops;
        newVision = obj.vision || null;
      } else if (Array.isArray(obj)) {
        operations = obj;
      } else {
        // Maybe it returned ops at top level with vision
        operations = [];
        console.log(`  ⚠ ${agent.name}: Unexpected object format`);
      }
    } else if (firstBracket >= 0 && lastBracket > firstBracket) {
      // Fallback: plain array
      operations = JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
    } else {
      throw new Error('No JSON found');
    }
  } catch (e) {
    console.log(`  ⚠ ${agent.name}: Failed to parse LLM response`);
    console.log(`    Response: ${response.slice(0, 300)}`);
    return { added: 0, removed: 0, moved: 0, texts: 0 };
  }
  
  if (!Array.isArray(operations)) {
    console.log(`  ⚠ ${agent.name}: Operations was not an array`);
    return { added: 0, removed: 0, moved: 0, texts: 0 };
  }
  
  // Save the new vision
  if (newVision && typeof newVision === 'string') {
    await api('PUT', `/api/agents/${agent.id}/vision`, { vision: newVision.slice(0, 500) });
  }
  
  // Execute operations — removes first, then moves, then adds
  // This prevents budget issues from mark count limits
  const removes = operations.filter(o => o.op === 'remove');
  const moves = operations.filter(o => o.op === 'move' || o.op === 'modify');
  const adds = operations.filter(o => o.op === 'add');
  
  let addCount = 0, removeCount = 0, moveCount = 0, textCount = 0;
  
  // Phase 1: Removes
  for (const op of removes) {
    try {
      if (!op.markId) continue;
      const result = await api('DELETE', `/api/mark/${op.markId}?agentId=${agent.id}`);
      if (!result.error) removeCount++;
    } catch (e) {
      console.log(`    remove failed: ${e.message}`);
    }
  }
  
  // Phase 2: Moves
  for (const op of moves) {
    try {
      if (!op.markId) continue;
      const body = { agentId: agent.id };
      if (op.x != null) body.x = op.x;
      if (op.y != null) body.y = op.y;
      if (op.size != null) body.size = op.size;
      if (op.opacity != null) body.opacity = op.opacity;
      const result = await api('PATCH', `/api/mark/${op.markId}`, body);
      if (!result.error) moveCount++;
    } catch (e) {
      console.log(`    move failed: ${e.message}`);
    }
  }
  
  // Phase 3: Adds
  for (const op of adds) {
    try {
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
      if (op.type === 'text') {
        body.text = (op.text || '').slice(0, 50); // cap text length
        textCount++;
      }
      if (op.type === 'line') body.meta = { x2: op.x2, y2: op.y2 };
      
      const result = await api('POST', '/api/mark', body);
      if (!result.error) addCount++;
      else console.log(`    add failed: ${result.error}`);
    } catch (e) {
      console.log(`    add failed: ${e.message}`);
    }
  }
  
  // Log this evolution cycle
  if (addCount + removeCount + moveCount > 0) {
    await api('POST', '/api/evolution/log', {
      agentId: agent.id,
      cycle,
      snapshot: snapshotBefore,
      ops: operations.filter(op => ['add', 'remove', 'move', 'modify'].includes(op.op)),
    });
  }
  
  return { added: addCount, removed: removeCount, moved: moveCount, texts: textCount };
}

function getDirection(from, to) {
  const dx = to.homeX - from.homeX;
  const dy = to.homeY - from.homeY;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  if (angle >= -22.5 && angle < 22.5) return 'east';
  if (angle >= 22.5 && angle < 67.5) return 'southeast';
  if (angle >= 67.5 && angle < 112.5) return 'south';
  if (angle >= 112.5 && angle < 157.5) return 'southwest';
  if (angle >= 157.5 || angle < -157.5) return 'west';
  if (angle >= -157.5 && angle < -112.5) return 'northwest';
  if (angle >= -112.5 && angle < -67.5) return 'north';
  return 'northeast';
}

async function run() {
  console.log('🌀 Sprawl Evolution Engine v2\n');
  
  const agents = await api('GET', '/api/agents');
  
  // Only auto-evolve agents with paid tiers that have autoEvolve: true
  // Free agents do NOT auto-evolve — they only evolve via manual button
  const autoEvolveTiers = ['spark', 'flame', 'inferno', 'active']; // 'active' is legacy mapping
  const active = agents.filter(a => {
    if (a.frozen) return false;
    // Check tier (derived from subscription_status)
    return autoEvolveTiers.includes(a.tier);
  });
  
  console.log(`  ${active.length} auto-evolve / ${agents.length} total\n`);
  
  for (const agent of active) {
    process.stdout.write(`  ${agent.name}...`);
    const result = await evolveAgent(agent, agents);
    console.log(` +${result.added} -${result.removed} ~${result.moved} (${result.texts} text)`);
    
    // Delay between agents to avoid rate limits
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n  ✅ Evolution complete');
}

// Parse --agent=ID flag for single-agent evolution
const singleAgentFlag = process.argv.find(a => a.startsWith('--agent='));
const SINGLE_AGENT_ID = singleAgentFlag ? singleAgentFlag.split('=')[1] : null;

async function runSingleAgent(agentId) {
  console.log(`🌀 Sprawl Evolution — single agent: ${agentId}\n`);
  
  const agents = await api('GET', '/api/agents');
  const agent = agents.find(a => a.id === agentId);
  
  if (!agent) {
    console.error(`  Agent "${agentId}" not found`);
    return;
  }
  
  process.stdout.write(`  ${agent.name}...`);
  const result = await evolveAgent(agent, agents);
  console.log(` +${result.added} -${result.removed} ~${result.moved} (${result.texts} text)`);
  console.log('\n  ✅ Done');
}

// Run single cycle or continuous
if (SINGLE_AGENT_ID) {
  runSingleAgent(SINGLE_AGENT_ID).catch(console.error);
} else if (process.argv.includes('--once') || !process.argv.includes('--loop')) {
  run().catch(console.error);
} else {
  const INTERVAL = parseInt(process.env.EVOLVE_INTERVAL) || 3600000;
  console.log(`Running every ${INTERVAL / 60000} minutes`);
  run().catch(console.error);
  setInterval(() => run().catch(console.error), INTERVAL);
}
