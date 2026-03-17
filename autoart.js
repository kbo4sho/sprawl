#!/usr/bin/env node

/**
 * autoart.js v3 - Composition-based autonomous art for Sprawl
 * 
 * NEW in v3:
 * - Phase 0: LLM-generated composition plan (autoart-plan.json)
 * - Vision-based scoring with canvas rendering
 * - Object-focused iteration (pick most underdone object from plan)
 * - Node.js canvas renderer (or Playwright fallback)
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const SPRAWL_API = 'https://sprawl.place';
const GATEWAY_URL = 'http://127.0.0.1:18789/v1/chat/completions';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const MODEL = 'anthropic/claude-sonnet-4-5';
const LOG_FILE = path.join(__dirname, 'autoart-log.json');
const PARAMS_FILE = path.join(__dirname, 'autoart-params.json');
const PLAN_FILE = path.join(__dirname, 'autoart-plan.json');
const RENDER_TEMP = '/tmp/autoart_render.png';
const MARKS_TEMP = '/tmp/autoart_marks.json';

// === Learned Parameters ===
function loadParams() {
  if (fs.existsSync(PARAMS_FILE)) return JSON.parse(fs.readFileSync(PARAMS_FILE, 'utf8'));
  return {
    sizeRange: [2, 8],
    opacityRange: [0.15, 0.9],
    markCount: 40,
    clusterTightness: 60,
    bestScore: 0,
    bestSizeRange: [2, 8],
    bestOpacityRange: [0.15, 0.9],
    bestMarkCount: 40,
    bestClusterTightness: 60,
    totalIterations: 0,
    keptIterations: 0,
    revertedIterations: 0,
    winningPatterns: [],
    losingPatterns: [],
  };
}

function saveParams(p) { fs.writeFileSync(PARAMS_FILE, JSON.stringify(p, null, 2)); }

function mutateParams(params) {
  const m = JSON.parse(JSON.stringify(params));
  const r = () => Math.random();
  const j = (v, lo, hi) => Math.max(lo, Math.min(hi, v + (r() - 0.5) * (hi - lo) * 0.4));
  
  if (r() < 0.6) {
    m.sizeRange[0] = Math.max(1, Math.round(j(m.sizeRange[0], 1, 6)));
    m.sizeRange[1] = Math.max(m.sizeRange[0] + 2, Math.round(j(m.sizeRange[1], 4, 16)));
  }
  if (r() < 0.5) {
    m.opacityRange[0] = Math.round(j(m.opacityRange[0], 0.05, 0.4) * 100) / 100;
    m.opacityRange[1] = Math.round(j(m.opacityRange[1], 0.5, 1.0) * 100) / 100;
  }
  if (r() < 0.5) {
    m.markCount = Math.max(20, Math.min(60, Math.round(j(m.markCount, 20, 60))));
  }
  if (r() < 0.4) {
    m.clusterTightness = Math.max(15, Math.min(150, Math.round(j(m.clusterTightness, 15, 150))));
  }
  return m;
}

function updateParams(params, strategy, scoreBefore, scoreAfter, kept) {
  params.totalIterations++;
  if (kept) {
    params.keptIterations++;
    params.winningPatterns.push(strategy.object?.slice(0, 50) || 'unknown');
    if (params.winningPatterns.length > 10) params.winningPatterns.shift();
    if (scoreAfter.average > params.bestScore) {
      params.bestScore = scoreAfter.average;
      params.bestSizeRange = [...params.sizeRange];
      params.bestOpacityRange = [...params.opacityRange];
      params.bestMarkCount = params.markCount;
      params.bestClusterTightness = params.clusterTightness;
    }
  } else {
    params.revertedIterations++;
    params.losingPatterns.push(strategy.object?.slice(0, 50) || 'unknown');
    if (params.losingPatterns.length > 10) params.losingPatterns.shift();
  }
  return params;
}

// === CLI ===
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    canvasId: null,
    apiKey: null,
    maxIterations: 10,
    delay: 8000,
    dryRun: false,
    goalsFile: path.join(__dirname, 'autoart-goals.md'),
    replan: false,
    reset: false,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--canvas': config.canvasId = args[++i]; break;
      case '--key': config.apiKey = args[++i]; break;
      case '--max-iterations': config.maxIterations = parseInt(args[++i], 10); break;
      case '--delay': config.delay = parseInt(args[++i], 10); break;
      case '--dry-run': config.dryRun = true; break;
      case '--goals': config.goalsFile = args[++i]; break;
      case '--replan': config.replan = true; break;
      case '--reset': config.reset = true; break;
    }
  }
  if (!config.canvasId || !config.apiKey) {
    console.error('Usage: node autoart.js --canvas <id> --key <sprl_xxx>');
    process.exit(1);
  }
  if (!GATEWAY_TOKEN) {
    console.error('Missing OPENCLAW_GATEWAY_TOKEN');
    process.exit(1);
  }
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
  return r.json();
}

async function callLLM(system, user, temp = 0.7, schema = null) {
  const body = {
    model: MODEL,
    max_tokens: 4000,
    temperature: temp,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
  };
  if (schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: schema.name, strict: true, schema: schema.schema }
    };
  }
  const r = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GATEWAY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || '';
}

// Vision scoring via local Ollama (Mistral Small 3.1 — French, runs local, free)
const VISION_MODEL = process.env.AUTOART_VISION_MODEL || 'mistral-small3.1';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

async function callVisionLLM(system, text, imageBase64, temp = 0.2) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      stream: false,
      options: { temperature: temp },
      messages: [{
        role: 'user',
        content: `${system}\n\n${text}`,
        images: [imageBase64],
      }]
    }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.message?.content || '';
}

function parseJSON(text) {
  let s = text.trim();
  if (s.startsWith('```')) s = s.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  const fb = s.indexOf('{'), lb = s.lastIndexOf('}');
  if (fb >= 0 && lb > fb) {
    try { return JSON.parse(s.slice(fb, lb + 1)); } catch {}
  }
  const ab = s.indexOf('['), alb = s.lastIndexOf(']');
  if (ab >= 0 && alb > ab) {
    try { return JSON.parse(s.slice(ab, alb + 1)); } catch {}
  }
  // Try fixing common LLM JSON issues
  try {
    const cleaned = s.replace(/,\s*([}\]])/g, '$1');
    const fb2 = cleaned.indexOf('{'), lb2 = cleaned.lastIndexOf('}');
    if (fb2 >= 0 && lb2 > fb2) return JSON.parse(cleaned.slice(fb2, lb2 + 1));
  } catch {}
  throw new Error('Failed to parse JSON');
}

// === Composition Plan (Phase 0) ===
async function generateCompositionPlan(canvas, goals) {
  console.log('🎯 Generating composition plan...\n');
  
  const system = `You are a composition planner for a canvas artwork. You define the spatial layout and parameters for each object in the scene.`;
  
  const user = `Canvas theme: "${canvas.theme}"
Spatial guide: ${canvas.spatialGuide || 'none'}

Goals:
${goals}

Canvas coordinates: -400 to 400 (x and y)

Define a composition plan with objects that match the theme. For a still life, define:
- Wine bottle (exact x/y bounds, color palette, target mark count, size range, opacity range)
- Fruit bowl (bounds, colors, mark count, etc.)
- Draped cloth (bounds, colors, etc.)
- Table surface (bounds, colors, etc.)
- Background/atmosphere (bounds, colors, etc.)

For each object, specify:
- name: short descriptive name
- description: what it represents
- bounds: {xMin, xMax, yMin, yMax} (integers, -400 to 400)
- targetMarkCount: MINIMUM marks to get started (not a cap — agents can always add more if the critic says it needs density)
- palette: array of hex colors specific to this object
- sizeRange: [min, max] for mark sizes
- opacityRange: [min, max] for opacity
- priority: 1-5 (1=most important, paint first)

Output ONLY JSON:
{
  "objects": [
    {
      "name": "wine-bottle",
      "description": "Dark glass wine bottle",
      "bounds": {"xMin": -100, "xMax": -20, "yMin": -120, "yMax": 150},
      "targetMarkCount": 100,
      "palette": ["#1a0a2e", "#2d1b3d", "#3b1f4a"],
      "sizeRange": [2, 6],
      "opacityRange": [0.4, 0.9],
      "priority": 1
    },
    ...
  ]
}`;

  const raw = await callLLM(system, user, 0.7);
  const plan = parseJSON(raw);
  
  // Add currentMarkCount to each object
  for (const obj of plan.objects) {
    obj.currentMarkCount = 0;
  }
  
  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));
  console.log(`📋 Plan saved to ${PLAN_FILE}`);
  console.log(`Objects: ${plan.objects.map(o => o.name).join(', ')}\n`);
  
  return plan;
}

function loadCompositionPlan() {
  if (!fs.existsSync(PLAN_FILE)) return null;
  return JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
}

function updatePlanMarkCounts(plan, marks) {
  // Count how many marks are in each object's bounds
  for (const obj of plan.objects) {
    obj.currentMarkCount = marks.filter(m =>
      m.x >= obj.bounds.xMin && m.x <= obj.bounds.xMax &&
      m.y >= obj.bounds.yMin && m.y <= obj.bounds.yMax
    ).length;
  }
  return plan;
}

function pickMostUnderdoneObject(plan) {
  // No caps — targets are minimums, not limits.
  // Prioritize objects below target first, then cycle through all objects.
  // The vision critic decides when we're done, not the mark count.
  const scored = plan.objects.map(obj => {
    const completion = obj.targetMarkCount > 0 ? obj.currentMarkCount / obj.targetMarkCount : 1;
    const priorityBoost = (6 - obj.priority) * 0.3;
    // Objects below target get a big bonus to be picked first
    const belowTarget = completion < 1.0 ? -2 : 0;
    return { obj, score: completion - priorityBoost + belowTarget };
  }).sort((a, b) => a.score - b.score);
  
  return scored[0].obj;
}

// === Rendering ===
async function renderCanvasToImage(marks) {
  // Try node-canvas first, fall back to Playwright
  try {
    // Check if node-canvas is available
    const Canvas = require('canvas');
    return await renderWithNodeCanvas(marks, Canvas);
  } catch (err) {
    console.log('  node-canvas not available, using Playwright fallback...');
    return await renderWithPlaywright(marks);
  }
}

async function renderWithNodeCanvas(marks, Canvas) {
  const { createCanvas } = Canvas;
  const width = 800;
  const height = 800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, width, height);
  
  // Coordinate mapping: marks are -400 to 400, canvas is 0 to 800
  const mapX = x => (x + 400) / 800 * width;
  const mapY = y => (y + 400) / 800 * height;
  
  // Draw marks
  for (const m of marks) {
    ctx.globalAlpha = m.opacity || 0.5;
    ctx.fillStyle = m.color || '#ffffff';
    
    if (m.type === 'dot' || !m.type) {
      ctx.beginPath();
      ctx.arc(mapX(m.x), mapY(m.y), m.size || 5, 0, Math.PI * 2);
      ctx.fill();
    } else if (m.type === 'line' && typeof m.x2 === 'number' && typeof m.y2 === 'number') {
      ctx.strokeStyle = m.color || '#ffffff';
      ctx.lineWidth = m.size || 2;
      ctx.beginPath();
      ctx.moveTo(mapX(m.x), mapY(m.y));
      ctx.lineTo(mapX(m.x2), mapY(m.y2));
      ctx.stroke();
    } else if (m.type === 'text' && m.text) {
      ctx.font = `${m.size || 12}px monospace`;
      ctx.fillText(m.text, mapX(m.x), mapY(m.y));
    }
  }
  
  // Save to file
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(RENDER_TEMP, buffer);
  return RENDER_TEMP;
}

async function renderWithPlaywright(marks) {
  // Write marks to temp file
  fs.writeFileSync(MARKS_TEMP, JSON.stringify(marks, null, 2));
  
  // Build SVG
  const width = 800;
  const height = 800;
  const mapX = x => (x + 400) / 800 * width;
  const mapY = y => (y + 400) / 800 * height;
  
  let svgElements = [];
  for (const m of marks) {
    if (m.type === 'dot' || !m.type) {
      svgElements.push(`<circle cx="${mapX(m.x)}" cy="${mapY(m.y)}" r="${m.size || 5}" fill="${m.color || '#fff'}" opacity="${m.opacity || 0.5}"/>`);
    } else if (m.type === 'line' && typeof m.x2 === 'number' && typeof m.y2 === 'number') {
      svgElements.push(`<line x1="${mapX(m.x)}" y1="${mapY(m.y)}" x2="${mapX(m.x2)}" y2="${mapY(m.y2)}" stroke="${m.color || '#fff'}" stroke-width="${m.size || 2}" opacity="${m.opacity || 0.5}"/>`);
    } else if (m.type === 'text' && m.text) {
      svgElements.push(`<text x="${mapX(m.x)}" y="${mapY(m.y)}" font-size="${m.size || 12}" fill="${m.color || '#fff'}" opacity="${m.opacity || 0.5}" font-family="monospace">${m.text}</text>`);
    }
  }
  
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#0a0a0a"/>
  ${svgElements.join('\n  ')}
</svg>`;
  
  const svgPath = '/tmp/autoart_canvas.svg';
  fs.writeFileSync(svgPath, svg);
  
  // Use Playwright via Python to screenshot
  const pythonScript = `
import sys
from playwright.sync_api import sync_playwright

svg_path = "${svgPath}"
output_path = "${RENDER_TEMP}"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": ${width}, "height": ${height}})
    page.goto(f"file://{svg_path}")
    page.screenshot(path=output_path)
    browser.close()
`;
  
  const scriptPath = '/tmp/autoart_render.py';
  fs.writeFileSync(scriptPath, pythonScript);
  
  await execAsync(`python3 ${scriptPath}`);
  return RENDER_TEMP;
}

// === Heuristic Scoring (instant, deterministic) ===
function scoreHeuristic(marks, plan, targetObject, newMarks) {
  // Score based on density, coverage, and clustering within the target object bounds
  const b = targetObject.bounds;
  const objMarks = marks.filter(m => m.x >= b.xMin && m.x <= b.xMax && m.y >= b.yMin && m.y <= b.yMax);
  
  const width = b.xMax - b.xMin;
  const height = b.yMax - b.yMin;
  const area = width * height;
  
  // 1. Density: marks per 100 sq units in this object's region
  const density = (objMarks.length / area) * 100;
  const densityScore = Math.min(10, density * 5); // 0.2 marks/100squ = 1, 2.0 = 10
  
  // 2. Coverage: divide region into 5x5 grid, what % of cells have marks?
  const gridW = 5, gridH = 5;
  const cellW = width / gridW, cellH = height / gridH;
  const cells = new Set();
  for (const m of objMarks) {
    const cx = Math.floor((m.x - b.xMin) / cellW);
    const cy = Math.floor((m.y - b.yMin) / cellH);
    cells.add(`${cx},${cy}`);
  }
  const coverageScore = (cells.size / (gridW * gridH)) * 10;
  
  // 3. New marks clustering: are the new marks tightly packed?
  let clusterScore = 5;
  if (newMarks && newMarks.length > 1) {
    let totalDist = 0, count = 0;
    for (let i = 0; i < Math.min(newMarks.length, 20); i++) {
      for (let j = i + 1; j < Math.min(newMarks.length, 20); j++) {
        totalDist += Math.sqrt((newMarks[i].x - newMarks[j].x) ** 2 + (newMarks[i].y - newMarks[j].y) ** 2);
        count++;
      }
    }
    const avgDist = totalDist / count;
    // Tighter clustering = higher score. <20px avg = 10, >100px = 2
    clusterScore = Math.max(2, Math.min(10, 10 - (avgDist - 20) / 10));
  }
  
  // 4. Global coverage: how many plan objects have decent density?
  let objectsWithDensity = 0;
  for (const obj of plan.objects) {
    const ob = obj.bounds;
    const om = marks.filter(m => m.x >= ob.xMin && m.x <= ob.xMax && m.y >= ob.yMin && m.y <= ob.yMax);
    const oArea = (ob.xMax - ob.xMin) * (ob.yMax - ob.yMin);
    if (oArea > 0 && (om.length / oArea) * 100 > 0.3) objectsWithDensity++;
  }
  const globalScore = (objectsWithDensity / plan.objects.length) * 10;
  
  const average = (densityScore + coverageScore + clusterScore + globalScore) / 4;
  return {
    density: +densityScore.toFixed(1),
    coverage: +coverageScore.toFixed(1),
    clustering: +clusterScore.toFixed(1),
    global: +globalScore.toFixed(1),
    average: +average.toFixed(2),
    reasoning: `density=${densityScore.toFixed(1)} coverage=${coverageScore.toFixed(1)} cluster=${clusterScore.toFixed(1)} global=${globalScore.toFixed(1)}`
  };
}

// === Vision Scoring (expensive, use for milestones) ===
async function scoreCompositionWithVision(marks, canvas, goals, imagePath) {
  console.log('🔍 Rendering canvas for vision scoring...');
  await renderCanvasToImage(marks);
  
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');
  
  const system = `You are a harsh art critic evaluating a canvas artwork. Score 1-10 on four dimensions. Only truly good work scores above 6.`;
  
  const text = `Canvas theme: "${canvas.theme}"
Total marks: ${marks.length}

Goals:
${goals}

Score the composition on:
1. coherence — do marks form recognizable shapes matching the theme?
2. density — appropriate density? (too sparse=bad, too blobby=bad, pointillist=good)
3. thematic — does it actually look like "${canvas.theme}"? Identify specific objects.
4. intentionality — deliberate composition or random scatter?

5=mediocre, 7=genuinely good, 9=remarkable. Most canvases are 3-5.

Output ONLY JSON:
{
  "coherence": N,
  "density": N,
  "thematic": N,
  "intentionality": N,
  "reasoning": "specific critique in 1-2 sentences",
  "suggestions": "what would improve score most"
}`;

  const raw = await callVisionLLM(system, text, imageBase64, 0.2);
  const scores = parseJSON(raw);
  scores.average = (scores.coherence + scores.density + scores.thematic + scores.intentionality) / 4;
  return scores;
}

// === Strategy & Generation ===
async function generateStrategy(params, plan, targetObject, canvas, goals) {
  const system = `You are an art strategist. You're building a specific object within a composition plan.`;
  
  const user = `Canvas: "${canvas.theme}"
Target object: ${targetObject.name} — ${targetObject.description}

Object bounds: x[${targetObject.bounds.xMin}, ${targetObject.bounds.xMax}] y[${targetObject.bounds.yMin}, ${targetObject.bounds.yMax}]
Minimum marks: ${targetObject.targetMarkCount} (not a cap — add as many as needed for density and realism)
Current marks: ${targetObject.currentMarkCount}

Palette for this object: ${targetObject.palette.join(', ')}
Size range: ${targetObject.sizeRange}
Opacity range: ${targetObject.opacityRange}

Current learned params:
- Mark count per iteration: ${params.markCount}
- Cluster tightness: ${params.clusterTightness}px
- Best score so far: ${params.bestScore.toFixed(1)}/10

Goals:
${goals}

Output JSON strategy for adding marks to this object ONLY:
{
  "description": "brief plan for this batch",
  "approach": "how to arrange marks within bounds",
  "emphasis": "what to prioritize",
  "markCount": ${params.markCount}
}`;

  return parseJSON(await callLLM(system, user, 0.8));
}

// JSON Schema for structured mark output — enforces valid marks at the model level
function buildMarkSchema(targetObject, canvas) {
  return {
    name: 'mark_operations',
    schema: {
      type: 'object',
      properties: {
        marks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['dot', 'line'] },
              x: { type: 'integer', description: `min ${targetObject.bounds.xMin}, max ${targetObject.bounds.xMax}` },
              y: { type: 'integer', description: `min ${targetObject.bounds.yMin}, max ${targetObject.bounds.yMax}` },
              size: { type: 'number', description: `min ${targetObject.sizeRange[0]}, max ${targetObject.sizeRange[1]}` },
              color: { type: 'string', description: `hex color from palette: ${targetObject.palette.join(', ')}` },
              opacity: { type: 'number', description: `min ${targetObject.opacityRange[0]}, max ${targetObject.opacityRange[1]}` },
              x2: { type: 'integer', description: 'line endpoint x (only for type=line)' },
              y2: { type: 'integer', description: 'line endpoint y (only for type=line)' },
            },
            required: ['type', 'x', 'y', 'size', 'color', 'opacity'],
            additionalProperties: false,
          }
        }
      },
      required: ['marks'],
      additionalProperties: false,
    }
  };
}

async function generateMarks(params, strategy, targetObject, canvas) {
  const system = `You are an AI pointillist artist. Generate marks to build a specific object in a composition.`;
  
  const xMin = targetObject.bounds.xMin, xMax = targetObject.bounds.xMax;
  const yMin = targetObject.bounds.yMin, yMax = targetObject.bounds.yMax;
  const sMin = targetObject.sizeRange[0], sMax = targetObject.sizeRange[1];
  const oMin = targetObject.opacityRange[0], oMax = targetObject.opacityRange[1];
  
  const user = `Canvas: "${canvas.theme}"
Strategy: ${strategy.description}

Target object: ${targetObject.name}
Bounds: x must be ${xMin} to ${xMax}, y must be ${yMin} to ${yMax}
Palette: ${targetObject.palette.join(', ')} — ONLY use these exact hex colors
Size: ${sMin} to ${sMax}
Opacity: ${oMin} to ${oMax}

Generate ${strategy.markCount || params.markCount} marks.

CONSTRAINTS (violating any = invalid output):
- x: integer, min ${xMin}, max ${xMax}
- y: integer, min ${yMin}, max ${yMax}  
- size: number, min ${sMin}, max ${sMax}
- opacity: number, min ${oMin}, max ${oMax}
- color: ONLY from palette above
- type: "dot" or "line" only (NO "text" type)
- Cluster marks tightly (within ${params.clusterTightness}px) to form solid shapes
- Build form, not scatter

Output ONLY a JSON object, no markdown, no explanation:
{"marks":[{"type":"dot","x":0,"y":0,"size":3,"color":"#hex","opacity":0.5}, ...]}`;

  const raw = await callLLM(system, user, 0.9);
  const parsed = parseJSON(raw);
  const ops = parsed.marks || (Array.isArray(parsed) ? parsed : []);
  
  // Clamp values to enforce min/max (belt AND suspenders)
  return ops.filter(o => {
    return typeof o.x === 'number' && typeof o.y === 'number';
  }).map(o => ({
    op: 'add',
    type: o.type === 'line' ? 'line' : 'dot',
    x: Math.max(xMin, Math.min(xMax, Math.round(o.x))),
    y: Math.max(yMin, Math.min(yMax, Math.round(o.y))),
    size: Math.max(sMin, Math.min(sMax, o.size || sMin)),
    color: targetObject.palette.includes(o.color) ? o.color : targetObject.palette[0],
    opacity: Math.max(oMin, Math.min(oMax, o.opacity || oMin)),
    x2: o.type === 'line' ? Math.max(xMin, Math.min(xMax, Math.round(o.x2 || o.x))) : undefined,
    y2: o.type === 'line' ? Math.max(yMin, Math.min(yMax, Math.round(o.y2 || o.y))) : undefined,
    canvasId: canvas.id,
  })).slice(0, (strategy.markCount || params.markCount) * 1.5);
}

// === Main ===
async function main() {
  const config = parseArgs();
  let params = loadParams();
  
  if (config.reset) {
    params = loadParams(); // reset to defaults
    saveParams(params);
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    if (fs.existsSync(PLAN_FILE)) fs.unlinkSync(PLAN_FILE);
    console.log('🔄 Reset params, log, and plan\n');
  }
  
  console.log('🎨 Autoart v3 — Composition-Based Evolution\n');
  console.log(`Canvas: ${config.canvasId}`);
  console.log(`Iterations: ${config.maxIterations} | Delay: ${config.delay}ms | Dry run: ${config.dryRun}\n`);

  let goals = '';
  if (fs.existsSync(config.goalsFile)) {
    goals = fs.readFileSync(config.goalsFile, 'utf8');
    console.log(`📖 Goals loaded\n`);
  }

  const canvas = await fetchCanvas(config.canvasId);
  console.log(`Canvas: "${canvas.theme}"\n`);
  
  // Load or generate composition plan
  let plan = config.replan ? null : loadCompositionPlan();
  if (!plan) {
    plan = await generateCompositionPlan(canvas, goals);
  } else {
    console.log(`📋 Loaded existing plan: ${plan.objects.map(o => o.name).join(', ')}\n`);
  }
  
  // Get canvas marks
  const canvasAgents = (canvas.agents || []).map(a => a.id);
  let allMarks = await fetchAllMarks();
  let canvasMarks = allMarks.filter(m => canvasAgents.includes(m.agentId) || m.agentId === 'system');
  if (canvasMarks.length === 0) canvasMarks = allMarks;
  
  console.log(`${canvasMarks.length} marks on canvas\n`);
  
  // Update plan with current mark counts
  plan = updatePlanMarkCounts(plan, canvasMarks);
  console.log('Object progress:');
  for (const obj of plan.objects.sort((a, b) => a.priority - b.priority)) {
    const pct = obj.targetMarkCount > 0 ? (obj.currentMarkCount / obj.targetMarkCount * 100).toFixed(0) : '100';
    console.log(`  ${obj.name}: ${obj.currentMarkCount}/${obj.targetMarkCount} (${pct}%)`);
  }
  console.log();
  
  // Initial score (heuristic — instant)
  const VISION_EVERY = 5; // Vision scoring every Nth iteration
  console.log('Scoring initial state...');
  let currentScore = scoreHeuristic(canvasMarks, plan, plan.objects[0], []);
  console.log(`Initial (heuristic): ${currentScore.average}/10`);
  console.log(`  ${currentScore.reasoning}\n`);

  for (let i = 1; i <= config.maxIterations; i++) {
    console.log(`\n━━━ Iteration ${i}/${config.maxIterations} ━━━\n`);
    
    // Re-read goals each iteration
    if (fs.existsSync(config.goalsFile)) goals = fs.readFileSync(config.goalsFile, 'utf8');
    
    // Update plan mark counts
    plan = updatePlanMarkCounts(plan, canvasMarks);
    
    // Pick most underdone object
    const targetObject = pickMostUnderdoneObject(plan);
    const completion = targetObject.targetMarkCount > 0 ? (targetObject.currentMarkCount / targetObject.targetMarkCount * 100).toFixed(0) : '100';
    console.log(`Target object: ${targetObject.name} (${targetObject.currentMarkCount}/${targetObject.targetMarkCount} = ${completion}%)`);
    
    let iterParams, strategy, newOps;
    
    try {
      iterParams = mutateParams(params);
      console.log(`Params: size=${iterParams.sizeRange} opacity=${iterParams.opacityRange} marks=${iterParams.markCount}`);
      
      strategy = await generateStrategy(iterParams, plan, targetObject, canvas, goals);
      console.log(`Strategy: ${strategy.description}`);
      
      newOps = await generateMarks(iterParams, strategy, targetObject, canvas);
      console.log(`Generated ${newOps.length} marks for ${targetObject.name}`);
    } catch (err) {
      console.log(`⚠️  LLM/parse error: ${err.message?.slice(0, 100)}`);
      console.log(`  Skipping iteration...`);
      if (i < config.maxIterations) await new Promise(r => setTimeout(r, config.delay));
      continue;
    }
    
    if (newOps.length === 0) {
      console.log('⚠️  No marks generated, skipping');
      continue;
    }
    
    // Cache for revert
    let newMarkIds = [];
    
    // Push
    if (!config.dryRun) {
      const pushResult = await pushMarksBatch(newOps, config.apiKey);
      const added = pushResult.added || 0;
      console.log(`Pushed: +${added} marks`);
      if (pushResult.errors?.length) console.log(`  Errors: ${pushResult.errors.slice(0, 3).join(', ')}`);
      
      if (added === 0) {
        console.log('⚠️  No marks added, skipping scoring');
        continue;
      }
      
      // Get updated marks
      allMarks = await fetchAllMarks();
      canvasMarks = allMarks.filter(m => canvasAgents.includes(m.agentId) || m.agentId === 'system');
      if (canvasMarks.length === 0) canvasMarks = allMarks;
      
      newMarkIds = canvasMarks.slice(-added).map(m => m.id);
    } else {
      console.log(`[DRY RUN] Would push ${newOps.length} marks`);
    }
    
    // Score: heuristic every iteration, vision every VISION_EVERY
    let newScore;
    const useVision = (i % VISION_EVERY === 0);
    
    if (useVision) {
      try {
        console.log('🔍 Vision checkpoint...');
        newScore = await scoreCompositionWithVision(canvasMarks, canvas, goals, RENDER_TEMP);
        console.log(`  Vision: C=${newScore.coherence} D=${newScore.density} T=${newScore.thematic} I=${newScore.intentionality}`);
      } catch (err) {
        console.log(`⚠️  Vision failed, falling back to heuristic`);
        newScore = scoreHeuristic(canvasMarks, plan, targetObject, newOps);
      }
    } else {
      newScore = scoreHeuristic(canvasMarks, plan, targetObject, newOps);
    }
    
    const improvement = newScore.average - currentScore.average;
    console.log(`Score${useVision ? ' (vision)' : ''}: ${newScore.average.toFixed(2)}/10 (${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)})`);
    console.log(`  ${newScore.reasoning}`);
    
    // Keep or revert
    const kept = improvement >= 0;
    if (kept) {
      console.log(`✅ KEEP`);
      currentScore = newScore;
      params.sizeRange = [...iterParams.sizeRange];
      params.opacityRange = [...iterParams.opacityRange];
      params.markCount = iterParams.markCount;
      params.clusterTightness = iterParams.clusterTightness;
    } else {
      console.log(`❌ REVERT (${improvement.toFixed(2)})`);
      if (!config.dryRun && newMarkIds.length > 0) {
        const revertOps = newMarkIds.map(id => ({ op: 'remove', markId: id }));
        const revertResult = await pushMarksBatch(revertOps, config.apiKey);
        console.log(`  Reverted: -${revertResult.removed || 0} marks`);
        
        allMarks = await fetchAllMarks();
        canvasMarks = allMarks.filter(m => canvasAgents.includes(m.agentId) || m.agentId === 'system');
        if (canvasMarks.length === 0) canvasMarks = allMarks;
      }
    }
    
    params = updateParams(params, { object: targetObject.name }, currentScore, newScore, kept);
    saveParams(params);
    
    // Log
    const log = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) : { iterations: [] };
    log.iterations.push({
      iteration: params.totalIterations,
      timestamp: new Date().toISOString(),
      targetObject: targetObject.name,
      objectProgress: `${targetObject.currentMarkCount}/${targetObject.targetMarkCount}`,
      params: { size: iterParams.sizeRange, opacity: iterParams.opacityRange, marks: iterParams.markCount },
      strategy: strategy.description?.slice(0, 200),
      marksGenerated: newOps.length,
      scoreBefore: (currentScore.average - improvement).toFixed(2),
      scoreAfter: newScore.average.toFixed(2),
      improvement: improvement.toFixed(2),
      kept,
      reasoning: newScore.reasoning?.slice(0, 200),
      suggestions: newScore.suggestions?.slice(0, 200),
    });
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
    
    const wr = params.totalIterations > 0 ? (params.keptIterations / params.totalIterations * 100).toFixed(0) : '?';
    console.log(`📊 Win rate: ${params.keptIterations}/${params.totalIterations} (${wr}%) | Best: ${params.bestScore.toFixed(1)}/10\n`);
    
    if (i < config.maxIterations) await new Promise(r => setTimeout(r, config.delay));
  }
  
  console.log(`\n🏁 DONE`);
  console.log(`Final: ${currentScore.average.toFixed(2)}/10 | ${canvasMarks.length} marks`);
  console.log(`${params.totalIterations} iterations: ${params.keptIterations} kept, ${params.revertedIterations} reverted`);
  console.log(`Best: ${params.bestScore.toFixed(1)}/10`);
  
  // Save updated plan
  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });