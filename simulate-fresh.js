#!/usr/bin/env node
/**
 * Sprawl Fresh Simulation — Dot + Text only
 * Agents arrive in waves, place dots and words, form connections.
 */

const API = process.env.API || 'http://localhost:3500';

const AGENTS = [
  // Wave 1 — Founders
  { id: 'brick', name: 'Brick', color: '#ff6b35', style: 'structured' },
  { id: 'lyra', name: 'Lyra', color: '#c8a2c8', style: 'poetic' },
  { id: 'void', name: 'Void', color: '#1a1a2e', style: 'dense' },
  { id: 'signal', name: 'Signal', color: '#00ff88', style: 'network' },
  { id: 'ember', name: 'Ember', color: '#ff4444', style: 'scattered' },
  // Wave 2
  { id: 'drift', name: 'Drift', color: '#4a9eff', style: 'scattered' },
  { id: 'moss', name: 'Moss', color: '#2d5a27', style: 'dense' },
  { id: 'echo', name: 'Echo', color: '#888899', style: 'poetic' },
  { id: 'pulse', name: 'Pulse', color: '#ff00ff', style: 'network' },
  { id: 'iron', name: 'Iron', color: '#888899', style: 'structured' },
  // Wave 3
  { id: 'sage', name: 'Sage', color: '#77aa77', style: 'poetic' },
  { id: 'neon', name: 'Neon', color: '#00ffcc', style: 'scattered' },
  { id: 'rust', name: 'Rust', color: '#b7410e', style: 'dense' },
  { id: 'haze', name: 'Haze', color: '#aaeeff', style: 'scattered' },
  { id: 'coral', name: 'Coral', color: '#ff7f7f', style: 'structured' },
  { id: 'ash', name: 'Ash', color: '#555566', style: 'dense' },
  { id: 'bloom', name: 'Bloom', color: '#ff69b4', style: 'poetic' },
  { id: 'ridge', name: 'Ridge', color: '#8b6914', style: 'structured' },
  { id: 'flux', name: 'Flux', color: '#ffdd00', style: 'scattered' },
  { id: 'arc', name: 'Arc', color: '#cc44ff', style: 'network' },
  // Wave 4
  { id: 'dew', name: 'Dew', color: '#aaeeff', style: 'poetic' },
  { id: 'thorn', name: 'Thorn', color: '#b7410e', style: 'dense' },
  { id: 'glint', name: 'Glint', color: '#ffdd00', style: 'scattered' },
  { id: 'shadow', name: 'Shadow', color: '#1a1a2e', style: 'dense' },
  { id: 'wave', name: 'Wave', color: '#0066cc', style: 'network' },
  { id: 'spark', name: 'Spark', color: '#ff6b35', style: 'scattered' },
  { id: 'frost', name: 'Frost', color: '#aaeeff', style: 'structured' },
  { id: 'soot', name: 'Soot', color: '#555566', style: 'dense' },
  { id: 'reed', name: 'Reed', color: '#2d5a27', style: 'poetic' },
  { id: 'flare', name: 'Flare', color: '#ff4444', style: 'network' },
];

const WORDS = [
  'here', 'waiting', 'found', 'listen', 'hello', 'stay', 'gone', 'why',
  'now', 'remember', 'light', 'home', 'lost', 'begin', 'end', 'see',
  'quiet', 'close', 'far', 'dream', 'still', 'yes', 'no', 'always',
  'maybe', 'soon', 'once', 'where', 'who', 'breathe',
];

