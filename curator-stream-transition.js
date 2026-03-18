#!/usr/bin/env node

/**
 * curator-stream-transition.js — Continuous streaming transition
 * 
 * Instead of discrete steps that move ALL dots, this streams continuous
 * batches where each batch moves 50 random dots directly to their final
 * target. The viewer sees a constant rain of dots migrating.
 * 
 * The effect: dots peel off the old image and land on the new one,
 * like sand being blown from one shape to another.
 * 
 * Usage:
 *   node curator-stream-transition.js --prompt "description" [--batch-delay 2200]
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const SPRAWL_API = 'https://sprawl.place';
const SPRAWL_KEY = process.env.SPRAWL_API_KEY || 'sprl_DyXoIVwGM38U9MhGALslmLn8KZ5Tkm69';
const SPRAWL_RANGE = 400;
const BATCH_SIZE = 50;
const BATCH_DELAY = 2200;

function parseArgs() {
  const args = process.argv.slice(2);
  const config = { refImage: null, prompt: null, dotCount: 20000, batchDelay: BATCH_DELAY };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--ref': config.refImage = args[++i]; break;
      case '--prompt': config.prompt = args[++i]; break;
      case '--dots': config.dotCount = parseInt(args[++i]); break;
      case '--batch-delay': config.batchDelay = parseInt(args[++i]); break;
    }
  }
  if (!config.refImage && !config.prompt) {
    console.error('Usage: node curator-stream-transition.js --prompt "description"');
    process.exit(1);
  }
  return config;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sprawlFetch(ep, opts = {}) {
  const r = await fetch(SPRAWL_API + ep, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + SPRAWL_KEY, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (r.status === 429) {
    console.log('  ⚠️  Rate limited, waiting 10s...');
    await sleep(10000);
    return sprawlFetch(ep, opts);
  }
  return r;
}

// === SDXL ===
function generateWithSDXL(prompt, outputPath) {
  const { execSync } = require('child_process');
  const venvPython = path.join(__dirname, 'sdxl-env', 'bin', 'python3');
  const script = path.join(__dirname, 'generate-reference.py');
  if (!fs.existsSync(venvPython)) return false;
  try {
    execSync(`${venvPython} ${script} --prompt "${prompt.replace(/"/g, '\\"')}" --output "${outputPath}" --steps 4 --size 1024`, { timeout: 120000, stdio: 'pipe' });
    return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000;
  } catch { return false; }
}

// === Stippling ===
function buildDensityMap(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const map = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      row.push(1.0 - (0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]) / 255);
    }
    map.push(row);
  }
  return map;
}

function placeInitialDots(densityMap, w, h, count) {
  const dots = [];
  let attempts = 0;
  while (dots.length < count && attempts < count * 100) {
    attempts++;
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    if (Math.random() < densityMap[y][x]) dots.push({ x, y });
  }
  while (dots.length < count) dots.push({ x: Math.random() * w, y: Math.random() * h });
  return dots;
}

function lloydsRelaxation(dots, densityMap, w, h, iters = 15) {
  const DS = 4;
  const dsW = Math.floor(w / DS), dsH = Math.floor(h / DS);
  const dsDensity = [];
  for (let y = 0; y < dsH; y++) {
    const row = [];
    for (let x = 0; x < dsW; x++) row.push(densityMap[y * DS]?.[x * DS] || 0);
    dsDensity.push(row);
  }
  let dsDots = dots.map(d => ({ x: d.x / DS, y: d.y / DS }));
  for (let iter = 0; iter < iters; iter++) {
    const regions = dsDots.map(() => ({ sumX: 0, sumY: 0, sumW: 0 }));
    for (let y = 0; y < dsH; y++) {
      for (let x = 0; x < dsW; x++) {
        let minDist = Infinity, nearest = 0;
        for (let i = 0; i < dsDots.length; i++) {
          const dx = x - dsDots[i].x, dy = y - dsDots[i].y;
          const dist = dx * dx + dy * dy;
          if (dist < minDist) { minDist = dist; nearest = i; }
        }
        const wt = dsDensity[y][x];
        regions[nearest].sumX += x * wt;
        regions[nearest].sumY += y * wt;
        regions[nearest].sumW += wt;
      }
    }
    for (let i = 0; i < dsDots.length; i++) {
      const r = regions[i];
      if (r.sumW > 0) { dsDots[i].x = r.sumX / r.sumW; dsDots[i].y = r.sumY / r.sumW; }
    }
  }
  for (let i = 0; i < dots.length; i++) {
    dots[i].x = Math.max(0, Math.min(w - 1, dsDots[i].x * DS));
    dots[i].y = Math.max(0, Math.min(h - 1, dsDots[i].y * DS));
  }
  return dots;
}

function colorDots(dots, ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (const dot of dots) {
    const x = Math.round(Math.max(0, Math.min(w - 1, dot.x)));
    const y = Math.round(Math.max(0, Math.min(h - 1, dot.y)));
    const i = (y * w + x) * 4;
    dot.r = d[i]; dot.g = d[i+1]; dot.b = d[i+2];
    dot.color = '#' + ((1 << 24) + (dot.r << 16) + (dot.g << 8) + dot.b).toString(16).slice(1);
  }
  return dots;
}

async function processReference(imagePath, dotCount) {
  const img = await loadImage(imagePath);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  console.log('  Density map...');
  const dm = buildDensityMap(ctx, img.width, img.height);
  console.log('  Placing dots...');
  let dots = placeInitialDots(dm, img.width, img.height, dotCount);
  console.log('  Lloyd\'s relaxation...');
  dots = lloydsRelaxation(dots, dm, img.width, img.height, 15);
  console.log('  Coloring...');
  dots = colorDots(dots, ctx, img.width, img.height);
  for (const d of dots) {
    d.sprawlX = (d.x / img.width) * (SPRAWL_RANGE * 2) - SPRAWL_RANGE;
    d.sprawlY = (d.y / img.height) * (SPRAWL_RANGE * 2) - SPRAWL_RANGE;
    const lum = (0.299 * d.r + 0.587 * d.g + 0.114 * d.b) / 255;
    d.targetSize = Math.round((2 + lum * 1.5) * 10) / 10;
    d.targetOpacity = Math.round((0.4 + lum * 0.4) * 100) / 100;
  }
  return dots;
}

// === Matching (greedy nearest-neighbor with grid acceleration) ===
function matchDots(current, target) {
  const gridSize = 50;
  const targetByGrid = {};
  target.forEach((t, i) => {
    const k = `${Math.floor(t.sprawlX / gridSize)},${Math.floor(t.sprawlY / gridSize)}`;
    if (!targetByGrid[k]) targetByGrid[k] = [];
    targetByGrid[k].push(i);
  });
  const assignments = new Array(current.length).fill(-1);
  const used = new Set();
  for (let i = 0; i < current.length; i++) {
    const cx = current[i].x, cy = current[i].y;
    let bestJ = -1, bestDist = Infinity;
    const gx = Math.floor(cx / gridSize), gy = Math.floor(cy / gridSize);
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        const bucket = targetByGrid[`${gx+dx},${gy+dy}`];
        if (!bucket) continue;
        for (const j of bucket) {
          if (used.has(j)) continue;
          const ddx = cx - target[j].sprawlX, ddy = cy - target[j].sprawlY;
          const dist = ddx*ddx + ddy*ddy;
          if (dist < bestDist) { bestDist = dist; bestJ = j; }
        }
      }
    }
    if (bestJ === -1) {
      for (let j = 0; j < target.length; j++) {
        if (used.has(j)) continue;
        const ddx = cx - target[j].sprawlX, ddy = cy - target[j].sprawlY;
        const dist = ddx*ddx + ddy*ddy;
        if (dist < bestDist) { bestDist = dist; bestJ = j; }
      }
    }
    assignments[i] = bestJ;
    used.add(bestJ);
  }
  return assignments;
}

// Shuffle array in-place (Fisher-Yates)
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// === Main ===
async function main() {
  const config = parseArgs();
  
  let refPath = config.refImage;
  if (!refPath && config.prompt) {
    refPath = path.join(__dirname, 'curator-frames', `stream-${Date.now()}.png`);
    console.log(`🎨 Generating: "${config.prompt}"`);
    if (!generateWithSDXL(config.prompt, refPath)) { console.error('SDXL failed'); process.exit(1); }
    console.log('  ✅ Generated');
  }
  
  console.log('🔄 Voronoi stippling...');
  const targetDots = await processReference(refPath, config.dotCount);
  console.log(`  ${targetDots.length} targets\n`);
  
  console.log('📡 Fetching current marks...');
  const currentMarks = await (await sprawlFetch('/api/ext/marks')).json();
  console.log(`  ${currentMarks.length} on canvas\n`);
  
  if (currentMarks.length !== targetDots.length) {
    console.error(`Mismatch: ${currentMarks.length} vs ${targetDots.length}`);
    process.exit(1);
  }
  
  console.log('🔗 Matching...');
  const assignments = matchDots(currentMarks, targetDots);
  
  // Build move list: each entry is {markId, x, y, color, size, opacity}
  const moves = [];
  for (let i = 0; i < currentMarks.length; i++) {
    const j = assignments[i];
    if (j === -1) continue;
    const t = targetDots[j];
    moves.push({
      op: 'move',
      markId: currentMarks[i].id,
      x: Math.round(t.sprawlX * 100) / 100,
      y: Math.round(t.sprawlY * 100) / 100,
      color: t.color,
      size: t.targetSize,
      opacity: t.targetOpacity,
    });
  }
  
  // Shuffle so dots migrate from random positions (not top-to-bottom)
  shuffle(moves);
  
  const totalBatches = Math.ceil(moves.length / BATCH_SIZE);
  const estMinutes = Math.round(totalBatches * config.batchDelay / 60000);
  
  console.log(`\n🌊 STREAMING TRANSITION — ${moves.length} dots in ${totalBatches} batches (~${estMinutes} min)`);
  console.log(`   Each batch: 50 dots jump to final position`);
  console.log(`   Watch: open live-viewer.html\n`);
  
  let sent = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < moves.length; i += BATCH_SIZE) {
    const batch = moves.slice(i, i + BATCH_SIZE);
    await sprawlFetch('/api/ext/marks/batch', { method: 'POST', body: JSON.stringify({ ops: batch }) });
    sent += batch.length;
    
    if (sent % 1000 === 0 || sent === moves.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const pct = Math.round(sent / moves.length * 100);
      console.log(`  ${sent}/${moves.length} (${pct}%) — ${elapsed}s elapsed`);
    }
    
    if (i + BATCH_SIZE < moves.length) await sleep(config.batchDelay);
  }
  
  const totalSec = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n🏁 Done! ${sent} dots moved in ${totalSec}s`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
