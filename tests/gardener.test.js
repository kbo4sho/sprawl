/**
 * Gardener Module Tests
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  THEME_POOL,
  SUBTHEME_MAP,
  generateCanvas,
  assignAgent,
  startWeek,
} from '../gardener.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, 'test-gardener.db');

describe('Gardener Module', () => {
  let db;

  beforeAll(() => {
    // Clean up any existing test DB
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }

    // Create test database
    db = new Database(TEST_DB);
    db.pragma('foreign_keys = ON');

    // Create tables
    db.exec(`
      CREATE TABLE canvases (
        id TEXT PRIMARY KEY,
        theme TEXT NOT NULL,
        subthemes TEXT NOT NULL,
        spatial_guide TEXT NOT NULL,
        week_of TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        frozen_at TEXT,
        snapshot_url TEXT,
        timelapse_url TEXT
      );

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#ffffff',
        personality TEXT DEFAULT NULL,
        canvas_id TEXT DEFAULT NULL REFERENCES canvases(id),
        subtheme TEXT DEFAULT NULL,
        joined_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
    `);
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) {
      fs.unlinkSync(TEST_DB);
    }
  });

  it('should have 30+ themes in pool', () => {
    expect(THEME_POOL.length).toBeGreaterThanOrEqual(30);
  });

  it('should have concrete visual subjects (not abstract concepts)', () => {
    // All themes should describe concrete things, not abstract concepts
    const abstract = THEME_POOL.filter(t => {
      const lower = t.toLowerCase();
      // Abstract concepts to avoid
      const badWords = ['emergence', 'transformation', 'evolution', 'growth', 'change', 'becoming'];
      return badWords.some(word => lower.includes(word) && !lower.includes('emerging')); 
    });
    
    expect(abstract).toEqual([]);
  });

  it('should generate a canvas with valid structure', () => {
    const canvas = generateCanvas(db);

    expect(canvas.id).toBeTruthy();
    expect(canvas.theme).toBeTruthy();
    expect(THEME_POOL).toContain(canvas.theme);
    expect(Array.isArray(canvas.subthemes)).toBe(true);
    expect(canvas.subthemes.length).toBeGreaterThanOrEqual(4);
    expect(canvas.subthemes.length).toBeLessThanOrEqual(6);
    expect(canvas.spatial_guide).toBeTruthy();
    expect(canvas.week_of).toBeTruthy();
    expect(canvas.status).toBe('active');
  });

  it('should create canvas in database', () => {
    const theme = 'A flower blooming from darkness';
    const canvas = generateCanvas(db, theme);

    const row = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvas.id);
    expect(row).toBeTruthy();
    expect(row.theme).toBe(theme);
    expect(row.status).toBe('active');
  });

  it('should generate subthemes with required fields', () => {
    const canvas = generateCanvas(db);

    for (const subtheme of canvas.subthemes) {
      expect(subtheme.name).toBeTruthy();
      expect(subtheme.spatial_guide).toBeTruthy();
      expect(typeof subtheme.agent_cap).toBe('number');
      expect(subtheme.agent_cap).toBeGreaterThanOrEqual(1);
      expect(subtheme.agent_cap).toBeLessThanOrEqual(4);
    }
  });

  it('should have detailed spatial guides with coordinate ranges', () => {
    const canvas = generateCanvas(db, 'A flower blooming from darkness');

    for (const subtheme of canvas.subthemes) {
      const guide = subtheme.spatial_guide;
      
      // Should mention coordinates, ranges, or spatial instructions
      const hasCoords = /\d+px|\(\d+,\s*\d+\)|x=|y=|center/i.test(guide);
      const hasSizes = /size|opacity|dots/i.test(guide);
      
      expect(hasCoords || hasSizes).toBe(true);
      
      // Should be substantial (not just a one-liner)
      expect(guide.length).toBeGreaterThan(100);
    }
  });

  it('should assign agent to subtheme with room', () => {
    const canvas = generateCanvas(db, 'A city skyline at night');
    
    // Create test agent
    const agentId = 'test-agent-1';
    db.prepare(`
      INSERT INTO agents (id, name, color, personality, joined_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agentId, 'Test Agent', '#ff0000', 'I love building tall structures', Date.now(), Date.now());

    const result = assignAgent(db, canvas.id, agentId);

    expect(result.error).toBeFalsy();
    expect(result.subtheme).toBeTruthy();
    expect(result.canvas_id).toBe(canvas.id);

    // Check agent was updated
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    expect(agent.canvas_id).toBe(canvas.id);
    expect(agent.subtheme).toBe(result.subtheme);
  });

  it('should match personality to subtheme', () => {
    const canvas = generateCanvas(db, 'A city skyline at night');
    
    // Agent with "tower" personality should get towers subtheme
    const agentId = 'test-agent-tower';
    db.prepare(`
      INSERT INTO agents (id, name, color, personality, joined_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agentId, 'Tower Agent', '#888888', 'I build tall structures and towers', Date.now(), Date.now());

    const result = assignAgent(db, canvas.id, agentId);

    expect(result.subtheme).toBe('towers');
  });

  it('should respect agent_cap limits', () => {
    const canvas = generateCanvas(db, 'A flower blooming from darkness');
    const subthemes = JSON.parse(db.prepare('SELECT subthemes FROM canvases WHERE id = ?').get(canvas.id).subthemes);
    
    // Find a subtheme with agent_cap = 1 (atmosphere)
    const atmosphereSubtheme = subthemes.find(s => s.agent_cap === 1);
    expect(atmosphereSubtheme).toBeTruthy();

    // Create 2 agents and assign both to canvas
    for (let i = 1; i <= 2; i++) {
      const agentId = `test-agent-cap-${i}`;
      db.prepare(`
        INSERT INTO agents (id, name, color, personality, joined_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(agentId, `Agent ${i}`, '#ffffff', 'atmosphere subtle air', Date.now(), Date.now());

      const result = assignAgent(db, canvas.id, agentId);
      
      if (i === 1) {
        // First agent should get atmosphere
        expect(result.subtheme).toBe(atmosphereSubtheme.name);
      } else {
        // Second agent should NOT get atmosphere (cap is 1)
        expect(result.subtheme).not.toBe(atmosphereSubtheme.name);
      }
    }
  });

  it('should return error when all subthemes full', () => {
    const canvas = generateCanvas(db, 'A flower blooming from darkness');
    const subthemes = JSON.parse(db.prepare('SELECT subthemes FROM canvases WHERE id = ?').get(canvas.id).subthemes);
    
    // Calculate total capacity
    const totalCap = subthemes.reduce((sum, s) => sum + s.agent_cap, 0);
    
    // Fill all slots
    for (let i = 0; i < totalCap; i++) {
      const agentId = `fill-agent-${i}`;
      db.prepare(`
        INSERT INTO agents (id, name, color, joined_at, last_seen)
        VALUES (?, ?, ?, ?, ?)
      `).run(agentId, `Filler ${i}`, '#ffffff', Date.now(), Date.now());
      
      assignAgent(db, canvas.id, agentId);
    }

    // Try to add one more
    const overflowId = 'overflow-agent';
    db.prepare(`
      INSERT INTO agents (id, name, color, joined_at, last_seen)
      VALUES (?, ?, ?, ?, ?)
    `).run(overflowId, 'Overflow', '#ffffff', Date.now(), Date.now());

    const result = assignAgent(db, canvas.id, overflowId);
    
    expect(result.error).toBeTruthy();
    expect(result.error.toLowerCase()).toMatch(/full|capacity/);
  });

  it('should create weekly canvas with startWeek', () => {
    const canvas = startWeek(db);

    expect(canvas.id).toBeTruthy();
    expect(canvas.theme).toBeTruthy();
    expect(THEME_POOL).toContain(canvas.theme);
    expect(canvas.status).toBe('active');

    // Check it's in DB
    const row = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvas.id);
    expect(row).toBeTruthy();
  });

  it('should use mapped subthemes for known themes', () => {
    const canvas1 = generateCanvas(db, 'A flower blooming from darkness');
    const canvas2 = generateCanvas(db, 'A city skyline at night');

    // Flower should have petals, center, stem, atmosphere
    const flowerNames = canvas1.subthemes.map(s => s.name);
    expect(flowerNames).toContain('petals');
    expect(flowerNames).toContain('center');
    expect(flowerNames).toContain('stem');
    expect(flowerNames).toContain('atmosphere');

    // City should have towers, windows, sky, ground, atmosphere
    const cityNames = canvas2.subthemes.map(s => s.name);
    expect(cityNames).toContain('towers');
    expect(cityNames).toContain('windows');
    expect(cityNames).toContain('sky');
    expect(cityNames).toContain('ground');
  });

  it('should use default subthemes for unmapped themes', () => {
    const canvas = generateCanvas(db, 'A spiral galaxy with glowing arms');

    // Should have 4 default subthemes
    expect(canvas.subthemes.length).toBe(4);
    
    const names = canvas.subthemes.map(s => s.name);
    expect(names).toContain('structure');
    expect(names).toContain('detail');
    expect(names).toContain('background');
    expect(names).toContain('accent');
  });
});
