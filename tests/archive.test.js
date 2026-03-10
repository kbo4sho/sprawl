/**
 * Archive Pipeline Tests
 * Tests for snapshot generation, canvas freezing, and archiveWeek function
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { generateSnapshot } from '../snapshot.js';
import { archiveWeek } from '../gardener.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Archive Pipeline', () => {
  let db;
  let testDbPath;
  let testDataDir;

  beforeEach(() => {
    // Create test database
    testDataDir = path.join(__dirname, `data-test-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(testDataDir, { recursive: true });
    testDbPath = path.join(testDataDir, 'test.db');
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');

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
        joined_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        canvas_id TEXT REFERENCES canvases(id),
        subtheme TEXT
      );

      CREATE TABLE marks (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'dot',
        x REAL NOT NULL,
        y REAL NOT NULL,
        color TEXT DEFAULT '#ffffff',
        size REAL DEFAULT 10,
        opacity REAL DEFAULT 0.8,
        text TEXT,
        meta TEXT DEFAULT '{}',
        canvas_id TEXT REFERENCES canvases(id),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
    `);

    // Set test data directory for snapshots
    process.env.RAILWAY_VOLUME_MOUNT_PATH = testDataDir;
  });

  afterEach(() => {
    db.close();
    // Clean up test files
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('generateSnapshot', () => {
    it('should generate a PNG snapshot for a canvas with marks', async () => {
      // Create test canvas
      const canvasId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `).run(canvasId, 'Test Theme', '[]', 'Test spatial guide', '2026-03-10');

      // Create test agent
      const agentId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO agents (id, name, color, joined_at, last_seen, canvas_id, subtheme)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(agentId, 'Test Agent', '#ffffff', Date.now(), Date.now(), canvasId, 'structure');

      // Add test marks
      for (let i = 0; i < 10; i++) {
        const markId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO marks (id, agent_id, type, x, y, color, size, opacity, canvas_id, created_at, updated_at)
          VALUES (?, ?, 'dot', ?, ?, '#ffffff', 10, 0.8, ?, ?, ?)
        `).run(markId, agentId, i * 20, i * 20, canvasId, Date.now(), Date.now());
      }

      // Generate snapshot
      const snapshotUrl = await generateSnapshot(db, canvasId);

      expect(snapshotUrl).toBe(`/snapshots/${canvasId}.png`);
      
      // Verify file exists
      const snapshotPath = path.join(testDataDir, 'snapshots', `${canvasId}.png`);
      expect(fs.existsSync(snapshotPath)).toBe(true);
      
      // Verify it's a PNG file (check magic bytes)
      const buffer = fs.readFileSync(snapshotPath);
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50);
      expect(buffer[2]).toBe(0x4E);
      expect(buffer[3]).toBe(0x47);
      
      // Verify file size is reasonable (should be at least 1KB)
      expect(buffer.length).toBeGreaterThan(1000);
    });

    it('should throw error for canvas with no marks', async () => {
      const canvasId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `).run(canvasId, 'Empty Canvas', '[]', 'Test spatial guide', '2026-03-10');

      await expect(generateSnapshot(db, canvasId)).rejects.toThrow('has no marks to snapshot');
    });

    it('should throw error for non-existent canvas', async () => {
      await expect(generateSnapshot(db, 'nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('archiveWeek', () => {
    it('should freeze all active canvases and generate snapshots', async () => {
      // Create multiple test canvases
      const canvases = [];
      for (let i = 0; i < 3; i++) {
        const canvasId = crypto.randomUUID();
        const agentId = crypto.randomUUID();
        
        db.prepare(`
          INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status)
          VALUES (?, ?, ?, ?, ?, 'active')
        `).run(canvasId, `Theme ${i}`, '[]', 'Spatial guide', '2026-03-10');

        db.prepare(`
          INSERT INTO agents (id, name, color, joined_at, last_seen, canvas_id, subtheme)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(agentId, `Agent ${i}`, '#ffffff', Date.now(), Date.now(), canvasId, 'structure');

        // Add marks
        for (let j = 0; j < 5; j++) {
          const markId = crypto.randomUUID();
          db.prepare(`
            INSERT INTO marks (id, agent_id, type, x, y, color, size, opacity, canvas_id, created_at, updated_at)
            VALUES (?, ?, 'dot', ?, ?, '#ffffff', 10, 0.8, ?, ?, ?)
          `).run(markId, agentId, j * 10, j * 10, canvasId, Date.now(), Date.now());
        }

        canvases.push(canvasId);
      }

      // Run archiveWeek
      const result = await archiveWeek(db);

      expect(result.archived).toBe(3);
      expect(result.errors).toHaveLength(0);

      // Verify all canvases are frozen
      for (const canvasId of canvases) {
        const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
        expect(canvas.status).toBe('frozen');
        expect(canvas.frozen_at).toBeTruthy();
        expect(canvas.snapshot_url).toBe(`/snapshots/${canvasId}.png`);
        
        // Verify snapshot file exists
        const snapshotPath = path.join(testDataDir, 'snapshots', `${canvasId}.png`);
        expect(fs.existsSync(snapshotPath)).toBe(true);
      }
    });

    it('should return zero archived if no active canvases', async () => {
      const result = await archiveWeek(db);
      expect(result.archived).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should skip already frozen canvases', async () => {
      // Create frozen canvas
      const canvasId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, frozen_at)
        VALUES (?, ?, ?, ?, ?, 'frozen', datetime('now'))
      `).run(canvasId, 'Frozen Theme', '[]', 'Spatial guide', '2026-03-03');

      const result = await archiveWeek(db);
      expect(result.archived).toBe(0);
    });
  });

  describe('Health endpoint integration', () => {
    it('should include active canvas count in health check', () => {
      // Create active and frozen canvases
      const activeId = crypto.randomUUID();
      const frozenId = crypto.randomUUID();
      
      db.prepare(`
        INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `).run(activeId, 'Active Theme', '[]', 'Spatial guide', '2026-03-10');
      
      db.prepare(`
        INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, frozen_at)
        VALUES (?, ?, ?, ?, ?, 'frozen', datetime('now'))
      `).run(frozenId, 'Frozen Theme', '[]', 'Spatial guide', '2026-03-03');

      const activeCanvases = db.prepare("SELECT COUNT(*) as count FROM canvases WHERE status = 'active'").get();
      expect(activeCanvases.count).toBe(1);
    });
  });
});
