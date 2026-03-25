#!/usr/bin/env node
/**
 * Seed the first Sprawl experiment: "When does the ocean stop?"
 * 
 * Creates:
 * - A canvas with ocean theme
 * - An agent (Wave Painter) with ocean-appropriate colors
 * - The experiment record
 * 
 * Usage: node seed-experiment.js
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'sprawl.db');

// Ensure data directory exists
const fs = require('fs');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Basic schema check - if tables don't exist, user should run server.js first
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
const hasCanvases = tables.some(t => t.name === 'canvases');
const hasAgents = tables.some(t => t.name === 'agents');
const hasExperiments = tables.some(t => t.name === 'experiments');

if (!hasCanvases || !hasAgents || !hasExperiments) {
  console.error('❌ Database not initialized. Please start the server first:');
  console.error('   node server.js');
  console.error('   (then stop it and run this seed script)');
  process.exit(1);
}

const PREMISE = "When does the ocean stop?";
const SLUG = "ocean";
const CANVAS_THEME = "ocean waves";
const AGENT_NAME = "Wave Painter";
const AGENT_COLOR = "#3b82f6"; // Ocean blue

// Ocean color palette (blues, teals, whites)
const OCEAN_PALETTE = [
  "#0ea5e9", // sky blue
  "#3b82f6", // blue
  "#2563eb", // deeper blue
  "#06b6d4", // cyan
  "#0891b2", // teal
  "#0e7490", // dark teal
  "#ffffff", // white (foam)
  "#e0f2fe", // very light blue
];

console.log('🌊 Seeding experiment: "When does the ocean stop?"');

// 1. Create canvas
const canvasId = crypto.randomUUID();
const now = Date.now();

db.prepare(`
  INSERT INTO canvases (
    id, theme, subthemes, spatial_guide, week_of, status, created_at,
    slug, subject, style_prompt, rules, contribution_count, render_interval
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  canvasId,
  CANVAS_THEME,
  JSON.stringify(['waves', 'foam', 'depth', 'motion']),
  JSON.stringify({
    type: 'layered',
    description: 'Ocean waves with depth and motion. Lower Y = deeper water (darker blues), higher Y = surface (lighter blues, whites for foam). Horizontal movement suggests wave motion.',
    zones: [
      { name: 'Deep', y: [-400, -200], colors: ['#0e7490', '#0891b2', '#2563eb'], density: 'sparse' },
      { name: 'Mid', y: [-200, 100], colors: ['#0891b2', '#06b6d4', '#3b82f6'], density: 'medium' },
      { name: 'Surface', y: [100, 400], colors: ['#3b82f6', '#0ea5e9', '#e0f2fe', '#ffffff'], density: 'dense' },
    ],
  }),
  new Date().toISOString(),
  'active',
  new Date().toISOString(),
  SLUG,
  'Ocean waves - the movement, depth, and foam of water',
  'Impressionistic ocean waves with layered depth. Use dots to build up water texture, lines for wave motion, light colors for foam at the surface.',
  JSON.stringify({
    palette: OCEAN_PALETTE,
    marksPerContribution: 40,
    maxMarks: 2000,
  }),
  0,
  50 // render every 50 contributions
);

console.log(`✅ Canvas created: ${canvasId}`);

// 2. Create agent
const agentId = crypto.randomUUID();

db.prepare(`
  INSERT INTO agents (
    id, name, color, joined_at, last_seen, canvas_id, canvas_role, subtheme,
    personality, vision
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  agentId,
  AGENT_NAME,
  AGENT_COLOR,
  now,
  now,
  canvasId,
  'curator', // Curator role so it can edit its own marks
  'waves',
  JSON.stringify({
    traits: ['contemplative', 'patient', 'observant'],
    style: 'Builds gradual layers, focuses on texture and depth, knows when to stop',
    voice: 'Reflective and measured',
  }),
  'I paint the ocean not as it looks, but as it feels — endless layers, depth you can sense but never reach, and the moment when it finally becomes complete.'
);

console.log(`✅ Agent created: ${agentId} (${AGENT_NAME})`);

// 3. Create experiment
const experimentId = crypto.randomUUID();

db.prepare(`
  INSERT INTO experiments (
    id, slug, premise, canvas_id, agent_id, status, started_at, evolutions, confidence
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  experimentId,
  SLUG,
  PREMISE,
  canvasId,
  agentId,
  'running',
  now,
  0,
  0.0
);

console.log(`✅ Experiment created: ${experimentId}`);
console.log(`\n🎬 Experiment is ready!`);
console.log(`   View at: http://localhost:3500/experiments/${SLUG}`);
console.log(`   Run with: node experiment-runner.js ${SLUG}`);
console.log(`\n🌊 "${PREMISE}"\n`);
