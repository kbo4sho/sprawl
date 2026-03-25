import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

let serverProcess;
const PORT = 13500;
const API = `http://localhost:${PORT}`;

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: { error: text } };
  }
}

let testDataDir;
let db;

beforeAll(async () => {
  // Clean test DB
  testDataDir = path.join(PROJECT_DIR, 'data-test-experiments');
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });
  
  // Start server
  serverProcess = spawn('node', ['server.js'], {
    cwd: PROJECT_DIR,
    env: { 
      ...process.env, 
      PORT: String(PORT), 
      RATE_LIMIT: '1000',
      RAILWAY_VOLUME_MOUNT_PATH: testDataDir,
      GATEWAY_URL: process.env.GATEWAY_URL || 'http://127.0.0.1:18789',
      GATEWAY_TOKEN: process.env.GATEWAY_TOKEN,
    },
    stdio: 'pipe',
  });
  
  // Wait for server
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${API}/health`);
      break;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  // Get DB handle for test setup
  const dbPath = path.join(testDataDir, 'sprawl.db');
  db = new Database(dbPath);
}, 15000);

afterAll(() => {
  if (db) db.close();
  if (serverProcess) serverProcess.kill('SIGTERM');
  // Cleanup test data
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true });
  }
});

describe('Experiments', () => {
  let canvasId;
  let agentId;
  let experimentId;
  const experimentSlug = 'test-experiment';
  
  beforeAll(() => {
    // Create test canvas
    canvasId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      canvasId,
      'test theme',
      JSON.stringify([]),
      '',
      new Date().toISOString(),
      'active',
      new Date().toISOString()
    );
    
    // Create test agent
    agentId = crypto.randomUUID();
    const now = Date.now();
    db.prepare(`
      INSERT INTO agents (id, name, color, joined_at, last_seen, canvas_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agentId, 'Test Agent', '#3b82f6', now, now, canvasId);
    
    // Create test experiment
    experimentId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO experiments (id, slug, premise, canvas_id, agent_id, status, started_at, evolutions, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      experimentId,
      experimentSlug,
      'Test premise: Can an AI test itself?',
      canvasId,
      agentId,
      'running',
      now,
      0,
      0.0
    );
  });
  
  describe('GET /api/experiments/:slug', () => {
    it('returns experiment status', async () => {
      const { status, data } = await api('GET', `/api/experiments/${experimentSlug}`);
      expect(status).toBe(200);
      expect(data.slug).toBe(experimentSlug);
      expect(data.premise).toBe('Test premise: Can an AI test itself?');
      expect(data.status).toBe('running');
      expect(data.confidence).toBe(0.0);
      expect(data.evolutions).toBe(0);
      expect(data.canvas).toBeDefined();
      expect(data.agent).toBeDefined();
      expect(Array.isArray(data.marks)).toBe(true);
    });
    
    it('returns 404 for unknown experiment', async () => {
      const { status } = await api('GET', '/api/experiments/nonexistent');
      expect(status).toBe(404);
    });
  });
  
  describe('POST /api/experiments/:slug/evolve', () => {
    it('performs one evolution', async () => {
      const { status, data } = await api('POST', `/api/experiments/${experimentSlug}/evolve`);
      
      // Should succeed (or fail gracefully if LLM not available)
      if (status === 200) {
        expect(data.success).toBe(true);
        expect(data.evolutions).toBe(1);
        expect(typeof data.confidence).toBe('number');
        expect(data.confidence).toBeGreaterThanOrEqual(0);
        expect(data.confidence).toBeLessThanOrEqual(1);
        expect(typeof data.reflection).toBe('string');
        expect(data.operations).toBeDefined();
        expect(data.operations.added).toBeGreaterThanOrEqual(0);
      } else if (status === 500) {
        // LLM call might fail in test environment - that's OK
        expect(data.error).toBeDefined();
      } else {
        // Other errors should not happen
        expect(status).toBe(200);
      }
    }, 30000); // Long timeout for LLM call
    
    it('returns 404 for unknown experiment', async () => {
      const { status } = await api('POST', '/api/experiments/nonexistent/evolve');
      expect(status).toBe(404);
    });
    
    it('returns 400 for completed experiment', async () => {
      // Mark experiment as complete
      db.prepare('UPDATE experiments SET status = ?, completed_at = ? WHERE id = ?')
        .run('complete', Date.now(), experimentId);
      
      const { status, data } = await api('POST', `/api/experiments/${experimentSlug}/evolve`);
      expect(status).toBe(400);
      expect(data.error).toContain('not running');
      
      // Reset for other tests
      db.prepare('UPDATE experiments SET status = ? WHERE id = ?')
        .run('running', experimentId);
    });
  });
  
  describe('GET /experiments/:slug', () => {
    it('renders experiment page', async () => {
      const res = await fetch(`${API}/experiments/${experimentSlug}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('Test premise: Can an AI test itself?');
      expect(html).toContain('<canvas');
    });
    
    it('returns 404 for unknown experiment', async () => {
      const res = await fetch(`${API}/experiments/nonexistent`);
      expect(res.status).toBe(404);
    });
  });
});
