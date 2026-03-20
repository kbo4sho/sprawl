#!/usr/bin/env node

/**
 * demo-transition.js — Demonstrate dot migration between reference images
 * 
 * Takes a sequence of reference images, Voronoi-stipples each one,
 * then renders the transition frames showing dots migrating between positions.
 * Outputs a series of PNGs that can be viewed as a timelapse.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const OUTPUT_DIR = path.join(__dirname, 'demo-frames');
const DOT_COUNT = 8000;
const TRANSITION_FRAMES = parseInt(process.env.TRANSITION_FRAMES || '30');
const HOLD_FRAMES = parseInt(process.env.HOLD_FRAMES || '10');
const CANVAS_SIZE = 800;

// === Image Processing ===
function buildDensityMap(ctx, width, height) {
  const map = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const px = ctx.getImageData(x, y, 1, 1).data;
      const gray = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
      row.push(1.0 - gray / 255);
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
  // Fill remainder randomly if needed
  while (dots.length < count) {
    dots.push({ x: Math.random() * width, y: Math.random() * height });
  }
  return dots;
}

function lloydsRelaxation(dots, densityMap, width, height, iterations = 20) {
  const DS = 4;
  const dsW = Math.floor(width / DS), dsH = Math.floor(height / DS);
  
  const dsDensity = [];
  for (let y = 0; y < dsH; y++) {
    const row = [];
    for (let x = 0; x < dsW; x++) {
      row.push(densityMap[y * DS]?.[x * DS] || 0);
    }
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
      if (r.sumW > 0) {
        dsDots[i].x = r.sumX / r.sumW;
        dsDots[i].y = r.sumY / r.sumW;
      }
    }
  }
  
  for (let i = 0; i < dots.length; i++) {
    dots[i].x = Math.max(0, Math.min(width - 1, dsDots[i].x * DS));
    dots[i].y = Math.max(0, Math.min(height - 1, dsDots[i].y * DS));
  }
  return dots;
}

function colorDots(dots, ctx, width, height) {
  for (const d of dots) {
    const x = Math.round(Math.max(0, Math.min(width - 1, d.x)));
    const y = Math.round(Math.max(0, Math.min(height - 1, d.y)));
    const px = ctx.getImageData(x, y, 1, 1).data;
    d.r = px[0]; d.g = px[1]; d.b = px[2];
    d.color = `#${((1 << 24) + (px[0] << 16) + (px[1] << 8) + px[2]).toString(16).slice(1)}`;
  }
  return dots;
}

// === Dot matching between references ===
// Assign each dot in current to its nearest dot in target (greedy)
function matchDots(current, target) {
  const used = new Set();
  const assignments = [];
  
  // Sort by density (high density dots get first pick of targets)
  const indices = current.map((_, i) => i);
  
  for (const i of indices) {
    let bestJ = -1, bestDist = Infinity;
    for (let j = 0; j < target.length; j++) {
      if (used.has(j)) continue;
      const dx = current[i].x - target[j].x;
      const dy = current[i].y - target[j].y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; bestJ = j; }
    }
    assignments.push(bestJ);
    used.add(bestJ);
  }
  
  return assignments;
}

// === Easing ===
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// === Rendering ===
function renderFrame(dots, frameNum) {
  const c = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = c.getContext('2d');
  
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  
  for (const d of dots) {
    ctx.globalAlpha = d.opacity || 0.7;
    ctx.fillStyle = d.color || '#ffffff';
    ctx.beginPath();
    ctx.arc(d.screenX, d.screenY, d.size || 3, 0, Math.PI * 2);
    ctx.fill();
  }
  
  const filename = path.join(OUTPUT_DIR, `frame_${String(frameNum).padStart(5, '0')}.png`);
  fs.writeFileSync(filename, c.toBuffer('image/png'));
  return filename;
}

function imgToScreen(x, y, imgW, imgH) {
  return {
    screenX: (x / imgW) * CANVAS_SIZE,
    screenY: (y / imgH) * CANVAS_SIZE,
  };
}

// === Main ===
async function main() {
  const refs = process.argv.slice(2);
  if (refs.length < 2) {
    console.error('Usage: node demo-transition.js ref1.jpg ref2.jpg [ref3.jpg ...]');
    process.exit(1);
  }
  
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  // Clean old frames
  for (const f of fs.readdirSync(OUTPUT_DIR)) {
    if (f.endsWith('.png')) fs.unlinkSync(path.join(OUTPUT_DIR, f));
  }
  
  console.log(`🎬 Living Canvas Demo`);
  console.log(`References: ${refs.length} | Dots: ${DOT_COUNT}`);
  console.log(`Transition: ${TRANSITION_FRAMES} frames | Hold: ${HOLD_FRAMES} frames\n`);
  
  // Process all references
  const targets = [];
  for (const ref of refs) {
    console.log(`📷 Processing: ${path.basename(ref)}`);
    const img = await loadImage(ref);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    const densityMap = buildDensityMap(ctx, img.width, img.height);
    let dots = placeInitialDots(densityMap, img.width, img.height, DOT_COUNT);
    dots = lloydsRelaxation(dots, densityMap, img.width, img.height, 20);
    dots = colorDots(dots, ctx, img.width, img.height);
    
    targets.push({ dots, width: img.width, height: img.height, name: path.basename(ref) });
    console.log(`  ✅ ${dots.length} dots optimized\n`);
  }
  
  // Start with first reference
  let currentDots = targets[0].dots.map((d, i) => {
    const { screenX, screenY } = imgToScreen(d.x, d.y, targets[0].width, targets[0].height);
    // Assign progressive sizes based on density ordering
    const pct = i / DOT_COUNT;
    let size, opacity;
    if (pct < 0.3) { size = 5 + Math.random() * 3; opacity = 0.7 + Math.random() * 0.2; }
    else if (pct < 0.7) { size = 2.5 + Math.random() * 2.5; opacity = 0.4 + Math.random() * 0.3; }
    else { size = 1 + Math.random() * 1.5; opacity = 0.3 + Math.random() * 0.4; }
    
    return { x: d.x, y: d.y, screenX, screenY, color: d.color, r: d.r, g: d.g, b: d.b, size, opacity };
  });
  
  let frameNum = 0;
  
  // Hold first frame
  console.log(`⏸️  Holding: ${targets[0].name}`);
  for (let h = 0; h < HOLD_FRAMES; h++) {
    renderFrame(currentDots, frameNum++);
  }
  
  // Transitions
  for (let t = 1; t < targets.length; t++) {
    const target = targets[t];
    console.log(`🔄 Transitioning to: ${target.name}`);
    
    // Match current dots to target positions
    const targetScreen = target.dots.map(d => imgToScreen(d.x, d.y, target.width, target.height));
    const assignments = matchDots(
      currentDots.map(d => ({ x: d.screenX, y: d.screenY })),
      targetScreen.map(d => ({ x: d.screenX, y: d.screenY }))
    );
    
    // Store start positions and target positions + colors
    const startPositions = currentDots.map(d => ({
      screenX: d.screenX, screenY: d.screenY,
      r: d.r, g: d.g, b: d.b,
    }));
    
    // Render transition frames
    for (let f = 0; f < TRANSITION_FRAMES; f++) {
      const t_norm = easeInOutCubic((f + 1) / TRANSITION_FRAMES);
      
      for (let i = 0; i < currentDots.length; i++) {
        const j = assignments[i];
        const start = startPositions[i];
        const end = targetScreen[j];
        const endDot = target.dots[j];
        
        // Interpolate position
        currentDots[i].screenX = start.screenX + (end.screenX - start.screenX) * t_norm;
        currentDots[i].screenY = start.screenY + (end.screenY - start.screenY) * t_norm;
        
        // Interpolate color
        const r = Math.round(start.r + (endDot.r - start.r) * t_norm);
        const g = Math.round(start.g + (endDot.g - start.g) * t_norm);
        const b = Math.round(start.b + (endDot.b - start.b) * t_norm);
        currentDots[i].r = r;
        currentDots[i].g = g;
        currentDots[i].b = b;
        currentDots[i].color = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
      }
      
      renderFrame(currentDots, frameNum++);
      if ((f + 1) % 10 === 0) console.log(`  Frame ${f + 1}/${TRANSITION_FRAMES}`);
    }
    
    // Hold completed form
    console.log(`⏸️  Holding: ${target.name}`);
    for (let h = 0; h < HOLD_FRAMES; h++) {
      renderFrame(currentDots, frameNum++);
    }
  }
  
  console.log(`\n🏁 Done! ${frameNum} frames in ${OUTPUT_DIR}/`);
  console.log(`\nTo create video:\nffmpeg -framerate 15 -i ${OUTPUT_DIR}/frame_%05d.png -c:v libx264 -pix_fmt yuv420p demo-transition.mp4`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
