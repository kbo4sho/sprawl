#!/usr/bin/env node
/**
 * Sprawl Experiment Runner
 * 
 * Runs an experiment by repeatedly calling the evolve endpoint until complete.
 * Saves snapshots after each evolution for timelapse generation.
 * 
 * Usage: node experiment-runner.js <slug> [--interval 30]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API = process.env.API || 'http://localhost:3500';
const args = process.argv.slice(2);

const slug = args[0];
const intervalSeconds = parseInt(args.find(a => a.startsWith('--interval'))?.split('=')[1]) || 30;

if (!slug) {
  console.error('Usage: node experiment-runner.js <slug> [--interval=30]');
  process.exit(1);
}

// Import render module
let rasterizePrimitives;
try {
  const render = require('./render');
  rasterizePrimitives = render.rasterizePrimitives;
} catch (e) {
  console.warn('⚠️  Canvas package not available, snapshots will be skipped');
  rasterizePrimitives = null;
}

const Database = require('better-sqlite3');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'sprawl.db');
const db = new Database(DB_PATH);

const FRAMES_DIR = path.join(DATA_DIR, 'experiments', slug);
if (!fs.existsSync(FRAMES_DIR)) {
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
}

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`); }
}

async function saveSnapshot(canvasId, evolutionNum) {
  if (!rasterizePrimitives) {
    return; // Skip if canvas not available
  }
  
  try {
    // Get marks from database
    const marks = db.prepare('SELECT * FROM marks WHERE canvas_id = ?').all(canvasId);
    
    if (marks.length === 0) {
      console.log(`  ⚠️  No marks to snapshot`);
      return;
    }
    
    // Rasterize to PNG
    const pngBuffer = rasterizePrimitives(marks);
    
    // Save frame
    const framePath = path.join(FRAMES_DIR, `frame-${String(evolutionNum).padStart(4, '0')}.png`);
    fs.writeFileSync(framePath, pngBuffer);
    console.log(`  📸 Saved snapshot: ${framePath}`);
  } catch (error) {
    console.error(`  ❌ Snapshot failed:`, error.message);
  }
}

async function generateThumbnail(canvasId, experimentId) {
  if (!rasterizePrimitives) {
    console.log(`  ⚠️  Canvas package not available, skipping thumbnail`);
    return null;
  }
  
  try {
    console.log(`\n📸 Generating thumbnail...`);
    
    // Get final marks
    const marks = db.prepare('SELECT * FROM marks WHERE canvas_id = ?').all(canvasId);
    
    if (marks.length === 0) {
      console.log(`  ⚠️  No marks to render`);
      return null;
    }
    
    // Rasterize at smaller size for thumbnail
    const pngBuffer = rasterizePrimitives(marks, { width: 600, height: 600 });
    
    // Save thumbnail
    const thumbDir = path.join(__dirname, 'public', 'thumbnails');
    if (!fs.existsSync(thumbDir)) {
      fs.mkdirSync(thumbDir, { recursive: true });
    }
    
    const thumbPath = path.join(thumbDir, `${slug}.png`);
    fs.writeFileSync(thumbPath, pngBuffer);
    
    const publicUrl = `/thumbnails/${slug}.png`;
    console.log(`  ✅ Thumbnail saved: ${publicUrl}`);
    
    // Update experiment record
    db.prepare('UPDATE experiments SET thumbnail_url = ? WHERE id = ?')
      .run(publicUrl, experimentId);
    
    return publicUrl;
  } catch (error) {
    console.error(`  ❌ Thumbnail generation failed:`, error.message);
    return null;
  }
}

async function generateTimelapse(experimentId) {
  try {
    console.log(`\n🎬 Generating timelapse...`);
    
    const frames = fs.readdirSync(FRAMES_DIR)
      .filter(f => f.startsWith('frame-') && f.endsWith('.png'))
      .sort();
    
    if (frames.length < 2) {
      console.log(`  ⚠️  Not enough frames (${frames.length}), skipping timelapse`);
      return null;
    }
    
    const timelapseDir = path.join(__dirname, 'public', 'timelapse');
    if (!fs.existsSync(timelapseDir)) {
      fs.mkdirSync(timelapseDir, { recursive: true });
    }
    
    const outputPath = path.join(timelapseDir, `${slug}.mp4`);
    
    // Use ffmpeg to create timelapse
    // 30 fps, high quality h264
    const cmd = `ffmpeg -y -framerate 30 -pattern_type glob -i '${FRAMES_DIR}/frame-*.png' \
      -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
      '${outputPath}'`;
    
    console.log(`  Running: ${cmd.slice(0, 100)}...`);
    execSync(cmd, { stdio: 'inherit' });
    
    const publicUrl = `/timelapse/${slug}.mp4`;
    console.log(`  ✅ Timelapse saved: ${publicUrl}`);
    
    // Update experiment record
    db.prepare('UPDATE experiments SET timelapse_url = ? WHERE id = ?')
      .run(publicUrl, experimentId);
    
    return publicUrl;
  } catch (error) {
    console.error(`  ❌ Timelapse generation failed:`, error.message);
    return null;
  }
}

async function runExperiment() {
  console.log(`🧪 Starting experiment: ${slug}`);
  console.log(`   Evolve interval: ${intervalSeconds}s\n`);
  
  let evolutionCount = 0;
  let running = true;
  
  while (running) {
    try {
      // Fetch current status
      const status = await api('GET', `/api/experiments/${slug}`);
      
      if (status.error) {
        console.error(`❌ Error fetching experiment: ${status.error}`);
        process.exit(1);
      }
      
      const maxEvolutions = status.max_evolutions || 20;
      
      console.log(`Evolution ${status.evolutions + 1}/${maxEvolutions}:`);
      console.log(`  Confidence: ${(status.confidence * 100).toFixed(1)}%`);
      if (status.reflection) {
        console.log(`  Reflection: "${status.reflection.slice(0, 80)}..."`);
      }
      
      if (status.status !== 'running') {
        console.log(`\n✅ Experiment complete!`);
        running = false;
        
        // Generate thumbnail and timelapse
        await generateThumbnail(status.canvas.id, status.id);
        await generateTimelapse(status.id);
        break;
      }
      
      // Check if we've hit max_evolutions cap
      if (status.evolutions >= maxEvolutions) {
        console.log(`\n✅ Reached evolution cap (${maxEvolutions})`);
        running = false;
        
        // Generate thumbnail and timelapse
        await generateThumbnail(status.canvas.id, status.id);
        await generateTimelapse(status.id);
        break;
      }
      
      // Trigger evolution
      const result = await api('POST', `/api/experiments/${slug}/evolve`);
      
      if (result.error) {
        console.error(`  ❌ Evolution failed: ${result.error}`);
        break;
      }
      
      console.log(`  Operations: +${result.operations.added} -${result.operations.removed} ~${result.operations.moved}`);
      console.log(`  New confidence: ${(result.confidence * 100).toFixed(1)}%`);
      
      // Save snapshot
      await saveSnapshot(status.canvas.id, result.evolutions);
      
      evolutionCount++;
      
      if (result.status === 'complete') {
        console.log(`\n✅ Experiment reached completion!`);
        running = false;
        
        // Generate thumbnail and timelapse
        await generateThumbnail(status.canvas.id, status.id);
        await generateTimelapse(status.id);
        break;
      }
      
      // Wait before next evolution
      console.log(`  ⏳ Waiting ${intervalSeconds}s...\n`);
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
      
    } catch (error) {
      console.error(`❌ Error:`, error.message);
      process.exit(1);
    }
  }
  
  console.log(`\n🎉 Done! Total evolutions: ${evolutionCount}`);
  process.exit(0);
}

runExperiment();
