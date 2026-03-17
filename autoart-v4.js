#!/usr/bin/env node

/**
 * autoart-v4.js - Weighted Voronoi Stippling for Sprawl
 * 
 * Pipeline:
 * 1. Generate reference image via OpenAI gpt-image-1
 * 2. Weighted Voronoi stippling (Lloyd's relaxation)
 * 3. Progressive placement (coarse → medium → fine)
 * 4. Optional LLM taste check + refinement
 */

const fs = require('fs');
const path = require('path');

const SPRAWL_API = 'https://sprawl.place';
const GATEWAY_URL = 'http://127.0.0.1:18789/v1';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const REFERENCE_IMAGE = '/tmp/autoart_reference.png';
const RENDER_OUTPUT = '/tmp/autoart_render.png';

// === CLI Args ===
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    canvasId: null,
    apiKey: null,
    dots: 3000,
    rounds: 3,
    delay: 2000,
    skipImage: false,
    skipTaste: false,
    dryRun: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--canvas': config.canvasId = args[++i]; break;
      case '--key': config.apiKey = args[++i]; break;
      case '--dots': config.dots = parseInt(args[++i], 10); break;
      case '--rounds': config.rounds = parseInt(args[++i], 10); break;
      case '--delay': config.delay = parseInt(args[++i], 10); break;
      case '--skip-image': config.skipImage = true; break;
      case '--skip-taste': config.skipTaste = true; break;
      case '--dry-run': config.dryRun = true; break;
    }
  }
  
  if (!config.canvasId || !config.apiKey) {
    console.error('Usage: node autoart-v4.js --canvas <id> --key <sprl_xxx> [--dots 3000] [--rounds 3] [--delay 2000] [--skip-image] [--skip-taste] [--dry-run]');
    process.exit(1);
  }
  
  if (!GATEWAY_TOKEN) {
    console.error('Missing OPENCLAW_GATEWAY_TOKEN env var');
    process.exit(1);
  }
  
  return config;
}

// === API: Sprawl ===
async function fetchCanvas(id) {
  const r = await fetch(`${SPRAWL_API}/api/canvas/${id}`);
  if (!r.ok) throw new Error(`Failed to fetch canvas: ${r.statusText}`);
  return r.json();
}

async function fetchCanvasMarks(id) {
  const r = await fetch(`${SPRAWL_API}/api/canvas/${id}/marks`);
  if (!r.ok) throw new Error(`Failed to fetch marks: ${r.statusText}`);
  return r.json();
}

async function pushMarksBatch(canvasId, operations, apiKey) {
  // Sprawl API expects ops array with canvasId on each op
  const ops = operations.map(o => ({ ...o, canvasId }));
  const r = await fetch(`${SPRAWL_API}/api/ext/marks/batch`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ops }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Failed to push marks: ${r.statusText} - ${body}`);
  }
  return r.json();
}

// === API: Gateway (OpenAI Image Gen) ===
async function generateReferenceImage(theme, spatialGuide) {
  console.log('🎨 Generating reference image...');
  
  // Build a rich prompt from the canvas theme
  const prompt = `Create a high-contrast artistic composition for the theme: "${theme}". ${spatialGuide ? `Spatial guide: ${spatialGuide}. ` : ''}Style: bold shapes, clear forms, high contrast between light and dark areas. Avoid photorealism — favor clear, defined regions suitable for pointillist rendering.`;
  
  console.log(`  Prompt: ${prompt.slice(0, 120)}...`);
  
  const r = await fetch(`${GATEWAY_URL}/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
  });
  
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Image generation failed: ${r.statusText} - ${errText}`);
  }
  
  const data = await r.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image data in response');
  
  const buffer = Buffer.from(b64, 'base64');
  fs.writeFileSync(REFERENCE_IMAGE, buffer);
  console.log(`  ✅ Saved to ${REFERENCE_IMAGE}`);
  
  return REFERENCE_IMAGE;
}

// === API: Gateway (LLM Taste Check) ===
async function callLLM(system, user, temp = 0.7) {
  const r = await fetch(`${GATEWAY_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      temperature: temp,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  
  const data = await r.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || '';
}