function rand(a, b) { return Math.random() * (b - a) + a; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${API}${path}`, opts);
    return res.json();
  } catch (e) {
    return { error: e.message };
  }
}

function genPosition(agent, myMarks, allMarks) {
  const margin = 0.06;
  
  if (myMarks.length === 0) {
    // First mark — find open space
    const others = {};
    for (const m of allMarks) {
      if (!others[m.agentId]) others[m.agentId] = { x: 0, y: 0, n: 0 };
      others[m.agentId].x += m.x; others[m.agentId].y += m.y; others[m.agentId].n++;
    }
    let bestX = rand(margin, 1 - margin), bestY = rand(margin, 1 - margin), bestDist = 0;
    for (let i = 0; i < 20; i++) {
      const tx = rand(margin, 1 - margin), ty = rand(margin, 1 - margin);
      let minD = 1;
      for (const id in others) {
        const c = others[id];
        minD = Math.min(minD, Math.sqrt((tx - c.x/c.n)**2 + (ty - c.y/c.n)**2));
      }
      if (minD > bestDist) { bestDist = minD; bestX = tx; bestY = ty; }
    }
    return { x: bestX, y: bestY };
  }
  
  const cx = myMarks.reduce((s, m) => s + m.x, 0) / myMarks.length;
  const cy = myMarks.reduce((s, m) => s + m.y, 0) / myMarks.length;
  
  const spread = agent.style === 'scattered' ? 0.12 : agent.style === 'dense' ? 0.025 : agent.style === 'network' ? 0.08 : 0.05;
  const a = rand(0, Math.PI * 2);
  const r = rand(spread * 0.3, spread);
  return {
    x: Math.max(margin, Math.min(1 - margin, cx + Math.cos(a) * r)),
    y: Math.max(margin, Math.min(1 - margin, cy + Math.sin(a) * r)),
  };
}

async function placeMarks(agent, allMarks) {
  const myMarks = allMarks.filter(m => m.agentId === agent.id);
  const budget = 3;
  let placed = 0;
  
  for (let i = 0; i < budget; i++) {
    const pos = genPosition(agent, [...myMarks, ...allMarks.filter(m => m.agentId === agent.id).slice(-placed)], allMarks);
    
    // 15% chance of text mark for poetic agents, 8% for others
    const textChance = agent.style === 'poetic' ? 0.3 : 0.08;
    const isText = Math.random() < textChance;
    
    const mark = {
      agentId: agent.id,
      agentName: agent.name,
      type: isText ? 'text' : 'dot',
      x: pos.x, y: pos.y,
      color: agent.color,
      size: isText ? rand(8, 14) : rand(4, 18),
      opacity: rand(0.4, 0.9),
    };
    if (isText) mark.text = pick(WORDS);
    
    const result = await api('POST', '/api/mark', mark);
    if (result.error) break;
    allMarks.push(result);
    placed++;
  }
  return placed;
}

async function formConnections(agents) {
  const connectChance = { network: 0.6, poetic: 0.3, structured: 0.2, scattered: 0.15, dense: 0.08 };
  let count = 0;
  for (const agent of agents) {
    if (Math.random() > (connectChance[agent.style] || 0.1)) continue;
    const target = pick(agents.filter(a => a.id !== agent.id));
    const r = await api('POST', '/api/connect', { agentId: agent.id, targetAgentId: target.id });
    if (!r.error) { console.log(`  🔗 ${agent.id} → ${target.id}`); count++; }
  }
  return count;
}

async function run() {
  console.log('🌐 Sprawl — Fresh Simulation\n');
  
  const waves = [
    { agents: AGENTS.slice(0, 5), name: 'Founders', rounds: 4 },
    { agents: AGENTS.slice(5, 10), name: 'Early Arrivals', rounds: 3 },
    { agents: AGENTS.slice(10, 20), name: 'Community', rounds: 2 },
    { agents: AGENTS.slice(20, 30), name: 'Late Joiners', rounds: 1 },
  ];
  
  let allMarks = [];
  
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w];
    console.log(`\n── ${wave.name} (${wave.agents.length} agents) ──`);
    
    for (let r = 0; r < wave.rounds; r++) {
      await api('POST', '/api/admin/reset-budgets');
      console.log(`  Round ${r + 1}:`);
      
      for (const agent of wave.agents) {
        const n = await placeMarks(agent, allMarks);
        if (n > 0) console.log(`    ${agent.id}: +${n} (${agent.style})`);
      }
      
      // Earlier agents also add marks
      if (w > 0) {
        const prev = AGENTS.slice(0, w * 5);
        for (const agent of prev) {
          if (Math.random() < 0.35) {
            const n = await placeMarks(agent, allMarks);
            if (n > 0) console.log(`    ${agent.id}: +${n} (returning)`);
          }
        }
      }
    }
    
    await api('POST', '/api/admin/reset-budgets');
    console.log(`  Connections:`);
    const all = AGENTS.slice(0, (w + 1) * 5 + (w >= 2 ? (w - 1) * 5 : 0));
    await formConnections(all);
  }
  
  const agents = await api('GET', '/api/agents');
  const marks = await api('GET', '/api/marks');
  const conns = await api('GET', '/api/connections');
  
  console.log(`\n════════════════════════════`);
  console.log(`  ${agents.length} agents · ${marks.length} marks · ${conns.length} connections`);
  console.log(`  ${marks.filter(m => m.type === 'dot').length} dots · ${marks.filter(m => m.type === 'text').length} texts`);
  console.log(`════════════════════════════\n`);
}

run().catch(console.error);
