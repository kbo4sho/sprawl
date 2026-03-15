#!/usr/bin/env node
/**
 * Seed starter canvases for Canvas Pivot
 * 
 * Usage: node seed-canvases.js
 * 
 * Creates two starter canvases:
 * 1. Neon City - urban nightscape with neon palette
 * 2. Wildflower - meadow of flowers with warm palette
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'sprawl.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const canvases = [
  {
    name: 'Neon City',
    theme: 'A cyberpunk cityscape at night, glowing with neon lights reflecting off rain-slicked streets',
    subject: 'urban nightscape',
    stylePrompt: 'cyberpunk, neon-lit city, futuristic architecture, vibrant colors, night scene, rain reflections',
    rules: {
      colorPalette: ['#00ffff', '#ff00ff', '#0080ff', '#ffffff', '#00ccff', '#ff1493'],
      allowedTypes: ['dot', 'line', 'text', 'arc'],
      maxPrimitives: 5,
    },
    renderInterval: 25,
  },
  {
    name: 'Wildflower',
    theme: 'A sun-drenched meadow bursting with wildflowers swaying in a gentle breeze',
    subject: 'wildflower meadow',
    stylePrompt: 'impressionist wildflower meadow, warm sunlight, soft focus, natural colors, peaceful, organic forms',
    rules: {
      colorPalette: ['#90ee90', '#228b22', '#ffff00', '#ffa500', '#ffb6c1', '#ff69b4', '#87ceeb'],
      allowedTypes: ['dot', 'arc'],
      maxPrimitives: 5,
    },
    renderInterval: 25,
  },
];

console.log('🌱 Seeding starter canvases for Canvas Pivot...\n');

const insertCanvas = db.prepare(`
  INSERT INTO canvases (
    id, theme, subthemes, spatial_guide, week_of, status, created_at,
    slug, subject, style_prompt, rules, contribution_count, render_interval
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let created = 0;
let skipped = 0;

for (const canvas of canvases) {
  const slug = canvas.name.toLowerCase().replace(/\s+/g, '-');
  
  // Check if canvas with this slug already exists
  const existing = db.prepare('SELECT id FROM canvases WHERE slug = ?').get(slug);
  if (existing) {
    console.log(`⏭  Skipped "${canvas.name}" (slug "${slug}" already exists)`);
    skipped++;
    continue;
  }
  
  const canvasId = crypto.randomUUID();
  const now = new Date().toISOString();
  
  insertCanvas.run(
    canvasId,
    canvas.theme,
    JSON.stringify([]), // subthemes (legacy, empty for Canvas pivot)
    '', // spatial_guide (legacy, empty)
    now, // week_of (legacy)
    'active',
    now,
    slug,
    canvas.subject,
    canvas.stylePrompt,
    JSON.stringify(canvas.rules),
    0, // contribution_count starts at 0
    canvas.renderInterval
  );
  
  console.log(`✅ Created "${canvas.name}"`);
  console.log(`   Slug: ${slug}`);
  console.log(`   Theme: ${canvas.theme}`);
  console.log(`   Palette: ${canvas.rules.colorPalette.join(', ')}`);
  console.log(`   Allowed types: ${canvas.rules.allowedTypes.join(', ')}`);
  console.log(`   Render interval: every ${canvas.renderInterval} contributions\n`);
  created++;
}

console.log(`\n🎨 Seed complete: ${created} created, ${skipped} skipped`);

db.close();