function parseJSON(text) {
  let s = text.trim();
  if (s.startsWith('```')) s = s.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  const fb = s.indexOf('{'), lb = s.lastIndexOf('}');
  if (fb >= 0 && lb > fb) {
    try { return JSON.parse(s.slice(fb, lb + 1)); } catch {}
  }
  throw new Error('Failed to parse JSON from LLM');
}

// === Image Processing (canvas package) ===
async function loadImage(imagePath) {
  let Canvas;
  try {
    Canvas = require('canvas');
  } catch (err) {
    console.error('❌ Missing "canvas" package. Install with: npm install canvas');
    throw new Error('canvas package not found');
  }
  
  const { createCanvas, loadImage: canvasLoadImage } = Canvas;
  const img = await canvasLoadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, width: img.width, height: img.height };
}

function getPixel(ctx, x, y, width, height) {
  if (x < 0 || x >= width || y < 0 || y >= height) return { r: 0, g: 0, b: 0 };
  const data = ctx.getImageData(x, y, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2] };
}

function toGrayscale(r, g, b) {
  // Standard luminance formula
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function buildDensityMap(ctx, width, height) {
  console.log('📊 Building density map...');
  const densityMap = [];
  
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const px = getPixel(ctx, x, y, width, height);
      const gray = toGrayscale(px.r, px.g, px.b);
      // Invert: darker pixels = higher density
      row.push(1.0 - (gray / 255));
    }
    densityMap.push(row);
  }
  
  return densityMap;
}

// === Weighted Voronoi Stippling ===
function placeInitialDots(densityMap, width, height, count) {
  console.log(`🎲 Placing ${count} initial dots via rejection sampling...`);
  const dots = [];
  const maxAttempts = count * 100;
  let attempts = 0;
  
  while (dots.length < count && attempts < maxAttempts) {
    attempts++;
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const density = densityMap[y][x];
    
    // Rejection sampling: accept with probability = density
    if (Math.random() < density) {
      dots.push({ x, y });
    }
  }
  
  if (dots.length < count) {
    console.log(`  ⚠️  Only placed ${dots.length}/${count} dots after ${maxAttempts} attempts`);
  }
  
  return dots;
}

function computeCentroid(region, densityMap) {
  // Weighted centroid: Σ(density * position) / Σ(density)
  let sumX = 0, sumY = 0, sumWeight = 0;
  
  for (const { x, y } of region) {
    const w = densityMap[y]?.[x] || 0;
    sumX += x * w;
    sumY += y * w;
    sumWeight += w;
  }
  
  if (sumWeight === 0) {
    // Fallback: unweighted centroid
    sumX = region.reduce((s, p) => s + p.x, 0);
    sumY = region.reduce((s, p) => s + p.y, 0);
    return { x: sumX / region.length, y: sumY / region.length };
  }
  
  return { x: sumX / sumWeight, y: sumY / sumWeight };
}

