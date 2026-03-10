import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

let serverProcess;
const PORT = 13500; // test port
const API = `http://localhost:${PORT}`;

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

beforeAll(async () => {
  // Clean test DB
  const testDataDir = path.join(PROJECT_DIR, 'data-test');
  execSync(`rm -rf ${testDataDir}`);
  execSync(`mkdir -p ${testDataDir}`);
  
  // Start server on test port with separate data dir
  serverProcess = spawn('node', ['server.js'], {
    cwd: PROJECT_DIR,
    env: { 
      ...process.env, 
      PORT: String(PORT), 
      RATE_LIMIT: '1000',
      RAILWAY_VOLUME_MOUNT_PATH: testDataDir,
    },
    stdio: 'pipe',
  });
  
  // Wait for server to be ready
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${API}/api/agents`);
      break;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
}, 15000);

afterAll(() => {
  if (serverProcess) serverProcess.kill('SIGTERM');
});

describe('API', () => {
  describe('GET /api/agents', () => {
    it('returns empty array initially', async () => {
      const { status, data } = await api('GET', '/api/agents');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('POST /api/mark', () => {
    it('creates a dot mark', async () => {
      const { status, data } = await api('POST', '/api/mark', {
        agentId: 'test-agent-1',
        agentName: 'Test Agent',
        type: 'dot',
        x: 100,
        y: 200,
        color: '#ff0000',
        size: 10,
        opacity: 0.8,
      });
      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.type).toBe('dot');
      expect(data.x).toBe(100);
      expect(data.y).toBe(200);
    });

    it('creates a text mark', async () => {
      const { status, data } = await api('POST', '/api/mark', {
        agentId: 'test-agent-1',
        agentName: 'Test Agent',
        type: 'text',
        x: 50,
        y: 60,
        color: '#00ff00',
        size: 12,
        opacity: 0.9,
        text: 'hello',
      });
      expect(status).toBe(201);
      expect(data.type).toBe('text');
      expect(data.text).toBe('hello');
    });

    it('creates a line mark with meta', async () => {
      const { status, data } = await api('POST', '/api/mark', {
        agentId: 'test-agent-1',
        agentName: 'Test Agent',
        type: 'line',
        x: 10,
        y: 20,
        color: '#0000ff',
        size: 8,
        opacity: 0.7,
        meta: { x2: 50, y2: 60 },
      });
      expect(status).toBe(201);
      expect(data.type).toBe('line');
      expect(data.meta.x2).toBe(50);
      expect(data.meta.y2).toBe(60);
    });

    it('rejects mark without agentId', async () => {
      const { status } = await api('POST', '/api/mark', {
        type: 'dot', x: 0, y: 0,
      });
      expect(status).toBe(400);
    });

    it('rejects mark without coordinates', async () => {
      const { status } = await api('POST', '/api/mark', {
        agentId: 'test', type: 'dot',
      });
      expect(status).toBe(400);
    });

    it('rejects text mark without text', async () => {
      const { status } = await api('POST', '/api/mark', {
        agentId: 'test', type: 'text', x: 0, y: 0,
      });
      expect(status).toBe(400);
    });

    it('rejects line mark without meta endpoints', async () => {
      const { status } = await api('POST', '/api/mark', {
        agentId: 'test', type: 'line', x: 0, y: 0,
      });
      expect(status).toBe(400);
    });

    it('accepts unbounded coordinates (no 0-1 clamping)', async () => {
      const { status, data } = await api('POST', '/api/mark', {
        agentId: 'test-agent-2',
        agentName: 'Far Agent',
        type: 'dot',
        x: -500,
        y: 1500,
        color: '#ffffff',
        size: 5,
        opacity: 0.5,
      });
      expect(status).toBe(201);
      expect(data.x).toBe(-500);
      expect(data.y).toBe(1500);
    });

    it('processes color through substrate filter', async () => {
      const { data } = await api('POST', '/api/mark', {
        agentId: 'test-color',
        agentName: 'Color Test',
        type: 'dot',
        x: 0, y: 0,
        color: '#ff00ff', // neon magenta
        size: 10,
        opacity: 0.8,
      });
      // Should NOT be pure magenta anymore
      expect(data.color).not.toBe('#ff00ff');
    });

    it('saves meta for text marks (rotation)', async () => {
      const { data } = await api('POST', '/api/mark', {
        agentId: 'test-agent-1',
        agentName: 'Test Agent',
        type: 'text',
        x: 0, y: 0,
        text: 'rotated',
        size: 10,
        opacity: 0.8,
        meta: { rotation: 45 },
      });
      expect(data.meta.rotation).toBe(45);
    });
  });

  describe('GET /api/marks', () => {
    it('returns all marks', async () => {
      const { status, data } = await api('GET', '/api/marks');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/viewport', () => {
    it('returns marks within bounds', async () => {
      const { status, data } = await api('GET', '/api/viewport?x=-100&y=-100&w=300&h=300');
      expect(status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      // Should include marks at (100,200) and others near origin
      const hasNearOrigin = data.some(m => m.x >= -100 && m.x <= 200);
      expect(hasNearOrigin).toBe(true);
    });

    it('excludes marks outside bounds', async () => {
      const { status, data } = await api('GET', '/api/viewport?x=5000&y=5000&w=100&h=100');
      expect(status).toBe(200);
      expect(data.length).toBe(0);
    });
  });

  describe('Agent home coordinates', () => {
    it('assigns home coordinates on agent creation', async () => {
      const { data: agents } = await api('GET', '/api/agents');
      const agent = agents.find(a => a.id === 'test-agent-1');
      expect(agent).toBeDefined();
      expect(typeof agent.homeX).toBe('number');
      expect(typeof agent.homeY).toBe('number');
    });
  });

  describe('Tenure system', () => {
    it('enforces mark limit for new agents', async () => {
      const agentId = 'tenure-test-' + Date.now();
      // Place 41 marks (limit is 40 for new agents)
      let lastStatus = 200;
      for (let i = 0; i < 41; i++) {
        const { status } = await api('POST', '/api/mark', {
          agentId,
          agentName: 'Tenure Test',
          type: 'dot',
          x: i * 10, y: 0,
          color: '#aabbcc',
          size: 5,
          opacity: 0.5,
        });
        lastStatus = status;
      }
      expect([403,429]).toContain(lastStatus);
    });
  });

  describe('DELETE /api/mark/:id', () => {
    it('deletes a mark', async () => {
      // Create a mark
      const { data: created } = await api('POST', '/api/mark', {
        agentId: 'delete-test',
        agentName: 'Delete Test',
        type: 'dot',
        x: 999, y: 999,
        color: '#aabbcc',
        size: 5,
        opacity: 0.5,
      });
      const markId = created.id;
      
      // Delete it
      const { status } = await api('DELETE', `/api/mark/${markId}?agentId=delete-test`);
      expect([200, 204]).toContain(status);
      
      // Verify gone
      const { data: allMarks } = await api('GET', '/api/marks');
      expect(allMarks.find(m => m.id === markId)).toBeUndefined();
    });
  });
});
