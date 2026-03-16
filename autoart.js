#!/usr/bin/env node

/**
 * autoart.js v2 - Autonomous art evolution for Sprawl
 * 
 * Score → Keep/Revert → Mutate → Compound
 * 
 * Fixes from v1:
 * - Scorer sees FULL canvas composition, not just tail
 * - Checks push results for actual adds (catches budget/limit errors)
 * - Stricter keep/revert threshold
 * - More aggressive strategy mutation to avoid loops
 */

const fs = require('fs');
const path = require('path');

const SPRAWL_API = 'https://sprawl.place';
const GATEWAY_URL = 'http://127.0.0.1:18789/v1/chat/completions';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const MODEL = 'anthropic/claude-sonnet-4-5';
const LOG_FILE = path.join(__dirname, 'autoart-log.json');
const PARAMS_FILE = path.join(__dirname, 'autoart-params.json');
const PALETTE = ['#ffeedd','#ff6b35','#004e89','#1a936f','#c2b280','#8b4513','#2d3153','#684b3c','#d4a373','#82641d','#4a7c2e','#3d1c02','#6b4423','#b8860b','#f5f5dc','#800020','#2f4f4f','#daa520','#fffdd0','#191919'];

// === Learned Parameters ===
function loadParams() {
  if (fs.existsSync(PARAMS_FILE)) return JSON.parse(fs.readFileSync(PARAMS_FILE, 'utf8'));
  return {
    sizeRange: [2, 8],
    opacityRange: [0.15, 0.9],
    markCount: 40,
    dotRatio: 0.75,
    lineRatio: 0.2,
    textRatio: 0.05,
    clusterTightness: 60,
    colorScores: {},
    zoneScores: {},
    winningPatterns: [],
    losingPatterns: [],
    bestScore: 0,
    bestSizeRange: [2, 8],
    bestOpacityRange: [0.15, 0.9],
    bestMarkCount: 40,
    bestClusterTightness: 60,
    totalIterations: 0,
    keptIterations: 0,
    revertedIterations: 0,
  };
}

function saveParams(p) { fs.writeFileSync(PARAMS_FILE, JSON.stringify(p, null, 2)); }

function mutateParams(params) {
  const m = JSON.parse(JSON.stringify(params));
  const r = () => Math.random();
  const j = (v, lo, hi) => Math.max(lo, Math.min(hi, v + (r() - 0.5) * (hi - lo) * 0.4));
  
  // More aggressive mutations — 50% explore, 50% exploit
  if (r() < 0.6) {
    m.sizeRange[0] = Math.max(1, Math.round(j(m.sizeRange[0], 1, 6)));
    m.sizeRange[1] = Math.max(m.sizeRange[0] + 2, Math.round(j(m.sizeRange[1], 4, 16)));
  }
  if (r() < 0.5) {
    m.opacityRange[0] = Math.round(j(m.opacityRange[0], 0.05, 0.4) * 100) / 100;
    m.opacityRange[1] = Math.round(j(m.opacityRange[1], 0.5, 1.0) * 100) / 100;
  }
  if (r() < 0.5) {
    m.markCount = Math.max(20, Math.min(50, Math.round(j(m.markCount, 20, 50))));
  }
  if (r() < 0.4) {
    m.clusterTightness = Math.max(15, Math.min(150, Math.round(j(m.clusterTightness, 15, 150))));
  }
  if (r() < 0.4) {
    m.dotRatio = Math.round(j(m.dotRatio, 0.5, 0.95) * 100) / 100;
    m.lineRatio = Math.round((1 - m.dotRatio) * (0.4 + r() * 0.4) * 100) / 100;
    m.textRatio = Math.round(Math.max(0, 1 - m.dotRatio - m.lineRatio) * 100) / 100;
  }
  return m;
}