function lloydsRelaxation(dots, densityMap, width, height, iterations = 30) {
  // Downsample for Voronoi computation — full res is O(pixels×dots) per iteration
  const DS = 4; // Downsample factor: 1024→256
  const dsW = Math.floor(width / DS);
  const dsH = Math.floor(height / DS);
  
  // Build downsampled density map
  const dsDensity = [];
  for (let y = 0; y < dsH; y++) {
    const row = [];
    for (let x = 0; x < dsW; x++) {
      row.push(densityMap[y * DS]?.[x * DS] || 0);
    }
    dsDensity.push(row);
  }
  
  // Scale dots to downsampled space
  let dsDots = dots.map(d => ({ x: d.x / DS, y: d.y / DS }));
  
  console.log(`🔄 Running Lloyd's relaxation (${iterations} iters on ${dsW}×${dsH} grid, ${dots.length} dots)...`);
  
  for (let iter = 0; iter < iterations; iter++) {
    // 1. Assign each downsampled pixel to nearest dot
    // Use a grid acceleration structure
    const regions = dsDots.map(() => ({ sumX: 0, sumY: 0, sumW: 0, count: 0 }));
    
    for (let y = 0; y < dsH; y++) {
      for (let x = 0; x < dsW; x++) {
        let minDist = Infinity;
        let nearestIdx = 0;
        
        for (let i = 0; i < dsDots.length; i++) {
          const dx = x - dsDots[i].x;
          const dy = y - dsDots[i].y;
          const dist = dx * dx + dy * dy;
          if (dist < minDist) {
            minDist = dist;
            nearestIdx = i;
          }
        }
        
        const w = dsDensity[y][x];
        regions[nearestIdx].sumX += x * w;
        regions[nearestIdx].sumY += y * w;
        regions[nearestIdx].sumW += w;
        regions[nearestIdx].count++;
      }
    }
    
    // 2. Move each dot to weighted centroid
    let iterMovement = 0;
    for (let i = 0; i < dsDots.length; i++) {
      const r = regions[i];
      if (r.sumW === 0) continue;
      
      const cx = r.sumX / r.sumW;
      const cy = r.sumY / r.sumW;
      const dx = cx - dsDots[i].x;
      const dy = cy - dsDots[i].y;
      iterMovement += Math.sqrt(dx * dx + dy * dy);
      
      dsDots[i].x = cx;
      dsDots[i].y = cy;
    }
    
    if ((iter + 1) % 10 === 0) {
      const avgMove = (iterMovement / dsDots.length * DS).toFixed(1);
      console.log(`  Iteration ${iter + 1}/${iterations} — avg movement: ${avgMove}px`);
    }
  }
  
  // Scale dots back to full resolution
  for (let i = 0; i < dots.length; i++) {
    dots[i].x = Math.max(0, Math.min(width - 1, dsDots[i].x * DS));
    dots[i].y = Math.max(0, Math.min(height - 1, dsDots[i].y * DS));
  }
  
  console.log(`  ✅ Relaxation complete`);
  return dots;
}

function colorDots(dots, ctx, width, height) {
  console.log('🎨 Sampling colors from reference image...');
  
  for (const dot of dots) {
    const x = Math.round(dot.x);
    const y = Math.round(dot.y);
    const px = getPixel(ctx, x, y, width, height);
    dot.color = `#${((1 << 24) + (px.r << 16) + (px.g << 8) + px.b).toString(16).slice(1)}`;
  }
  
  return dots;
}

// === Progressive Placement ===
function sortDotsByImportance(dots, densityMap, width, height) {
  // Sort by density at dot position (high density = important)
  return dots.sort((a, b) => {
    const aY = Math.round(a.y), aX = Math.round(a.x);
    const bY = Math.round(b.y), bX = Math.round(b.x);
    const aDensity = densityMap[aY]?.[aX] || 0;
    const bDensity = densityMap[bY]?.[bX] || 0;
    return bDensity - aDensity; // High to low
  });
}

function mapToCanvasCoords(dots, imgWidth, imgHeight) {
  // Image space: 0..1024 → Canvas space: -400..400
  const scaleX = 800 / imgWidth;
  const scaleY = 800 / imgHeight;
  
  return dots.map(d => ({
    ...d,
    x: Math.round((d.x * scaleX) - 400),
    y: Math.round((d.y * scaleY) - 400),
  }));
}

