#!/usr/bin/env node
/**
 * Resume seeding from a partial run. Re-stipples the reference image,
 * checks how many marks exist, and adds the missing ones.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const SPRAWL_API = 'https://sprawl.place';
const SPRAWL_KEY = process.env.SPRAWL_API_KEY || 'sprl_DyXoIVwGM38U9MhGALslmLn8KZ5Tkm69';
const SPRAWL_RANGE = 400;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2200;
const TARGET_DOTS = parseInt(process.argv[2] || '20000');
const REF_IMAGE = process.argv[3] || path.join(__dirname, 'curator-frames/ref-live-epoch-1.png');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sprawlFetch(endpoint, opts = {}) {
  const r = await fetch(`${SPRAWL_API}${endpoint}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${SPRAWL_KEY}`, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (r.status === 429) { console.log('  Rate limited, waiting 10s...'); await sleep(10000); return sprawlFetch(endpoint, opts); }
  return r;
}

function buildDensityMap(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data, map = [];
  for (let y = 0; y < h; y++) { const row = []; for (let x = 0; x < w; x++) { const i = (y*w+x)*4; row.push(1-(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])/255); } map.push(row); }
  return map;
}
function placeInitialDots(dm, w, h, n) {
  const dots = []; let a = 0;
  while (dots.length < n && a < n*100) { a++; const x=Math.floor(Math.random()*w), y=Math.floor(Math.random()*h); if (Math.random()<dm[y][x]) dots.push({x,y}); }
  while (dots.length < n) dots.push({x:Math.random()*w, y:Math.random()*h});
  return dots;
}
function lloydsRelaxation(dots, dm, w, h, iters=15) {
  const DS=4, dsW=Math.floor(w/DS), dsH=Math.floor(h/DS), dd=[];
  for (let y=0;y<dsH;y++){const r=[];for(let x=0;x<dsW;x++)r.push(dm[y*DS]?.[x*DS]||0);dd.push(r);}
  let dsDots=dots.map(d=>({x:d.x/DS,y:d.y/DS}));
  for (let it=0;it<iters;it++){
    const regions=dsDots.map(()=>({sumX:0,sumY:0,sumW:0}));
    for(let y=0;y<dsH;y++)for(let x=0;x<dsW;x++){let minD=Infinity,near=0;for(let i=0;i<dsDots.length;i++){const dx=x-dsDots[i].x,dy=y-dsDots[i].y,d=dx*dx+dy*dy;if(d<minD){minD=d;near=i;}}const wt=dd[y][x];regions[near].sumX+=x*wt;regions[near].sumY+=y*wt;regions[near].sumW+=wt;}
    for(let i=0;i<dsDots.length;i++){const r=regions[i];if(r.sumW>0){dsDots[i].x=r.sumX/r.sumW;dsDots[i].y=r.sumY/r.sumW;}}
  }
  for(let i=0;i<dots.length;i++){dots[i].x=Math.max(0,Math.min(w-1,dsDots[i].x*DS));dots[i].y=Math.max(0,Math.min(h-1,dsDots[i].y*DS));}
  return dots;
}
function colorDots(dots, ctx, w, h) {
  const d = ctx.getImageData(0,0,w,h).data;
  for(const dot of dots){const x=Math.round(Math.max(0,Math.min(w-1,dot.x))),y=Math.round(Math.max(0,Math.min(h-1,dot.y))),i=(y*w+x)*4;dot.color=`#${((1<<24)+(d[i]<<16)+(d[i+1]<<8)+d[i+2]).toString(16).slice(1)}`;}
  return dots;
}

async function main() {
  console.log(`📡 Checking current marks...`);
  const existing = await (await sprawlFetch('/api/ext/marks')).json();
  const have = existing.length;
  const need = TARGET_DOTS - have;
  console.log(`  Have: ${have}  Need: ${need}`);
  if (need <= 0) { console.log('  ✅ Already at target!'); return; }

  console.log(`🔄 Stippling ${need} additional dots from reference...`);
  const img = await loadImage(REF_IMAGE);
  const c = createCanvas(img.width, img.height), ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const dm = buildDensityMap(ctx, img.width, img.height);
  
  // Generate MORE dots than needed, filter out ones too close to existing positions
  const extraCount = Math.ceil(need * 1.5);
  let dots = placeInitialDots(dm, img.width, img.height, extraCount);
  dots = lloydsRelaxation(dots, dm, img.width, img.height, 12);
  dots = colorDots(dots, ctx, img.width, img.height);
  
  // Convert to sprawl coords
  for (const d of dots) {
    d.sprawlX = Math.round(((d.x / img.width) * SPRAWL_RANGE * 2 - SPRAWL_RANGE) * 100) / 100;
    d.sprawlY = Math.round(((d.y / img.height) * SPRAWL_RANGE * 2 - SPRAWL_RANGE) * 100) / 100;
  }
  
  // Take only what we need
  const toAdd = dots.slice(0, need);
  console.log(`  Adding ${toAdd.length} dots...`);
  
  const ops = toAdd.map(d => ({
    op: 'add', type: 'dot',
    x: d.sprawlX, y: d.sprawlY,
    color: d.color,
    size: 3 + Math.random() * 4,
    opacity: 0.5 + Math.random() * 0.4,
  }));
  
  const chunks = [];
  for (let i = 0; i < ops.length; i += BATCH_SIZE) chunks.push(ops.slice(i, i + BATCH_SIZE));
  
  let done = 0;
  for (let i = 0; i < chunks.length; i++) {
    const r = await sprawlFetch('/api/ext/marks/batch', { method: 'POST', body: JSON.stringify({ ops: chunks[i] }) });
    const data = await r.json();
    done += chunks[i].length;
    if (data.errors?.length) console.log(`  ⚠️  ${data.errors.slice(0,2).join('; ')}`);
    if ((i+1) % 20 === 0 || i === chunks.length-1) console.log(`    ${done}/${toAdd.length} (batch ${i+1}/${chunks.length})`);
    if (i < chunks.length-1) await sleep(BATCH_DELAY_MS);
  }
  
  console.log('✅ Done! Check sprawl.place');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