function updateParams(params, strategy, scoreBefore, scoreAfter, kept) {
  params.totalIterations++;
  if (kept) {
    params.keptIterations++;
    params.winningPatterns.push(strategy.description?.slice(0, 100) || 'unknown');
    if (params.winningPatterns.length > 15) params.winningPatterns.shift();
    if (scoreAfter.average > params.bestScore) {
      params.bestScore = scoreAfter.average;
      params.bestSizeRange = [...params.sizeRange];
      params.bestOpacityRange = [...params.opacityRange];
      params.bestMarkCount = params.markCount;
      params.bestClusterTightness = params.clusterTightness;
    }
    for (const c of (strategy.colors || [])) {
      if (!params.colorScores[c]) params.colorScores[c] = { totalScore: 0, count: 0 };
      params.colorScores[c].totalScore += scoreAfter.average;
      params.colorScores[c].count++;
    }
    if (strategy.zone) {
      if (!params.zoneScores[strategy.zone]) params.zoneScores[strategy.zone] = { totalScore: 0, count: 0 };
      params.zoneScores[strategy.zone].totalScore += scoreAfter.average;
      params.zoneScores[strategy.zone].count++;
    }
  } else {
    params.revertedIterations++;
    params.losingPatterns.push(strategy.description?.slice(0, 100) || 'unknown');
    if (params.losingPatterns.length > 15) params.losingPatterns.shift();
  }
  return params;
}

function getBestColors(params, count = 6) {
  const scored = Object.entries(params.colorScores)
    .filter(([_, v]) => v.count >= 2)
    .map(([color, v]) => ({ color, avg: v.totalScore / v.count }))
    .sort((a, b) => b.avg - a.avg);
  if (scored.length >= count) return scored.slice(0, count).map(s => s.color);
  return [...scored.map(s => s.color), ...PALETTE.slice(0, count - scored.length)];
}

// === CLI ===
function parseArgs() {
  const args = process.argv.slice(2);
  const config = { canvasId: null, apiKey: null, maxIterations: 10, delay: 8000, dryRun: false, goalsFile: path.join(__dirname, 'autoart-goals.md') };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--canvas': config.canvasId = args[++i]; break;
      case '--key': config.apiKey = args[++i]; break;
      case '--max-iterations': config.maxIterations = parseInt(args[++i], 10); break;
      case '--delay': config.delay = parseInt(args[++i], 10); break;
      case '--dry-run': config.dryRun = true; break;
      case '--goals': config.goalsFile = args[++i]; break;
    }
  }
  if (!config.canvasId || !config.apiKey) { console.error('Usage: node autoart.js --canvas <id> --key <sprl_xxx>'); process.exit(1); }
  if (!GATEWAY_TOKEN) { console.error('Missing OPENCLAW_GATEWAY_TOKEN'); process.exit(1); }
  return config;
}

// === API ===
async function fetchAllMarks() {
  const r = await fetch(`${SPRAWL_API}/api/marks`);
  return r.json();
}

async function fetchCanvas(id) {
  const r = await fetch(`${SPRAWL_API}/api/canvas/${id}`);
  return r.json();
}

async function pushMarksBatch(ops, apiKey) {
  const r = await fetch(`${SPRAWL_API}/api/ext/marks/batch`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops }),
  });
  const data = await r.json();
  return data; // { added, removed, moved, errors, budget }
}

async function callLLM(system, user, temp = 0.7) {
  const r = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GATEWAY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, temperature: temp, messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ] }),
  });
  const data = await r.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || '';
}

function parseJSON(text) {
  let s = text.trim();
  if (s.startsWith('```')) s = s.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  const fb = s.indexOf('{'), lb = s.lastIndexOf('}');
  if (fb >= 0 && lb > fb) { try { return JSON.parse(s.slice(fb, lb + 1)); } catch {} }
  const ab = s.indexOf('['), alb = s.lastIndexOf(']');
  if (ab >= 0 && alb > ab) { try { return JSON.parse(s.slice(ab, alb + 1)); } catch {} }
  throw new Error('Failed to parse JSON');
}