function buildProgressiveRounds(dots, config) {
  console.log('\n📦 Building progressive rounds...');
  
  // Round 1: 30% — large marks, high opacity
  const round1Count = Math.floor(dots.length * 0.30);
  const round1 = dots.slice(0, round1Count).map(d => ({
    op: 'add',
    type: 'dot',
    x: d.x,
    y: d.y,
    size: 6 + Math.random() * 4, // 6-10
    color: d.color,
    opacity: 0.7 + Math.random() * 0.2, // 0.7-0.9
  }));
  
  // Round 2: 40% — medium marks
  const round2Count = Math.floor(dots.length * 0.40);
  const round2 = dots.slice(round1Count, round1Count + round2Count).map(d => ({
    op: 'add',
    type: 'dot',
    x: d.x,
    y: d.y,
    size: 3 + Math.random() * 3, // 3-6
    color: d.color,
    opacity: 0.4 + Math.random() * 0.4, // 0.4-0.8
  }));
  
  // Round 3: remaining 30% — fine marks
  const round3 = dots.slice(round1Count + round2Count).map(d => ({
    op: 'add',
    type: 'dot',
    x: d.x,
    y: d.y,
    size: 1 + Math.random() * 2, // 1-3
    color: d.color,
    opacity: 0.2 + Math.random() * 0.6, // 0.2-0.8
  }));
  
  console.log(`  Round 1 (coarse): ${round1.length} marks`);
  console.log(`  Round 2 (medium): ${round2.length} marks`);
  console.log(`  Round 3 (fine): ${round3.length} marks`);
  
  return [round1, round2, round3];
}

async function pushRound(roundMarks, canvasId, apiKey, delay, roundNum, dryRun) {
  console.log(`\n🚀 Pushing Round ${roundNum}...`);
  
  const BATCH_SIZE = 40; // API limit
  const batches = [];
  for (let i = 0; i < roundMarks.length; i += BATCH_SIZE) {
    batches.push(roundMarks.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`  ${batches.length} batches (${BATCH_SIZE} marks each)`);
  
  let totalPushed = 0;
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    if (dryRun) {
      console.log(`  [DRY RUN] Batch ${i + 1}/${batches.length}: ${batch.length} marks`);
      totalPushed += batch.length;
    } else {
      try {
        const result = await pushMarksBatch(canvasId, batch, apiKey);
        const added = result.added || 0;
        totalPushed += added;
        console.log(`  Batch ${i + 1}/${batches.length}: +${added} marks`);
        
        if (result.errors?.length) {
          console.log(`    Errors: ${result.errors.slice(0, 2).join(', ')}`);
        }
      } catch (err) {
        console.log(`  ⚠️  Batch ${i + 1} failed: ${err.message}`);
      }
    }
    
    // Delay between batches
    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, delay));
    }
  }
  
  console.log(`  ✅ Round ${roundNum} complete: ${totalPushed} marks pushed`);
  return totalPushed;
}

// === Rendering for Taste Check ===
async function renderCanvas(marks) {
  console.log('🖼️  Rendering canvas...');
  
  const { createCanvas } = require('canvas');
  const width = 800, height = 800;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, width, height);
  
  // Map canvas coords -400..400 to 0..800
  const mapX = x => (x + 400);
  const mapY = y => (y + 400);
  
  for (const m of marks) {
    ctx.globalAlpha = m.opacity || 0.5;
    ctx.fillStyle = m.color || '#ffffff';
    ctx.beginPath();
    ctx.arc(mapX(m.x), mapY(m.y), m.size || 3, 0, Math.PI * 2);
    ctx.fill();
  }
  
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(RENDER_OUTPUT, buffer);
  console.log(`  ✅ Saved to ${RENDER_OUTPUT}`);
  
  return RENDER_OUTPUT;
}

