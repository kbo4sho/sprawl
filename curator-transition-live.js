#!/usr/bin/env node

/**
 * curator-transition-live.js — Slow live transition on sprawl.place
 * 
 * Moves dots gradually over N steps so viewers see them drifting in real time.
 * Each step moves all dots a fraction closer to the target, with WebSocket
 * broadcasts making it visible to anyone watching.
 * 
 * Usage:
 *   node curator-transition-live.js --ref <image> [--steps 20] [--step-delay 8]
 *   node curator-transition-live.js --prompt "a stormy sea with lighthouse" [--steps 20]
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const SPRAWL_API = 'https://sprawl.place';
const SPRAWL_KEY = process.env.SPRAWL_API_KEY || 'sprl_DyXoIVwGM38U9MhGALslmLn8KZ5Tkm69';
const GATEWAY_URL = 'http://127.0.0.1:18789/v1/chat/completions';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '213e438e21c126522742c945fc4ceea2c3df9aa3aa63e66f';
const SPRAWL_RANGE = 400;
const BATCH_SIZE = 50;
const BATCH_DELAY = 2200; // ms between batches (rate limit safe)

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    refImage: null,
    prompt: null,
    steps: 20,           // number of intermediate positions
    stepDelaySeconds: 8,  // pause between steps (on top of batch time)
    dotCount: 20000,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--ref': config.refImage = args[++i]; break;
      case '--prompt': config.prompt = args[++i]; break;
      case '--steps': config.steps = parseInt(args[++i]); break;
      case '--step-delay': config.stepDelaySeconds = parseInt(args[++i]); break;
      case '--dots': config.dotCount = parseInt(args[++i]); break;
    }
  }
  if (!config.refImage && !config.prompt) {
    console.error('Usage: node curator-transition-live.js --prompt "description" [--steps 20] [--step-delay 8]');
    console.error('   or: node curator-transition-live.js --ref path/to/image.png');
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
    d.targetSize = Math.round((2 + lum * 6) * 10) / 10;
    d.targetOpacity = Math.round((0.3 + lum * 0.6) * 100) / 100;
  }
  return dots;
}

// === Matching ===
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

function easeInOutCubic(t) {
  return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2;
}

function lerpColor(r1,g1,b1, r2,g2,b2, t) {
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return '#' + ((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v>>16)&255, (v>>8)&255, v&255];
}

// === Main ===
async function main() {
  const config = parseArgs();
  
  // Get reference image
  let refPath = config.refImage;
  if (!refPath && config.prompt) {
    refPath = path.join(__dirname, 'curator-frames', `transition-${Date.now()}.png`);
    console.log(`🎨 Generating reference: "${config.prompt}"`);
    const ok = generateWithSDXL(config.prompt, refPath);
    if (!ok) { console.error('SDXL failed'); process.exit(1); }
    console.log('  ✅ Generated');
  }
  
  // Process target
  console.log('🔄 Voronoi stippling target...');
  const targetDots = await processReference(refPath, config.dotCount);
  console.log(`  ${targetDots.length} target dots\n`);
  
  // Get current marks
  console.log('📡 Fetching current marks...');
  const currentMarks = await (await sprawlFetch('/api/ext/marks')).json();
  console.log(`  ${currentMarks.length} marks on canvas\n`);
  
  if (currentMarks.length !== targetDots.length) {
    console.error(`Mark count mismatch: ${currentMarks.length} vs ${targetDots.length}. Need same count.`);
    process.exit(1);
  }
  
  // Match
  console.log('🔗 Matching dots...');
  const assignments = matchDots(currentMarks, targetDots);
  
  // Calculate total distance
  let totalDist = 0;
  for (let i = 0; i < currentMarks.length; i++) {
    const j = assignments[i];
    const dx = currentMarks[i].x - targetDots[j].sprawlX;
    const dy = currentMarks[i].y - targetDots[j].sprawlY;
    totalDist += Math.sqrt(dx*dx + dy*dy);
  }
  console.log(`  Avg dot distance: ${(totalDist / currentMarks.length).toFixed(1)}px\n`);
  
  // Pre-compute start state
  const starts = currentMarks.map(m => ({
    id: m.id,
    x: m.x, y: m.y,
    rgb: hexToRgb(m.color),
    size: m.size,
    opacity: m.opacity,
  }));
  
  // Execute transition in steps
  const STEPS = config.steps;
  const estBatchTime = Math.ceil(currentMarks.length / BATCH_SIZE) * BATCH_DELAY / 1000;
  const totalTime = STEPS * (estBatchTime + config.stepDelaySeconds);
  
  console.log(`🎬 LIVE TRANSITION — ${STEPS} steps over ~${Math.round(totalTime / 60)} minutes`);
  console.log(`   Watch it: https://sprawl.place\n`);
  
  for (let step = 1; step <= STEPS; step++) {
    const t = easeInOutCubic(step / STEPS);
    console.log(`━━━ Step ${step}/${STEPS} (t=${t.toFixed(3)}) ━━━`);
    
    const ops = [];
    for (let i = 0; i < starts.length; i++) {
      const j = assignments[i];
      const s = starts[i];
      const tgt = targetDots[j];
      
      const x = Math.round((s.x + (tgt.sprawlX - s.x) * t) * 100) / 100;
      const y = Math.round((s.y + (tgt.sprawlY - s.y) * t) * 100) / 100;
      const [tr, tg, tb] = [tgt.r, tgt.g, tgt.b];
      const color = lerpColor(s.rgb[0], s.rgb[1], s.rgb[2], tr, tg, tb, t);
      const size = Math.round((s.size + (tgt.targetSize - s.size) * t) * 10) / 10;
      const opacity = Math.round((s.opacity + (tgt.targetOpacity - s.opacity) * t) * 100) / 100;
      
      ops.push({ op: 'move', markId: s.id, x, y, color, size, opacity });
    }
    
    // Send in batches
    let sent = 0;
    for (let i = 0; i < ops.length; i += BATCH_SIZE) {
      const batch = ops.slice(i, i + BATCH_SIZE);
      await sprawlFetch('/api/ext/marks/batch', { method: 'POST', body: JSON.stringify({ ops: batch }) });
      sent += batch.length;
      if (sent % 2000 === 0) process.stdout.write(`  ${sent}/${ops.length}\n`);
      if (i + BATCH_SIZE < ops.length) await sleep(BATCH_DELAY);
    }
    console.log(`  ✅ ${sent} marks moved`);
    
    if (step < STEPS) {
      console.log(`  ⏳ Pausing ${config.stepDelaySeconds}s...\n`);
      await sleep(config.stepDelaySeconds * 1000);
    }
  }
  
  console.log('\n🏁 Transition complete!');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
