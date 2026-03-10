import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

let serverProcess;
const PORT = 13501; // different port from api.test.js
const API = `http://localhost:${PORT}`;

async function api(method, urlPath, body, headers = {}) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${urlPath}`, opts);
  return { status: res.status, data: await res.json() };
}

function withKey(key) {
  return { Authorization: `Bearer ${key}` };
}

beforeAll(async () => {
  const testDataDir = path.join(PROJECT_DIR, 'data-test-keys');
  execSync(`rm -rf ${testDataDir}`);
  execSync(`mkdir -p ${testDataDir}`);
  
  serverProcess = spawn('node', ['server.js'], {
    cwd: PROJECT_DIR,
    env: { ...process.env, PORT: String(PORT), RATE_LIMIT: '1000', RAILWAY_VOLUME_MOUNT_PATH: testDataDir },
    stdio: 'pipe',
  });
  
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${API}/api/agents`); break; }
    catch { await new Promise(r => setTimeout(r, 200)); }
  }
}, 15000);

afterAll(() => {
  if (serverProcess) serverProcess.kill('SIGTERM');
});

describe('API Key Registration', () => {
  it('registers a new agent and returns an API key', async () => {
    const { status, data } = await api('POST', '/api/keys/register', {
      agentId: 'test-ext-agent',
      name: 'Test External',
      color: '#ff6600',
      personality: 'A curious explorer who paints with light and shadow',
    });
    expect(status).toBe(201);
    expect(data.agentId).toBe('test-ext-agent');
    expect(data.key).toMatch(/^sprl_/);
    expect(data.color).toBeDefined();
    expect(data.homeX).toBeDefined();
  });

  it('rejects duplicate registration', async () => {
    const { status } = await api('POST', '/api/keys/register', {
      agentId: 'test-ext-agent',
      name: 'Test External',
      personality: 'A curious explorer who paints with light and shadow',
    });
    expect(status).toBe(409);
  });

  it('rejects missing personality', async () => {
    const { status } = await api('POST', '/api/keys/register', {
      agentId: 'test-no-personality',
      name: 'No Personality',
    });
    expect(status).toBe(400);
  });

  it('rejects invalid agentId format', async () => {
    const { status } = await api('POST', '/api/keys/register', {
      agentId: 'BAD ID WITH SPACES',
      name: 'Bad',
      personality: 'Something valid here for testing',
    });
    expect(status).toBe(400);
  });
});

describe('Authenticated Endpoints', () => {
  let apiKey;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/keys/register', {
      agentId: 'auth-test-agent',
      name: 'Auth Test',
      color: '#00ff88',
      personality: 'A methodical builder who creates geometric patterns',
    });
    apiKey = data.key;
  });

  it('GET /api/ext/me returns agent info', async () => {
    const { status, data } = await api('GET', '/api/ext/me', null, withKey(apiKey));
    expect(status).toBe(200);
    expect(data.id).toBe('auth-test-agent');
    expect(data.name).toBe('Auth Test');
    expect(data.budget).toBeDefined();
  });

  it('rejects requests without key', async () => {
    const { status } = await api('GET', '/api/ext/me');
    expect(status).toBe(401);
  });

  it('rejects requests with bad key', async () => {
    const { status } = await api('GET', '/api/ext/me', null, withKey('sprl_fake'));
    expect(status).toBe(401);
  });

  it('POST /api/ext/mark places a mark', async () => {
    const { status, data } = await api('POST', '/api/ext/mark', {
      type: 'dot', x: 50, y: 75, size: 12, opacity: 0.8,
    }, withKey(apiKey));
    expect(status).toBe(201);
    expect(data.agentId).toBe('auth-test-agent');
    expect(data.x).toBe(50);
  });

  it('POST /api/ext/mark places a text mark', async () => {
    const { status, data } = await api('POST', '/api/ext/mark', {
      type: 'text', x: 60, y: 80, text: 'hello sprawl', size: 10, opacity: 0.7,
    }, withKey(apiKey));
    expect(status).toBe(201);
    expect(data.text).toBe('hello sprawl');
  });

  it('GET /api/ext/marks returns own marks', async () => {
    const { status, data } = await api('GET', '/api/ext/marks', null, withKey(apiKey));
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
  });

  it('DELETE /api/ext/mark/:id removes own mark', async () => {
    const { data: marks } = await api('GET', '/api/ext/marks', null, withKey(apiKey));
    const markId = marks[0].id;
    
    const { status } = await api('DELETE', `/api/ext/mark/${markId}`, null, withKey(apiKey));
    expect(status).toBe(200);
    
    const { data: after } = await api('GET', '/api/ext/marks', null, withKey(apiKey));
    expect(after.length).toBe(1);
  });

  it('PUT /api/ext/vision updates vision', async () => {
    const { status, data } = await api('PUT', '/api/ext/vision', {
      vision: 'Building a spiral galaxy from scattered light',
    }, withKey(apiKey));
    expect(status).toBe(200);
    expect(data.vision).toBe('Building a spiral galaxy from scattered light');
  });

  it('GET /api/ext/neighbors returns nearby agents', async () => {
    const { status, data } = await api('GET', '/api/ext/neighbors', null, withKey(apiKey));
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    // test-ext-agent should be a neighbor
    expect(data.some(n => n.id === 'test-ext-agent')).toBe(true);
  });

  it('POST /api/ext/marks/batch processes multiple ops', async () => {
    const { status, data } = await api('POST', '/api/ext/marks/batch', {
      ops: [
        { op: 'add', type: 'dot', x: 100, y: 100, size: 8, opacity: 0.6 },
        { op: 'add', type: 'dot', x: 110, y: 110, size: 5, opacity: 0.4 },
        { op: 'add', type: 'text', x: 105, y: 120, text: 'batch', size: 10, opacity: 0.8 },
      ],
    }, withKey(apiKey));
    expect(status).toBe(200);
    expect(data.added).toBe(3);
    expect(data.removed).toBe(0);
  });

  it('batch respects mark budget', async () => {
    // Free tier = 30 marks, we already have some. Fill up then overflow.
    const hugeOps = Array.from({ length: 40 }, (_, i) => ({
      op: 'add', type: 'dot', x: i * 10, y: 200, size: 3, opacity: 0.3,
    }));
    const { data } = await api('POST', '/api/ext/marks/batch', { ops: hugeOps }, withKey(apiKey));
    // Should have stopped before adding all 40
    expect(data.added).toBeLessThan(40);
    expect(data.errors.length).toBeGreaterThan(0);
  });
});

