#!/usr/bin/env node

/**
 * curator-replay.js — Replay pre-computed transitions (no canvas dependency)
 * 
 * Reads wave-targets.json and moves dots via the batch API.
 * Designed to run on Railway where node-canvas isn't available.
 */

const fs = require('fs');
const path = require('path');

const SPRAWL_API = process.env.SPRAWL_API || 'https://sprawl.place';
const SPRAWL_KEY = process.env.SPRAWL_API_KEY || 'sprl_DyXoIVwGM38U9MhGALslmLn8KZ5Tkm69';
const BATCH_SIZE = 500;
const BATCH_DELAY = 150;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sprawlFetch(ep, opts = {}) {
  const url = (ep.startsWith('http') ? '' : SPRAWL_API) + ep;
  const r = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + SPRAWL_KEY, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (r.status === 429) { await sleep(10000); return sprawlFetch(ep, opts); }
  return r;
}

// Greedy nearest-neighbor matching
function matchDots(current, target) {
  const gridSize = 50;
  const targetByGrid = {};
  target.forEach((t, i) => {
    const k = `${Math.floor(t.x / gridSize)},${Math.floor(t.y / gridSize)}`;
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
          const ddx = cx - target[j].x, ddy = cy - target[j].y;
          const dist = ddx*ddx + ddy*ddy;
          if (dist < bestDist) { bestDist = dist; bestJ = j; }
        }
      }
    }
    if (bestJ === -1) {
      for (let j = 0; j < target.length; j++) {
        if (used.has(j)) continue;
        const ddx = cx - target[j].x, ddy = cy - target[j].y;
        const dist = ddx*ddx + ddy*ddy;
        if (dist < bestDist) { bestDist = dist; bestJ = j; }
      }
    }
    assignments[i] = bestJ;
    used.add(bestJ);
  }
  return assignments;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function runTransition(targetDots, title) {
  console.log(`📡 Fetching marks for "${title}"...`);
  const currentMarks = await (await sprawlFetch('/api/ext/marks')).json();
  
  console.log('🔗 Matching...');
  const assignments = matchDots(currentMarks, targetDots);
  
  const moves = [];
  for (let i = 0; i < currentMarks.length; i++) {
    const j = assignments[i];
    if (j === -1) continue;
    const t = targetDots[j];
    moves.push({
      op: 'move', markId: currentMarks[i].id,
      x: t.x, y: t.y, color: t.color, size: t.size, opacity: t.opacity,
    });
  }
  shuffle(moves);
  
  console.log(`🌊 Streaming ${moves.length} dots...`);
  let sent = 0;
  const start = Date.now();
  for (let i = 0; i < moves.length; i += BATCH_SIZE) {
    const batch = moves.slice(i, i + BATCH_SIZE);
    await sprawlFetch('/api/ext/marks/batch', { method: 'POST', body: JSON.stringify({ ops: batch }) });
    sent += batch.length;
    if (sent % 4000 === 0 || sent === moves.length) {
      console.log(`  ${sent}/${moves.length} — ${((Date.now()-start)/1000).toFixed(0)}s`);
    }
    if (i + BATCH_SIZE < moves.length) await sleep(BATCH_DELAY);
  }
  console.log(`  ✅ "${title}" in ${((Date.now()-start)/1000).toFixed(0)}s`);
}

async function main() {
  const targetsPath = path.join(__dirname, 'curator-frames', 'wave-targets.json');
  if (!fs.existsSync(targetsPath)) {
    console.error('❌ wave-targets.json not found');
    process.exit(1);
  }
  
  const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));
  const sequence = ['wave-curl', 'wave-break', 'wave-foam', 'wave-retreat'];
  
  console.log(`🏎️  REPLAY — ${sequence.length} compositions\n`);
  const totalStart = Date.now();
  
  for (let i = 0; i < sequence.length; i++) {
    const name = sequence[i];
    if (!targets[name]) { console.error(`Missing target: ${name}`); continue; }
    console.log(`\n━━━ ${i+1}/${sequence.length}: "${name}" ━━━`);
    await runTransition(targets[name], name);
  }
  
  console.log(`\n🏁 Replay complete in ${((Date.now()-totalStart)/1000).toFixed(0)}s`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
