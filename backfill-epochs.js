#!/usr/bin/env node
/**
 * Backfill epochs from existing reference images + journal data.
 * Re-processes references via Voronoi and POSTs to sprawl.place epochs API.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const SPRAWL_API = 'https://sprawl.place';
const SPRAWL_KEY = process.env.SPRAWL_API_KEY || 'sprl_DyXoIVwGM38U9MhGALslmLn8KZ5Tkm69';
const SPRAWL_RANGE = 400;
const DOT_COUNT = 20000;

const journal = JSON.parse(fs.readFileSync(path.join(__dirname, 'curator-journal-live.json'), 'utf8'));

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

function placeInitialDots(dm, w, h, count) {
  const dots = [];
  let att = 0;
  while (dots.length < count && att < count * 100) {
    att++;
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    if (Math.random() < dm[y][x]) dots.push({ x, y });
  }
  while (dots.length < count) dots.push({ x: Math.random() * w, y: Math.random() * h });
  return dots;
}

function lloydsRelaxation(dots, dm, w, h, iters = 15) {
  const DS = 4;
  const dsW = Math.floor(w / DS), dsH = Math.floor(h / DS);
  const dsDensity = [];
  for (let y = 0; y < dsH; y++) {
    const row = [];
    for (let x = 0; x < dsW; x++) row.push(dm[y * DS]?.[x * DS] || 0);
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

async function processRef(imgPath) {
  const img = await loadImage(imgPath);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const dm = buildDensityMap(ctx, img.width, img.height);
  let dots = placeInitialDots(dm, img.width, img.height, DOT_COUNT);
  dots = lloydsRelaxation(dots, dm, img.width, img.height, 15);
  const imageData = ctx.getImageData(0, 0, img.width, img.height).data;
  for (const d of dots) {
    const x = Math.round(Math.max(0, Math.min(img.width - 1, d.x)));
    const y = Math.round(Math.max(0, Math.min(img.height - 1, d.y)));
    const i = (y * img.width + x) * 4;
    d.r = imageData[i]; d.g = imageData[i+1]; d.b = imageData[i+2];
    d.color = '#' + ((1 << 24) + (d.r << 16) + (d.g << 8) + d.b).toString(16).slice(1);
    d.sprawlX = (d.x / img.width) * (SPRAWL_RANGE * 2) - SPRAWL_RANGE;
    d.sprawlY = (d.y / img.height) * (SPRAWL_RANGE * 2) - SPRAWL_RANGE;
  }
  return dots.map(d => {
    const lum = (0.299 * d.r + 0.587 * d.g + 0.114 * d.b) / 255;
    return {
      x: Math.round(d.sprawlX * 100) / 100,
      y: Math.round(d.sprawlY * 100) / 100,
      color: d.color,
      size: Math.round((2 + lum * 1.5) * 10) / 10,
      opacity: Math.round((0.4 + lum * 0.4) * 100) / 100,
    };
  });
}

async function main() {
  const epochsToBackfill = process.argv.slice(2).map(Number);
  if (epochsToBackfill.length === 0) {
    console.log('Usage: node backfill-epochs.js 2 3 4');
    return;
  }

  for (const num of epochsToBackfill) {
    const entry = journal.epochs.find(e => e.epoch === num);
    if (!entry) { console.log(`No journal entry for epoch ${num}, skipping`); continue; }
    
    const refPath = path.join(__dirname, 'curator-frames', `ref-live-epoch-${num}.png`);
    if (!fs.existsSync(refPath)) { console.log(`No reference image for epoch ${num}, skipping`); continue; }
    
    console.log(`\nProcessing epoch ${num}: "${entry.reference_prompt}"`);
    console.log('  Stippling...');
    const targets = await processRef(refPath);
    console.log(`  ${targets.length} targets computed`);
    
    console.log('  Posting to sprawl.place...');
    const res = await fetch(`${SPRAWL_API}/api/epochs`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SPRAWL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        epoch_number: num,
        timestamp: entry.timestamp,
        reference_prompt: entry.reference_prompt,
        image_prompt: entry.image_prompt,
        note_to_self: entry.note_to_self,
        painting_title: entry.painting_title,
        painting_artist: entry.painting_artist,
        source: entry.source,
        targets,
      }),
    });
    const result = await res.json();
    if (res.ok) {
      console.log(`  ✅ Stored (id: ${result.id})`);
    } else {
      console.log(`  ❌ Failed: ${JSON.stringify(result)}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