async function tasteCheck(canvas, marks) {
  console.log('\n🧐 Running LLM taste check...');
  
  await renderCanvas(marks);
  
  const system = `You are an art critic evaluating a pointillist canvas artwork. Score 1-10 on coherence, density, thematic fit, and intentionality. Be harsh — most work is 4-6.`;
  
  const user = `Canvas theme: "${canvas.theme}"
Total marks: ${marks.length}

Score the composition:
1. coherence — do the dots form recognizable shapes?
2. density — appropriate density and distribution?
3. thematic — does it match "${canvas.theme}"?
4. intentionality — deliberate or random?

Output ONLY JSON:
{
  "coherence": N,
  "density": N,
  "thematic": N,
  "intentionality": N,
  "score": average,
  "reasoning": "brief critique",
  "suggestions": "what would improve it most"
}`;

  const raw = await callLLM(system, user, 0.3);
  const critique = parseJSON(raw);
  critique.score = (critique.coherence + critique.density + critique.thematic + critique.intentionality) / 4;
  
  console.log(`  Score: ${critique.score.toFixed(1)}/10`);
  console.log(`  C=${critique.coherence} D=${critique.density} T=${critique.thematic} I=${critique.intentionality}`);
  console.log(`  Reasoning: ${critique.reasoning}`);
  
  if (critique.suggestions) {
    console.log(`  Suggestions: ${critique.suggestions}`);
  }
  
  return critique;
}

// === Main Pipeline ===
async function main() {
  const config = parseArgs();
  
  console.log('🧱 Autoart v4 — Weighted Voronoi Stippling\n');
  console.log(`Canvas: ${config.canvasId}`);
  console.log(`Dots: ${config.dots} | Rounds: ${config.rounds} | Delay: ${config.delay}ms`);
  console.log(`Dry run: ${config.dryRun}\n`);
  
  // Fetch canvas info
  const canvas = await fetchCanvas(config.canvasId);
  console.log(`Canvas: "${canvas.theme}"`);
  if (canvas.spatialGuide) console.log(`Spatial guide: ${canvas.spatialGuide}`);
  console.log();
  
  // === Phase 1: Reference Image Generation ===
  let imagePath = REFERENCE_IMAGE;
  if (!config.skipImage) {
    imagePath = await generateReferenceImage(canvas.theme, canvas.spatialGuide);
  } else if (fs.existsSync(REFERENCE_IMAGE)) {
    console.log(`📷 Using existing reference image: ${REFERENCE_IMAGE}`);
  } else {
    console.error('❌ No reference image found. Run without --skip-image first.');
    process.exit(1);
  }
  
  // === Phase 2: Weighted Voronoi Stippling ===
  console.log('\n━━━ Phase 2: Voronoi Stippling ━━━\n');
  
  const { ctx, width, height } = await loadImage(imagePath);
  const densityMap = buildDensityMap(ctx, width, height);
  
  let dots = placeInitialDots(densityMap, width, height, config.dots);
  dots = lloydsRelaxation(dots, densityMap, width, height, 30);
  dots = colorDots(dots, ctx, width, height);
  
  console.log(`✅ ${dots.length} dots optimized and colored`);
  
  // Sort by importance (density)
  dots = sortDotsByImportance(dots, densityMap, width, height);
  
  // Map to canvas coordinates
  dots = mapToCanvasCoords(dots, width, height);
  
  // === Phase 3: Progressive Placement ===
  console.log('\n━━━ Phase 3: Progressive Placement ━━━');
  
  const rounds = buildProgressiveRounds(dots, config);
  
  for (let i = 0; i < rounds.length; i++) {
    await pushRound(rounds[i], config.canvasId, config.apiKey, config.delay, i + 1, config.dryRun);
  }
  
  // === Phase 4: LLM Taste Check ===
  if (!config.skipTaste && !config.dryRun) {
    console.log('\n━━━ Phase 4: Taste Check ━━━');
    
    const allMarks = await fetchCanvasMarks(config.canvasId);
    const critique = await tasteCheck(canvas, allMarks);
    
    if (critique.score < 6) {
      console.log(`\n⚠️  Score below 6. Suggestions: ${critique.suggestions}`);
      console.log('Consider generating additional targeted marks based on critique.');
    } else {
      console.log('\n✅ Composition meets quality threshold');
    }
  }
  
  console.log('\n🏁 Done!');
  console.log(`Total dots placed: ${dots.length}`);
  console.log(`Reference image: ${imagePath}`);
  if (!config.dryRun) {
    console.log(`Canvas: https://sprawl.place/canvas/${config.canvasId}`);
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
