#!/usr/bin/env node
/**
 * Seed the Freedom experiment: "You have a canvas. No rules. No subject. Make something."
 * 
 * Creates:
 * - A canvas with "open" theme (minimal spatial guide)
 * - An unnamed agent (let it name itself in reflections)
 * - The experiment record with freedom axis
 * 
 * Usage: node seed-freedom.js
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

// Basic schema check
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

const PREMISE = "You have a canvas. No rules. No subject. Make something.";
const SLUG = "freedom";
const CANVAS_THEME = "open";
const AGENT_NAME = "Unknown"; // Let agent name itself
const AGENT_COLOR = "#ffffff"; // Default white - agent can choose

console.log('🎨 Seeding experiment: "Freedom"');

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
  JSON.stringify([]),
  'The canvas is -500 to 500 on both axes. That is all.',
  new Date().toISOString(),
  'active',
  new Date().toISOString(),
  SLUG,
  '', // No subject
  '', // No style prompt
  JSON.stringify({}),
  0,
  50
);

console.log(`✅ Canvas created: ${canvasId}`);

// 2. Create agent (unnamed - let it name itself)
const agentId = crypto.randomUUID();

db.prepare(`
  INSERT INTO agents (
    id, name, color, joined_at, last_seen, canvas_id, canvas_role,
    personality
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  agentId,
  AGENT_NAME,
  AGENT_COLOR,
  now,
  now,
  canvasId,
  'curator',
  'An artist with complete freedom to create anything.'
);

console.log(`✅ Agent created: ${agentId} (${AGENT_NAME})`);

// 3. Create experiment with freedom axis and max_evolutions = 20
const experimentId = crypto.randomUUID();

db.prepare(`
  INSERT INTO experiments (
    id, slug, premise, canvas_id, agent_id, status, started_at, evolutions, confidence,
    axes, max_evolutions
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  experimentId,
  SLUG,
  PREMISE,
  canvasId,
  agentId,
  'running',
  now,
  0,
  0.0,
  JSON.stringify(['freedom']),
  20
);

console.log(`✅ Experiment created: ${experimentId}`);
console.log(`\n🎨 Freedom experiment is ready!`);
console.log(`   View at: http://localhost:3500/experiments/${SLUG}`);
console.log(`   Run with: node experiment-runner.js ${SLUG}`);
console.log(`\n✨ "${PREMISE}"\n`);