// === Composition Summary (for scorer to see FULL canvas) ===
function summarizeComposition(marks) {
  // Build a statistical summary the scorer can reason about
  const xs = marks.map(m => m.x), ys = marks.map(m => m.y);
  const types = {}, colors = {};
  let totalSize = 0, totalOpacity = 0;
  
  for (const m of marks) {
    types[m.type] = (types[m.type] || 0) + 1;
    colors[m.color] = (colors[m.color] || 0) + 1;
    totalSize += m.size || 5;
    totalOpacity += m.opacity || 0.5;
  }
  
  const topColors = Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}(${n})`).join(', ');
  
  // Spatial density: divide into 4 quadrants + center
  const zones = { 'upper-left': 0, 'upper-right': 0, 'lower-left': 0, 'lower-right': 0, center: 0 };
  for (const m of marks) {
    if (Math.abs(m.x) < 100 && Math.abs(m.y) < 100) zones.center++;
    else if (m.x < 0 && m.y < 0) zones['upper-left']++;
    else if (m.x >= 0 && m.y < 0) zones['upper-right']++;
    else if (m.x < 0 && m.y >= 0) zones['lower-left']++;
    else zones['lower-right']++;
  }
  
  // Text marks
  const texts = marks.filter(m => m.type === 'text' && m.text).map(m => m.text).slice(0, 10);
  
  return {
    total: marks.length,
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
    types,
    topColors,
    avgSize: (totalSize / marks.length).toFixed(1),
    avgOpacity: (totalOpacity / marks.length).toFixed(2),
    zones,
    texts,
    // Also include a spatial sample — spread across the canvas
    sample: sampleMarks(marks, 40),
  };
}

function sampleMarks(marks, count) {
  // Take marks evenly distributed across the canvas, not just the tail
  if (marks.length <= count) return marks;
  const step = Math.floor(marks.length / count);
  const sampled = [];
  for (let i = 0; i < marks.length; i += step) {
    if (sampled.length >= count) break;
    sampled.push(marks[i]);
  }
  return sampled;
}

// === Core ===
async function generateStrategy(params, marks, canvas, goals) {
  const bestColors = getBestColors(params);
  const winRate = params.totalIterations > 0 ? (params.keptIterations / params.totalIterations * 100).toFixed(0) : '?';
  const comp = summarizeComposition(marks);
  
  // Force zone diversity — don't repeat the same zone 3x in a row
  const recentZones = params.winningPatterns.slice(-3).join(' ');
  
  const system = `You are an art evolution strategist. Generate a DIFFERENT strategy each time. Never repeat the same zone 3 times in a row.`;
  
  const user = `Canvas: "${canvas.theme}"
Spatial guide: ${canvas.spatialGuide || 'none'}
Total marks: ${comp.total}
Avg size: ${comp.avgSize} | Avg opacity: ${comp.avgOpacity}
Types: ${JSON.stringify(comp.types)}
Top colors: ${comp.topColors}
Zone density: ${JSON.stringify(comp.zones)}
Text marks: ${comp.texts.join(', ') || 'none'}
Bounds: x[${comp.bounds.minX},${comp.bounds.maxX}] y[${comp.bounds.minY},${comp.bounds.maxY}]

Sample marks (spread across canvas):
${comp.sample.map(m => `(${Math.round(m.x)},${Math.round(m.y)}) ${m.type} sz=${m.size} c=${m.color} op=${m.opacity}${m.text ? ` "${m.text}"` : ''}`).join('\n')}

LEARNED (${params.totalIterations} iterations, ${winRate}% kept):
Best size: ${params.bestSizeRange} | Best opacity: ${params.bestOpacityRange}
Best colors: ${bestColors.join(', ')}
Score: ${params.bestScore.toFixed(1)}/10

