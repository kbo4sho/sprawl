#!/usr/bin/env node

/**
 * curator-live.js — Living Canvas curator → Sprawl.place
 * 
 * Same brain as curator-loop.js, but pushes dots to sprawl.place
 * via the batch API instead of rendering local PNGs.
 * 
 * Usage:
 *   node curator-live.js --soul curator-soul-patient.md --journal curator-journal-live.json [--once] [--dots 20000] [--interval 30]
 * 
 * Env:
 *   OPENCLAW_GATEWAY_TOKEN — for LLM calls  
 *   SPRAWL_API_KEY — sprawl.place API key (sprl_...)
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

// === Config ===
const GATEWAY_URL = 'http://127.0.0.1:18789/v1/chat/completions';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '213e438e21c126522742c945fc4ceea2c3df9aa3aa63e66f';
const SPRAWL_API = 'https://sprawl.place';
const SPRAWL_KEY = process.env.SPRAWL_API_KEY || 'sprl_DyXoIVwGM38U9MhGALslmLn8KZ5Tkm69';
const MODEL = 'anthropic/claude-sonnet-4-5'; // cheaper for curator decisions
const CANVAS_SIZE = 800; // internal coord system
const SPRAWL_RANGE = 400; // maps to -400..+400 on sprawl

// Rate limit: 30 req/min, 50 ops/batch
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2200; // ~27 req/min, safe margin

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    soulFile: null,
    journalFile: null,
    intervalMinutes: 30,
    dotCount: 20000,
    once: false,
    skipSeed: false, // if marks already exist, skip initial seed
    transitionFrames: 1, // for live mode, we move dots directly (no frame-by-frame)
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--soul': config.soulFile = args[++i]; break;
      case '--journal': config.journalFile = args[++i]; break;
      case '--interval': config.intervalMinutes = parseInt(args[++i]); break;
      case '--dots': config.dotCount = parseInt(args[++i]); break;
      case '--once': config.once = true; break;
      case '--skip-seed': config.skipSeed = true; break;
    }
  }
  if (!config.soulFile || !config.journalFile) {
    console.error('Usage: node curator-live.js --soul <soul.md> --journal <journal.json> [--once] [--dots 20000]');
    process.exit(1);
  }
  return config;
}

// === Sprawl API ===
async function sprawlFetch(endpoint, opts = {}) {
  const url = `${SPRAWL_API}${endpoint}`;
  const r = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${SPRAWL_KEY}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  if (r.status === 429) {
    console.log('  ⚠️  Rate limited, waiting 10s...');
    await sleep(10000);
    return sprawlFetch(endpoint, opts); // retry
  }
  return r;
}

async function getMyMarks() {
  const r = await sprawlFetch('/api/ext/marks');
  return r.json();
}

async function batchOps(ops) {
  const r = await sprawlFetch('/api/ext/marks/batch', {
    method: 'POST',
    body: JSON.stringify({ ops }),
  });
  const data = await r.json();
  if (data.errors?.length > 0) {
    console.log(`  ⚠️  Batch errors: ${data.errors.slice(0, 3).join('; ')}`);
  }
  return data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Process batch ops in chunks respecting rate limits
async function processBatches(ops, label = 'batch') {
  const total = ops.length;
  const chunks = [];
  for (let i = 0; i < total; i += BATCH_SIZE) {
    chunks.push(ops.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`  📦 ${label}: ${total} ops in ${chunks.length} batches`);
  let processed = 0;
  
  for (let i = 0; i < chunks.length; i++) {
    const result = await batchOps(chunks[i]);
    processed += chunks[i].length;
    
    if ((i + 1) % 20 === 0 || i === chunks.length - 1) {
      console.log(`    ${processed}/${total} (batch ${i + 1}/${chunks.length})`);
    }
    
    if (i < chunks.length - 1) await sleep(BATCH_DELAY_MS);
  }
  
  return processed;
}

// === LLM ===
async function callLLM(system, user, temp = 0.7) {
  const r = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GATEWAY_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      temperature: temp,
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
  s = s.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const fb = s.indexOf('{'), lb = s.lastIndexOf('}');
  if (fb >= 0 && lb > fb) {
    try { return JSON.parse(s.slice(fb, lb + 1)); } catch (e) {
      let cleaned = s.slice(fb, lb + 1);
      cleaned = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      try { return JSON.parse(cleaned); } catch {}
    }
  }
  throw new Error('Failed to parse JSON from LLM');
}

// === Journal ===
function loadJournal(filepath) {
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, JSON.stringify({ epochs: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function saveJournal(filepath, journal) {
  fs.writeFileSync(filepath, JSON.stringify(journal, null, 2));
}

// === Reference Image ===
async function generateWithSDXL(prompt, outputPath) {
  const { execSync } = require('child_process');
  const venvPython = path.join(__dirname, 'sdxl-env', 'bin', 'python3');
  const script = path.join(__dirname, 'generate-reference.py');
  
  if (!fs.existsSync(venvPython)) return null;
  
  try {
    const cmd = `${venvPython} ${script} --prompt "${prompt.replace(/"/g, '\\"')}" --output "${outputPath}" --steps 4 --size 1024`;
    execSync(cmd, { timeout: 120000, stdio: 'pipe' });
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      return { title: prompt.slice(0, 60), artist: 'SDXL Turbo (local)', source: 'sdxl' };
    }
  } catch (err) {
    console.log(`  ⚠️  SDXL failed: ${err.message?.slice(0, 100)}`);
  }
  return null;
}

async function searchMetMuseum(query) {
  const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}&hasImages=true`);
  const data = await r.json();
  const ids = data.objectIDs || [];
  
  for (const oid of ids.slice(0, 10)) {
    try {
      const objR = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${oid}`);
      const obj = await objR.json();
      if (obj.isPublicDomain && obj.primaryImageSmall) {
        return { id: oid, title: obj.title, artist: obj.artistDisplayName || 'Unknown', imageUrl: obj.primaryImageSmall, source: 'met' };
      }
    } catch {}
  }
  return null;
}

async function acquireReference(decision, outputPath) {
  console.log('🎨 Generating reference with local SDXL...');
  const sdxlResult = await generateWithSDXL(decision.image_prompt, outputPath);
  if (sdxlResult) {
    console.log(`  ✅ Generated locally`);
    return sdxlResult;
  }
  
  console.log('🔍 Falling back to Met Museum...');
  const painting = await searchMetMuseum(decision.search_query || decision.reference_prompt);
  if (painting) {
    const r = await fetch(painting.imageUrl);
    fs.writeFileSync(outputPath, Buffer.from(await r.arrayBuffer()));
    console.log(`  ✅ "${painting.title}" by ${painting.artist}`);
    return painting;
  }
  return null;
}

// === Voronoi Stippling ===
function buildDensityMap(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const map = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      row.push(1.0 - (0.299 * imageData[i] + 0.587 * imageData[i+1] + 0.114 * imageData[i+2]) / 255);
    }
    map.push(row);
  }
  return map;
}

function placeInitialDots(densityMap, width, height, count) {
  const dots = [];
  let attempts = 0;
  while (dots.length < count && attempts < count * 100) {
    attempts++;
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    if (Math.random() < densityMap[y][x]) dots.push({ x, y });
  }
  while (dots.length < count) dots.push({ x: Math.random() * width, y: Math.random() * height });
  return dots;
}

function lloydsRelaxation(dots, densityMap, width, height, iterations = 15) {
  const DS = 4;
  const dsW = Math.floor(width / DS), dsH = Math.floor(height / DS);
  const dsDensity = [];
  for (let y = 0; y < dsH; y++) {
    const row = [];
    for (let x = 0; x < dsW; x++) row.push(densityMap[y * DS]?.[x * DS] || 0);
    dsDensity.push(row);
  }
  
  let dsDots = dots.map(d => ({ x: d.x / DS, y: d.y / DS }));
  
  for (let iter = 0; iter < iterations; iter++) {
    const regions = dsDots.map(() => ({ sumX: 0, sumY: 0, sumW: 0 }));
    for (let y = 0; y < dsH; y++) {
      for (let x = 0; x < dsW; x++) {
        let minDist = Infinity, nearest = 0;
        for (let i = 0; i < dsDots.length; i++) {
          const dx = x - dsDots[i].x, dy = y - dsDots[i].y;
          const dist = dx * dx + dy * dy;
          if (dist < minDist) { minDist = dist; nearest = i; }
        }
        const w = dsDensity[y][x];
        regions[nearest].sumX += x * w;
        regions[nearest].sumY += y * w;
        regions[nearest].sumW += w;
      }
    }
    for (let i = 0; i < dsDots.length; i++) {
      const r = regions[i];
      if (r.sumW > 0) { dsDots[i].x = r.sumX / r.sumW; dsDots[i].y = r.sumY / r.sumW; }
    }
  }
  
  for (let i = 0; i < dots.length; i++) {
    dots[i].x = Math.max(0, Math.min(width - 1, dsDots[i].x * DS));
    dots[i].y = Math.max(0, Math.min(height - 1, dsDots[i].y * DS));
  }
  return dots;
}

function colorDots(dots, ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height).data;
  for (const d of dots) {
    const x = Math.round(Math.max(0, Math.min(width - 1, d.x)));
    const y = Math.round(Math.max(0, Math.min(height - 1, d.y)));
    const i = (y * width + x) * 4;
    d.r = imageData[i]; d.g = imageData[i+1]; d.b = imageData[i+2];
    d.color = `#${((1 << 24) + (d.r << 16) + (d.g << 8) + d.b).toString(16).slice(1)}`;
  }
  return dots;
}

async function processReference(imagePath, dotCount) {
  const img = await loadImage(imagePath);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  console.log('  Building density map...');
  const densityMap = buildDensityMap(ctx, img.width, img.height);
  console.log('  Placing dots...');
  let dots = placeInitialDots(densityMap, img.width, img.height, dotCount);
  console.log('  Lloyd\'s relaxation...');
  dots = lloydsRelaxation(dots, densityMap, img.width, img.height, 15);
  console.log('  Coloring...');
  dots = colorDots(dots, ctx, img.width, img.height);
  
  // Convert image coords (0..imgW) → sprawl coords (-400..+400)
  for (const d of dots) {
    d.sprawlX = (d.x / img.width) * (SPRAWL_RANGE * 2) - SPRAWL_RANGE;
    d.sprawlY = (d.y / img.height) * (SPRAWL_RANGE * 2) - SPRAWL_RANGE;
  }
  
  return dots;
}

// === Dot Matching (Hungarian-lite: greedy nearest-neighbor) ===
function matchDots(current, target) {
  // Sort by grid cell for spatial locality
  const gridSize = 50;
  const gridKey = (x, y) => `${Math.floor(x / gridSize)},${Math.floor(y / gridSize)}`;
  
  const targetByGrid = {};
  target.forEach((t, i) => {
    const k = gridKey(t.sprawlX, t.sprawlY);
    if (!targetByGrid[k]) targetByGrid[k] = [];
    targetByGrid[k].push(i);
  });
  
  const assignments = new Array(current.length).fill(-1);
  const usedTarget = new Set();
  
  // For each current dot, find nearest unassigned target
  for (let i = 0; i < current.length; i++) {
    const cx = current[i].x ?? current[i].sprawlX;
    const cy = current[i].y ?? current[i].sprawlY;
    
    let bestJ = -1, bestDist = Infinity;
    
    // Check nearby grid cells first
    const gx = Math.floor(cx / gridSize), gy = Math.floor(cy / gridSize);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const k = `${gx + dx},${gy + dy}`;
        const bucket = targetByGrid[k];
        if (!bucket) continue;
        for (const j of bucket) {
          if (usedTarget.has(j)) continue;
          const ddx = cx - target[j].sprawlX, ddy = cy - target[j].sprawlY;
          const dist = ddx * ddx + ddy * ddy;
          if (dist < bestDist) { bestDist = dist; bestJ = j; }
        }
      }
    }
    
    // Fallback: scan all if nothing found nearby
    if (bestJ === -1) {
      for (let j = 0; j < target.length; j++) {
        if (usedTarget.has(j)) continue;
        const ddx = cx - target[j].sprawlX, ddy = cy - target[j].sprawlY;
        const dist = ddx * ddx + ddy * ddy;
        if (dist < bestDist) { bestDist = dist; bestJ = j; }
      }
    }
    
    assignments[i] = bestJ;
    usedTarget.add(bestJ);
  }
  
  return assignments;
}

// === Curator Decision ===
async function curatorDecide(soul, journal) {
  const epochs = journal.epochs || [];
  const recent = epochs.slice(-10);
  
  const recentHistory = recent.length > 0
    ? recent.map(e => `Epoch ${e.epoch}: "${e.reference_prompt}" (${e.transition_speed}). Note: ${e.note_to_self}`).join('\n')
    : 'This is the first epoch. The canvas is blank.';

  const now = new Date();
  const timeOfDay = now.getHours() < 6 ? 'deep night' : now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening';

  const system = `You are an AI art curator directing a living canvas — a never-ending painting made of ${dotCount} dots on sprawl.place that migrate between compositions.

Your personality:
${soul}

You must decide what the painting becomes next.`;

  const user = `Total epochs: ${epochs.length}

Recent:
${recentHistory}

Time: ${timeOfDay}

Decide the next transition. You control a pointillist painting. The dots will be rearranged via Voronoi stippling to match the reference image you describe.

Output ONLY JSON:
{
  "image_prompt": "detailed SDXL prompt — subject, style, lighting, palette, mood. Be vivid.",
  "search_query": "backup Met Museum search if SDXL fails",
  "reference_prompt": "short description of what painting becomes",
  "note_to_self": "why this choice — your future self reads this"
}`;

  const raw = await callLLM(system, user, 0.9);
  return parseJSON(raw);
}

// === Main ===
let dotCount;

async function main() {
  const config = parseArgs();
  dotCount = config.dotCount;
  const soul = fs.readFileSync(config.soulFile, 'utf8');
  let journal = loadJournal(config.journalFile);
  
  const outputDir = path.join(__dirname, 'curator-frames');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  console.log('🎨 Living Canvas — LIVE on sprawl.place\n');
  console.log(`Soul: ${config.soulFile}`);
  console.log(`Journal: ${config.journalFile} (${journal.epochs.length} epochs)`);
  console.log(`Dots: ${config.dotCount} | Interval: ${config.intervalMinutes}m`);
  console.log(`Mode: ${config.once ? 'single epoch' : 'continuous'}\n`);
  
  // Check current state on sprawl
  console.log('📡 Checking sprawl.place...');
  const existingMarks = await getMyMarks();
  console.log(`  ${existingMarks.length} marks currently on canvas`);
  
  const runEpoch = async () => {
    const epochNum = journal.epochs.length + 1;
    console.log(`\n━━━ Epoch ${epochNum} ━━━\n`);
    
    // Ask curator what's next
    console.log('🧠 Curator deciding...');
    let decision;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        decision = await curatorDecide(soul, journal);
        break;
      } catch (e) {
        console.log(`  ⚠️  Parse failed (attempt ${attempt + 1}/3)`);
        if (attempt === 2) throw e;
      }
    }
    console.log(`  → "${decision.reference_prompt}"`);
    console.log(`  SDXL: "${(decision.image_prompt || '').slice(0, 80)}..."`);
    console.log(`  Note: "${decision.note_to_self}"\n`);
    
    // Acquire reference
    const refPath = path.join(outputDir, `ref-live-epoch-${epochNum}.png`);
    const painting = await acquireReference(decision, refPath);
    if (!painting) {
      console.log('  ❌ No reference image. Skipping.');
      return;
    }
    
    // Voronoi stipple
    console.log('🔄 Voronoi stippling...');
    const targetDots = await processReference(refPath, config.dotCount);
    console.log(`  ${targetDots.length} target dots computed`);
    
    // Get current marks
    const currentMarks = await getMyMarks();
    
    if (currentMarks.length === 0 || currentMarks.length !== config.dotCount) {
      // First epoch or dot count changed: need to seed
      console.log(`\n🌱 Seeding ${config.dotCount} dots...`);
      
      // Clear existing if any
      if (currentMarks.length > 0) {
        console.log(`  Clearing ${currentMarks.length} existing marks...`);
        const removeOps = currentMarks.map(m => ({ op: 'remove', markId: m.id }));
        await processBatches(removeOps, 'clear');
      }
      
      // Add all dots — size and opacity encode luminance for readable compositions
      const addOps = targetDots.map(d => {
        // Luminance from color (0=dark, 1=bright)
        const lum = (0.299 * d.r + 0.587 * d.g + 0.114 * d.b) / 255;
        // Bright areas: larger, more opaque dots (they carry the image)
        // Dark areas: smaller, dimmer dots (negative space)
        const size = 2 + lum * 1.5;     // 2-3.5 range (tight — let density carry the image)
        const opacity = 0.4 + lum * 0.4; // 0.4-0.8 range
        return {
          op: 'add',
          type: 'dot',
          x: Math.round(d.sprawlX * 100) / 100,
          y: Math.round(d.sprawlY * 100) / 100,
          color: d.color,
          size: Math.round(size * 10) / 10,
          opacity: Math.round(opacity * 100) / 100,
        };
      });
      
      await processBatches(addOps, 'seed');
      console.log('  ✅ Seeded!');
      
    } else {
      // Transition: move existing dots to new positions
      console.log(`\n🎬 Transitioning ${currentMarks.length} dots...`);
      
      const assignments = matchDots(currentMarks, targetDots);
      
      const moveOps = [];
      for (let i = 0; i < currentMarks.length; i++) {
        const j = assignments[i];
        if (j === -1) continue;
        const t = targetDots[j];
        const lum = (0.299 * t.r + 0.587 * t.g + 0.114 * t.b) / 255;
        moveOps.push({
          op: 'move',
          markId: currentMarks[i].id,
          x: Math.round(t.sprawlX * 100) / 100,
          y: Math.round(t.sprawlY * 100) / 100,
          color: t.color,
          size: Math.round((2 + lum * 1.5) * 10) / 10,
          opacity: Math.round((0.4 + lum * 0.4) * 100) / 100,
        });
      }
      
      await processBatches(moveOps, 'transition');
      
      // Calculate avg distance
      let totalDist = 0;
      for (let i = 0; i < currentMarks.length; i++) {
        const j = assignments[i];
        if (j === -1) continue;
        const dx = currentMarks[i].x - targetDots[j].sprawlX;
        const dy = currentMarks[i].y - targetDots[j].sprawlY;
        totalDist += Math.sqrt(dx * dx + dy * dy);
      }
      console.log(`  Avg dot movement: ${(totalDist / currentMarks.length).toFixed(1)}px`);
    }
    
    // Journal
    journal.epochs.push({
      epoch: epochNum,
      timestamp: new Date().toISOString(),
      reference_prompt: decision.reference_prompt,
      image_prompt: decision.image_prompt,
      search_query: decision.search_query,
      painting_title: painting.title,
      painting_artist: painting.artist,
      source: painting.source,
      note_to_self: decision.note_to_self,
      dots_count: config.dotCount,
      live: true,
    });
    saveJournal(config.journalFile, journal);
    console.log(`\n📝 Journal updated (${journal.epochs.length} epochs)`);
    console.log('✅ Epoch complete — live on sprawl.place!');
  };
  
  if (config.once) {
    await runEpoch();
    console.log('\n🏁 Done.');
  } else {
    while (true) {
      await runEpoch();
      console.log(`\n⏳ Next epoch in ${config.intervalMinutes} minutes...`);
      await sleep(config.intervalMinutes * 60 * 1000);
    }
  }
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
