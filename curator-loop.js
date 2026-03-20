#!/usr/bin/env node

/**
 * curator-loop.js — The Living Canvas curator
 * 
 * An AI director that guides a never-ending painting.
 * Wakes on interval, reads its soul + journal, decides what happens next,
 * generates a reference image prompt, and transitions the dots.
 * 
 * Usage:
 *   node curator-loop.js --canvas CANVAS_ID --soul curator-soul-patient.md --journal curator-journal.json
 *   
 * Env:
 *   OPENCLAW_GATEWAY_TOKEN — for LLM calls
 *   MET_API — uses Met Museum public domain paintings (default, free)
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const GATEWAY_URL = 'http://127.0.0.1:18789/v1/chat/completions';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const MODEL = 'anthropic/claude-opus-4-6';
const CANVAS_SIZE = 800;

// === CLI ===
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    canvasId: null,
    soulFile: null,
    journalFile: null,
    intervalMinutes: 30,
    transitionFrames: 120,
    holdFrames: 30,
    dotCount: 20000,
    fps: 12,
    outputDir: path.join(__dirname, 'curator-frames'),
    once: false, // run once then exit (for testing)
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--canvas': config.canvasId = args[++i]; break;
      case '--soul': config.soulFile = args[++i]; break;
      case '--journal': config.journalFile = args[++i]; break;
      case '--interval': config.intervalMinutes = parseInt(args[++i]); break;
      case '--transition-frames': config.transitionFrames = parseInt(args[++i]); break;
      case '--hold-frames': config.holdFrames = parseInt(args[++i]); break;
      case '--dots': config.dotCount = parseInt(args[++i]); break;
      case '--once': config.once = true; break;
    }
  }
  
  if (!config.soulFile || !config.journalFile) {
    console.error('Usage: node curator-loop.js --soul <soul.md> --journal <journal.json> [--canvas ID] [--interval 30] [--once]');
    process.exit(1);
  }
  
  return config;
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
  // Strip markdown code blocks
  s = s.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  // Find the JSON object anywhere in the text
  const fb = s.indexOf('{'), lb = s.lastIndexOf('}');
  if (fb >= 0 && lb > fb) {
    try { return JSON.parse(s.slice(fb, lb + 1)); } catch (e) {
      // Try cleaning common issues
      let cleaned = s.slice(fb, lb + 1);
      cleaned = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      try { return JSON.parse(cleaned); } catch {}
    }
  }
  console.log('  RAW LLM output:', s.slice(0, 300));
  throw new Error('Failed to parse JSON');
}

// === Journal ===
function loadJournal(filepath) {
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function saveJournal(filepath, journal) {
  fs.writeFileSync(filepath, JSON.stringify(journal, null, 2));
}

function buildContext(journal, soul) {
  const epochs = journal.epochs || [];
  const recent = epochs.slice(-10);
  
  // Weekly summaries for older epochs
  const older = epochs.slice(0, -10);
  const weeklySummaries = [];
  if (older.length > 0) {
    // Group by week
    const weeks = {};
    for (const e of older) {
      const date = new Date(e.timestamp);
      const weekKey = `${date.getFullYear()}-W${Math.ceil(date.getDate() / 7)}`;
      if (!weeks[weekKey]) weeks[weekKey] = [];
      weeks[weekKey].push(e);
    }
    for (const [week, entries] of Object.entries(weeks)) {
      const prompts = entries.map(e => e.reference_prompt).join('; ');
      const avgSpeed = entries.reduce((s, e) => s + (e.transition_speed === 'fast' ? 1 : e.transition_speed === 'slow' ? 3 : 2), 0) / entries.length;
      weeklySummaries.push(`${week}: ${entries.length} transitions. Themes: ${prompts.slice(0, 200)}. Avg pace: ${avgSpeed < 1.5 ? 'fast' : avgSpeed > 2.5 ? 'slow' : 'moderate'}.`);
    }
  }
  
  return { recent, weeklySummaries, totalEpochs: epochs.length };
}

// === Reference Image Generation ===

// Local SDXL Turbo (primary)
async function generateWithSDXL(prompt, outputPath) {
  const { execSync } = require('child_process');
  const venvPython = path.join(__dirname, 'sdxl-env', 'bin', 'python3');
  const script = path.join(__dirname, 'generate-reference.py');
  
  if (!fs.existsSync(venvPython)) {
    console.log('  ⚠️  SDXL venv not found, falling back to Met Museum');
    return null;
  }
  
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

// Met Museum API (fallback)
async function searchMetMuseum(query) {
  const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}&hasImages=true`);
  const data = await r.json();
  const ids = data.objectIDs || [];
  
  for (const oid of ids.slice(0, 10)) {
    try {
      const objR = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${oid}`);
      const obj = await objR.json();
      if (obj.isPublicDomain && obj.primaryImageSmall) {
        return {
          id: oid,
          title: obj.title,
          artist: obj.artistDisplayName || 'Unknown',
          imageUrl: obj.primaryImageSmall,
          source: 'met',
        };
      }
    } catch {}
  }
  return null;
}

async function downloadReference(url, outputPath) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed: ${r.statusText}`);
  const buffer = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// Try SDXL first, fall back to Met Museum
async function acquireReference(decision, outputPath) {
  // Try local SDXL generation
  console.log('🎨 Generating reference with local SDXL...');
  const sdxlResult = await generateWithSDXL(decision.image_prompt, outputPath);
  if (sdxlResult) {
    console.log(`  ✅ Generated locally: "${sdxlResult.title}"`);
    return sdxlResult;
  }
  
  // Fall back to Met Museum
  console.log('🔍 Falling back to Met Museum search...');
  const painting = await searchMetMuseum(decision.search_query || decision.reference_prompt);
  if (painting) {
    await downloadReference(painting.imageUrl, outputPath);
    console.log(`  ✅ Found: "${painting.title}" by ${painting.artist}`);
    return painting;
  }
  
  return null;
}

// === Voronoi Stippling (from autoart-v4) ===
function buildDensityMap(ctx, width, height) {
  const map = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const px = ctx.getImageData(x, y, 1, 1).data;
      row.push(1.0 - (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255);
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
  for (const d of dots) {
    const x = Math.round(Math.max(0, Math.min(width - 1, d.x)));
    const y = Math.round(Math.max(0, Math.min(height - 1, d.y)));
    const px = ctx.getImageData(x, y, 1, 1).data;
    d.r = px[0]; d.g = px[1]; d.b = px[2];
    d.color = `#${((1 << 24) + (px[0] << 16) + (px[1] << 8) + px[2]).toString(16).slice(1)}`;
  }
  return dots;
}

function matchDots(current, target) {
  const used = new Set();
  const assignments = [];
  for (let i = 0; i < current.length; i++) {
    let bestJ = -1, bestDist = Infinity;
    for (let j = 0; j < target.length; j++) {
      if (used.has(j)) continue;
      const dx = current[i].screenX - target[j].screenX;
      const dy = current[i].screenY - target[j].screenY;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; bestJ = j; }
    }
    assignments.push(bestJ);
    used.add(bestJ);
  }
  return assignments;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// === Process a reference image into target dots ===
async function processReference(imagePath, dotCount) {
  const img = await loadImage(imagePath);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  const densityMap = buildDensityMap(ctx, img.width, img.height);
  let dots = placeInitialDots(densityMap, img.width, img.height, dotCount);
  dots = lloydsRelaxation(dots, densityMap, img.width, img.height, 20);
  dots = colorDots(dots, ctx, img.width, img.height);
  
  // Convert to screen coords
  for (const d of dots) {
    d.screenX = (d.x / img.width) * CANVAS_SIZE;
    d.screenY = (d.y / img.height) * CANVAS_SIZE;
  }
  
  return dots;
}

// === Rendering ===
function renderFrame(dots, outputPath) {
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
  
  fs.writeFileSync(outputPath, c.toBuffer('image/png'));
}

// === Curator Decision ===
async function curatorDecide(soul, context, currentPalette) {
  const system = `You are an AI art curator directing a living canvas — a never-ending painting made of dots that migrate between compositions over time.

Your personality:
${soul}

You must decide what the painting becomes next.`;

  const recentHistory = context.recent.length > 0
    ? context.recent.map(e => `Epoch ${e.epoch}: "${e.reference_prompt}" (${e.transition_speed}, held ${e.hold_duration}). Note: ${e.note_to_self}`).join('\n')
    : 'This is the first epoch. The canvas is blank.';

  const summaries = context.weeklySummaries.length > 0
    ? context.weeklySummaries.join('\n')
    : 'No history yet.';

  const now = new Date();
  const timeOfDay = now.getHours() < 6 ? 'deep night' : now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening';
  const season = [1,2,3].includes(now.getMonth()+1) ? 'winter' : [4,5,6].includes(now.getMonth()+1) ? 'spring' : [7,8,9].includes(now.getMonth()+1) ? 'summer' : 'autumn';

  const user = `Total epochs so far: ${context.totalEpochs}

Recent history:
${recentHistory}

${summaries.length > 20 ? `Older summaries:\n${summaries}\n` : ''}
Current time: ${timeOfDay} (${season})
Current dominant palette: ${currentPalette || 'unknown'}

Decide the next transition. You have two ways to get a reference image:
1. Generate one with SDXL (you write the prompt — full creative freedom, any subject/style)
2. Find a real painting from the Met Museum (search query)

Output ONLY JSON:
{
  "image_prompt": "detailed SDXL prompt for the reference image — describe subject, style, lighting, palette, mood. Be vivid and specific. This generates your painting.",
  "search_query": "backup Met Museum search terms in case SDXL fails (artist name, subject, style)",
  "reference_prompt": "short human-readable description of what the painting becomes",
  "transition_speed": "slow|medium|fast",
  "transition_frames": number (30=fast, 60=moderate, 120=slow, 180=glacial),
  "hold_duration": "how long to hold the completed form before next transition (e.g. '2h', '30m')",
  "note_to_self": "why you're making this choice — this goes in your journal for future you to read"
}`;

  const raw = await callLLM(system, user, 0.9);
  return parseJSON(raw);
}

// === Main Loop ===
async function main() {
  const config = parseArgs();
  const soul = fs.readFileSync(config.soulFile, 'utf8');
  let journal = loadJournal(config.journalFile);
  
  if (!fs.existsSync(config.outputDir)) fs.mkdirSync(config.outputDir, { recursive: true });
  
  console.log('🎨 Living Canvas — Curator Loop\n');
  console.log(`Soul: ${config.soulFile}`);
  console.log(`Journal: ${config.journalFile} (${journal.epochs.length} epochs)`);
  console.log(`Dots: ${config.dotCount} | Interval: ${config.intervalMinutes}m`);
  console.log(`Mode: ${config.once ? 'single run' : 'continuous loop'}\n`);
  
  // Initialize current dots if first run
  let currentDots = null;
  const stateFile = config.journalFile.replace('.json', '-state.json');
  
  if (fs.existsSync(stateFile)) {
    console.log('📂 Loading dot state from previous run...');
    currentDots = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    console.log(`  ${currentDots.length} dots loaded\n`);
  }
  
  const runEpoch = async () => {
    const epochNum = journal.epochs.length + 1;
    console.log(`\n━━━ Epoch ${epochNum} ━━━\n`);
    
    // Build context for curator
    const context = buildContext(journal, soul);
    
    // Get current palette summary
    let paletteSummary = 'blank canvas';
    if (currentDots && currentDots.length > 0) {
      const colors = currentDots.slice(0, 100).map(d => d.color);
      paletteSummary = [...new Set(colors)].slice(0, 10).join(', ');
    }
    
    // Ask curator what's next
    console.log('🧠 Curator deciding...');
    let decision;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        decision = await curatorDecide(soul, context, paletteSummary);
        break;
      } catch (e) {
        console.log(`  ⚠️  Parse failed (attempt ${attempt + 1}/3), retrying...`);
        if (attempt === 2) throw e;
      }
    }
    console.log(`  SDXL prompt: "${(decision.image_prompt || '').slice(0, 100)}..."`);
    console.log(`  Fallback search: "${decision.search_query}"`);
    console.log(`  Vision: "${decision.reference_prompt}"`);
    console.log(`  Speed: ${decision.transition_speed} (${decision.transition_frames} frames)`);
    console.log(`  Hold: ${decision.hold_duration}`);
    console.log(`  Note: "${decision.note_to_self}"\n`);
    
    // Acquire reference image (SDXL primary, Met fallback)
    const refPath = path.join(config.outputDir, `ref-epoch-${epochNum}.png`);
    const painting = await acquireReference(decision, refPath);
    if (!painting) {
      console.log('  ❌ Could not acquire reference image. Skipping epoch.');
      return;
    }
    
    // Process into target dots
    console.log('🔄 Voronoi stippling reference...');
    const targetDots = await processReference(refPath, config.dotCount);
    console.log(`  ${targetDots.length} target dots computed`);
    
    // Initialize current dots if first epoch
    if (!currentDots) {
      currentDots = targetDots.map((d, i) => {
        const pct = i / config.dotCount;
        let size, opacity;
        if (pct < 0.3) { size = 5 + Math.random() * 3; opacity = 0.7 + Math.random() * 0.2; }
        else if (pct < 0.7) { size = 2.5 + Math.random() * 2.5; opacity = 0.4 + Math.random() * 0.3; }
        else { size = 1 + Math.random() * 1.5; opacity = 0.3 + Math.random() * 0.4; }
        return { ...d, size, opacity };
      });
      
      // Render initial state
      const initFrame = path.join(config.outputDir, `epoch-${epochNum}-hold.png`);
      renderFrame(currentDots, initFrame);
      console.log(`  📸 Initial state: ${initFrame}`);
    } else {
      // Transition from current to target
      const frames = decision.transition_frames || config.transitionFrames;
      console.log(`\n🎬 Transitioning (${frames} frames)...`);
      
      // Match dots
      const assignments = matchDots(currentDots, targetDots);
      const startPositions = currentDots.map(d => ({
        screenX: d.screenX, screenY: d.screenY,
        r: d.r || 128, g: d.g || 128, b: d.b || 128,
      }));
      
      let totalDistance = 0;
      
      for (let f = 0; f < frames; f++) {
        const t = easeInOutCubic((f + 1) / frames);
        
        for (let i = 0; i < currentDots.length; i++) {
          const j = assignments[i];
          const start = startPositions[i];
          const end = targetDots[j];
          
          currentDots[i].screenX = start.screenX + (end.screenX - start.screenX) * t;
          currentDots[i].screenY = start.screenY + (end.screenY - start.screenY) * t;
          
          const r = Math.round(start.r + ((end.r || 128) - start.r) * t);
          const g = Math.round(start.g + ((end.g || 128) - start.g) * t);
          const b = Math.round(start.b + ((end.b || 128) - start.b) * t);
          currentDots[i].r = r;
          currentDots[i].g = g;
          currentDots[i].b = b;
          currentDots[i].color = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
          
          if (f === 0) {
            totalDistance += Math.sqrt(
              (end.screenX - start.screenX) ** 2 + (end.screenY - start.screenY) ** 2
            );
          }
        }
        
        // Save key frames
        if (f === 0 || f === Math.floor(frames / 2) || f === frames - 1) {
          const frameFile = path.join(config.outputDir, `epoch-${epochNum}-f${f}.png`);
          renderFrame(currentDots, frameFile);
        }
        
        if ((f + 1) % 30 === 0) console.log(`  Frame ${f + 1}/${frames}`);
      }
      
      const avgDist = totalDistance / currentDots.length;
      console.log(`  Avg dot distance: ${avgDist.toFixed(1)}px`);
      
      // Save final hold frame
      const holdFrame = path.join(config.outputDir, `epoch-${epochNum}-hold.png`);
      renderFrame(currentDots, holdFrame);
      console.log(`  📸 Hold frame: ${holdFrame}`);
    }
    
    // Save state
    fs.writeFileSync(stateFile, JSON.stringify(currentDots));
    
    // Write journal entry
    const entry = {
      epoch: epochNum,
      timestamp: new Date().toISOString(),
      reference_prompt: decision.reference_prompt,
      image_prompt: decision.image_prompt,
      search_query: decision.search_query,
      painting_title: painting.title,
      painting_artist: painting.artist,
      source: painting.source || 'unknown',
      transition_speed: decision.transition_speed,
      transition_frames: decision.transition_frames,
      hold_duration: decision.hold_duration,
      note_to_self: decision.note_to_self,
      dots_count: config.dotCount,
    };
    
    journal.epochs.push(entry);
    saveJournal(config.journalFile, journal);
    console.log(`\n📝 Journal updated (${journal.epochs.length} epochs)`);
  };
  
  // Run
  if (config.once) {
    await runEpoch();
    console.log('\n🏁 Single epoch complete.');
  } else {
    while (true) {
      await runEpoch();
      const holdMs = config.intervalMinutes * 60 * 1000;
      console.log(`\n⏳ Holding for ${config.intervalMinutes} minutes...`);
      await new Promise(r => setTimeout(r, holdMs));
    }
  }
}

main().catch(err => {
  console.error('❌ Fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