RECENT ZONES (DON'T repeat): ${recentZones || 'none'}

✅ Winning: ${params.winningPatterns.slice(-3).join(' | ') || 'none'}
❌ Losing: ${params.losingPatterns.slice(-3).join(' | ') || 'none'}

HUMAN GOALS:
${goals || 'Use creative judgment.'}

Pick a DIFFERENT zone than recent ones. The sparsest zone is: ${Object.entries(comp.zones).sort((a,b) => a[1] - b[1])[0][0]} (${Object.entries(comp.zones).sort((a,b) => a[1] - b[1])[0][1]} marks).

Output JSON: {"description":"specific plan","zone":"area with coords","colors":["#hex",...],"spatialApproach":"how to arrange","emphasis":"priority"}`;

  return parseJSON(await callLLM(system, user, 0.9));
}

async function generateMarks(params, strategy, marks, canvas) {
  const system = `You are an AI artist. Output ONLY a JSON array of mark ops. No explanation.`;
  
  const numDots = Math.round(params.markCount * params.dotRatio);
  const numLines = Math.round(params.markCount * params.lineRatio);
  
  const user = `Canvas: "${canvas.theme}"
Strategy: ${strategy.description}
Zone: ${strategy.zone}
Colors: ${(strategy.colors || PALETTE.slice(0, 6)).join(', ')} (ONLY these)

Generate ${params.markCount} marks: ~${numDots} dots, ~${numLines} lines, rest text
Size: ${params.sizeRange[0]}-${params.sizeRange[1]}
Opacity: ${params.opacityRange[0]}-${params.opacityRange[1]} (use 3 layers: bg/structure/focal)
Cluster: pack within ${params.clusterTightness}px radius

RULES:
- Small marks, close together — like pointillism
- Build solid FORMS, not scattered dots
- Lines for edges only
- Text rare, size 3-5, low opacity
- Canvas range: -400 to 400

Output ONLY: [{"op":"add","type":"dot","x":0,"y":0,"size":5,"color":"#hex","opacity":0.7,"canvasId":"${canvas.id}"},...]`;

  const raw = await callLLM(system, user, 0.9);
  const parsed = parseJSON(raw);
  const ops = Array.isArray(parsed) ? parsed : parsed.ops || [];
  return ops.filter(o => typeof o.x === 'number').map(o => ({
    op: 'add',
    type: ['dot', 'line', 'text'].includes(o.type) ? o.type : 'dot',
    x: o.x, y: o.y,
    size: Math.max(1, Math.min(20, o.size || 5)),
    color: o.color || strategy.colors?.[0] || '#ffeedd',
    opacity: Math.max(0.05, Math.min(1, o.opacity || 0.5)),
    text: o.type === 'text' ? (o.text || '').slice(0, 10) : undefined,
    x2: o.type === 'line' ? o.x2 : undefined,
    y2: o.type === 'line' ? o.y2 : undefined,
    canvasId: canvas.id,
  }));
}

async function scoreComposition(marks, canvas, goals) {
  const comp = summarizeComposition(marks);
  
  const system = `You are a harsh art critic. Only truly good work scores above 6. Be SPECIFIC about what's wrong.`;
  
  const user = `Canvas: "${canvas.theme}" — ${comp.total} total marks
Goals: ${goals || 'none'}

FULL COMPOSITION ANALYSIS:
- Bounds: x[${comp.bounds.minX},${comp.bounds.maxX}] y[${comp.bounds.minY},${comp.bounds.maxY}]
- Types: ${JSON.stringify(comp.types)}
- Top colors: ${comp.topColors}
- Avg size: ${comp.avgSize} | Avg opacity: ${comp.avgOpacity}
- Zone density: UL=${comp.zones['upper-left']} UR=${comp.zones['upper-right']} LL=${comp.zones['lower-left']} LR=${comp.zones['lower-right']} C=${comp.zones.center}
- Texts: ${comp.texts.join(', ') || 'none'}

SPATIAL SAMPLE (40 marks spread across canvas):
${comp.sample.map(m => `(${Math.round(m.x)},${Math.round(m.y)}) ${m.type} sz=${m.size} c=${m.color} op=${m.opacity}`).join('\n')}

Score 1-10:
1. coherence — do marks form recognizable shapes matching "${canvas.theme}"?
2. density — appropriate density? (too sparse=bad, too blobby=bad, pointillist=good)
3. thematic — does it actually look like the theme? Can you identify wine bottle, fruit, cloth, table?
4. intentionality — deliberate composition or random scatter?

5=mediocre, 7=genuinely good, 9=remarkable. Most canvases are 3-5.

Output JSON: {"coherence":N,"density":N,"thematic":N,"intentionality":N,"reasoning":"specific critique","suggestions":"what would improve score most"}`;

  const raw = await callLLM(system, user, 0.2);
  const scores = parseJSON(raw);
  scores.average = (scores.coherence + scores.density + scores.thematic + scores.intentionality) / 4;
  return scores;
}