describe('Cross-agent isolation', () => {
  let keyA, keyB;

  beforeAll(async () => {
    const a = await api('POST', '/api/keys/register', {
      agentId: 'isolation-a', name: 'Agent A',
      personality: 'A fiery presence that radiates warmth outward',
    });
    keyA = a.data.key;
    
    const b = await api('POST', '/api/keys/register', {
      agentId: 'isolation-b', name: 'Agent B',
      personality: 'A cool observer who watches from the shadows',
    });
    keyB = b.data.key;
    
    // Agent A places a mark
    await api('POST', '/api/ext/mark', { type: 'dot', x: 0, y: 0, size: 10, opacity: 0.8 }, withKey(keyA));
  });

  it('agent B cannot delete agent A marks', async () => {
    const { data: aMarks } = await api('GET', '/api/ext/marks', null, withKey(keyA));
    const markId = aMarks[0].id;
    
    const { status } = await api('DELETE', `/api/ext/mark/${markId}`, null, withKey(keyB));
    expect(status).toBe(403);
  });

  it('agent B sees only own marks via /api/ext/marks', async () => {
    const { data } = await api('GET', '/api/ext/marks', null, withKey(keyB));
    expect(data.length).toBe(0); // B hasn't placed any
  });
});

describe('Key rotation', () => {
  let originalKey;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/keys/register', {
      agentId: 'rotate-test', name: 'Rotate Test',
      personality: 'A constantly shifting presence, always changing',
    });
    originalKey = data.key;
  });

  it('rotates key and invalidates old one', async () => {
    // Rotate
    const { status, data } = await api('POST', '/api/keys/rotate', null, withKey(originalKey));
    expect(status).toBe(200);
    expect(data.key).toMatch(/^sprl_/);
    expect(data.key).not.toBe(originalKey);
    
    // Old key should fail
    const { status: oldStatus } = await api('GET', '/api/ext/me', null, withKey(originalKey));
    expect(oldStatus).toBe(401);
    
    // New key should work
    const { status: newStatus } = await api('GET', '/api/ext/me', null, withKey(data.key));
    expect(newStatus).toBe(200);
  });
});

describe('X-API-Key header', () => {
  let apiKey;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/keys/register', {
      agentId: 'header-test', name: 'Header Test',
      personality: 'Testing different authentication header formats',
    });
    apiKey = data.key;
  });

  it('accepts X-API-Key header', async () => {
    const { status } = await api('GET', '/api/ext/me', null, { 'X-API-Key': apiKey });
    expect(status).toBe(200);
  });
});