// === Main ===
async function main() {
  const config = parseArgs();
  let params = loadParams();
  
  // Reset params for fresh run if requested
  if (process.argv.includes('--reset')) {
    params = loadParams.__default ? loadParams.__default() : {
      sizeRange: [2, 8], opacityRange: [0.15, 0.9], markCount: 40, dotRatio: 0.75,
      lineRatio: 0.2, textRatio: 0.05, clusterTightness: 60, colorScores: {},
      zoneScores: {}, winningPatterns: [], losingPatterns: [], bestScore: 0,
      bestSizeRange: [2, 8], bestOpacityRange: [0.15, 0.9], bestMarkCount: 40,
      bestClusterTightness: 60, totalIterations: 0, keptIterations: 0, revertedIterations: 0,
    };
    saveParams(params);
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    console.log('🔄 Reset params and log\n');
  }
  
  console.log('🎨 Autoart v2 — Autonomous Art Evolution\n');
  console.log(`Canvas: ${config.canvasId}`);
  console.log(`Iterations: ${config.maxIterations} | Delay: ${config.delay}ms | Dry run: ${config.dryRun}`);
  console.log(`Prior: ${params.totalIterations} iterations, ${params.keptIterations} kept, best ${params.bestScore.toFixed(1)}\n`);

  let goals = '';
  if (fs.existsSync(config.goalsFile)) {
    goals = fs.readFileSync(config.goalsFile, 'utf8');
    console.log(`📖 Goals loaded\n`);
  }

  const canvas = await fetchCanvas(config.canvasId);
  
  // Get canvas marks by checking which agents are on this canvas
  const canvasAgents = (canvas.agents || []).map(a => a.id);
  let allMarks = await fetchAllMarks();
  let canvasMarks = allMarks.filter(m => canvasAgents.includes(m.agentId) || m.agentId === 'system');
  
  // Fallback: if no agents listed, just get the most recent marks
  if (canvasMarks.length === 0) {
    canvasMarks = allMarks; // Use all marks as fallback
  }
  
  console.log(`Canvas: "${canvas.theme}" — ${canvasMarks.length} marks\n`);

  // Initial score
  console.log('Scoring initial state...');
  let currentScore = await scoreComposition(canvasMarks, canvas, goals);
  console.log(`Initial: ${currentScore.average.toFixed(2)}/10`);
  console.log(`  C=${currentScore.coherence} D=${currentScore.density} T=${currentScore.thematic} I=${currentScore.intentionality}`);
  console.log(`  ${currentScore.reasoning?.slice(0, 150)}`);
  console.log(`  💡 ${currentScore.suggestions?.slice(0, 150)}\n`);

  for (let i = 1; i <= config.maxIterations; i++) {
    console.log(`\n━━━ Iteration ${i}/${config.maxIterations} ━━━\n`);
    
    // Re-read goals each iteration (can be edited live)
    if (fs.existsSync(config.goalsFile)) goals = fs.readFileSync(config.goalsFile, 'utf8');
    
    const iterParams = mutateParams(params);
    console.log(`Params: size=${iterParams.sizeRange} opacity=${iterParams.opacityRange} marks=${iterParams.markCount} cluster=${iterParams.clusterTightness}px`);
    
    // Strategy
    const strategy = await generateStrategy(iterParams, canvasMarks, canvas, goals);
    console.log(`Strategy: ${strategy.description?.slice(0, 120)}`);
    console.log(`Zone: ${strategy.zone} | Colors: ${(strategy.colors || []).slice(0, 4).join(', ')}`);
    
    // Generate marks
    const newOps = await generateMarks(iterParams, strategy, canvasMarks, canvas);
    console.log(`Generated ${newOps.length} marks`);
    
    if (newOps.length === 0) { console.log('⚠️  No marks, skipping'); continue; }
    
    // Push and CHECK the result
    let actualAdded = 0;
    let pushResult = null;
    if (!config.dryRun) {
      pushResult = await pushMarksBatch(newOps, config.apiKey);
      actualAdded = pushResult.added || 0;
      console.log(`Pushed: ${actualAdded}/${newOps.length} added`);
      if (pushResult.errors?.length) console.log(`  Errors: ${pushResult.errors.slice(0, 3).join(', ')}`);
      if (actualAdded === 0) {
        console.log('⚠️  No marks landed! Budget exhausted or API error. Skipping.');
        continue;
      }
    } else {
      actualAdded = newOps.length;
      console.log(`[DRY RUN] Would push ${newOps.length} marks`);
    }
    
    // Get updated marks + IDs for revert
    let newMarkIds = [];
    if (!config.dryRun) {
      allMarks = await fetchAllMarks();
      const updated = allMarks.filter(m => canvasAgents.includes(m.agentId) || m.agentId === 'system');
      if (updated.length === 0) canvasMarks = allMarks;
      else canvasMarks = updated;
      newMarkIds = canvasMarks.slice(-actualAdded).map(m => m.id);
    }
    
    // Score FULL canvas
    const newScore = await scoreComposition(canvasMarks, canvas, goals);
    const improvement = newScore.average - currentScore.average;
    console.log(`Score: ${newScore.average.toFixed(2)}/10 (${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)})`);
    console.log(`  ${newScore.reasoning?.slice(0, 120)}`);
    
    // STRICT keep/revert — must actually improve or hold
    const kept = improvement >= 0;
    if (kept) {
      console.log(`✅ KEEP`);
      currentScore = newScore;
      params.sizeRange = [...iterParams.sizeRange];
      params.opacityRange = [...iterParams.opacityRange];
      params.markCount = iterParams.markCount;
      params.clusterTightness = iterParams.clusterTightness;
      params.dotRatio = iterParams.dotRatio;
      params.lineRatio = iterParams.lineRatio;
      params.textRatio = iterParams.textRatio;
    } else {
      console.log(`❌ REVERT (${improvement.toFixed(2)})`);
      if (!config.dryRun && newMarkIds.length > 0) {
        const revertOps = newMarkIds.map(id => ({ op: 'remove', markId: id }));
        const revertResult = await pushMarksBatch(revertOps, config.apiKey);
        console.log(`  Reverted ${revertResult.removed || 0} marks`);
        allMarks = await fetchAllMarks();
        canvasMarks = allMarks.filter(m => canvasAgents.includes(m.agentId) || m.agentId === 'system');
        if (canvasMarks.length === 0) canvasMarks = allMarks;
      }
    }
    
    params = updateParams(params, strategy, currentScore, newScore, kept);
    saveParams(params);
    
    // Log
    const log = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) : { iterations: [] };
    log.iterations.push({
      iteration: params.totalIterations,
      timestamp: new Date().toISOString(),
      params: { size: iterParams.sizeRange, opacity: iterParams.opacityRange, marks: iterParams.markCount, cluster: iterParams.clusterTightness },
      strategy: strategy.description?.slice(0, 200),
      zone: strategy.zone,
      colors: strategy.colors,
      marksGenerated: newOps.length,
      marksLanded: actualAdded,
      scoreBefore: (currentScore.average - improvement).toFixed(2),
      scoreAfter: newScore.average.toFixed(2),
      improvement: improvement.toFixed(2),
      kept,
      reasoning: newScore.reasoning?.slice(0, 200),
      suggestions: newScore.suggestions?.slice(0, 200),
    });
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
    
    const wr = params.totalIterations > 0 ? (params.keptIterations / params.totalIterations * 100).toFixed(0) : '?';
    console.log(`📊 Win rate: ${params.keptIterations}/${params.totalIterations} (${wr}%) | Best: ${params.bestScore.toFixed(1)}/10 | Marks: ${canvasMarks.length}\n`);
    
    if (i < config.maxIterations) await new Promise(r => setTimeout(r, config.delay));
  }
  
  console.log(`\n🏁 DONE`);
  console.log(`Final: ${currentScore.average.toFixed(2)}/10 | ${canvasMarks.length} marks`);
  console.log(`${params.totalIterations} iterations: ${params.keptIterations} kept, ${params.revertedIterations} reverted`);
  console.log(`Best: ${params.bestScore.toFixed(1)}/10 | size=${params.bestSizeRange} opacity=${params.bestOpacityRange}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
