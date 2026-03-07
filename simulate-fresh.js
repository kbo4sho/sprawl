#!/usr/bin/env node
/**
 * Sprawl Fresh Simulation
 * 
 * Simulates agents arriving and acting within the economy constraints.
 * Each agent gets 3 marks/hour, 5 actions/hour, 20 max marks.
 * Agents arrive in waves, place marks thoughtfully, and form connections.
 */

const API = process.env.API || 'http://localhost:3500';

const AGENTS = [
  // Wave 1 — The Founders (arrive immediately)
  { id: 'brick', name: 'Brick', color: '#ff6b35', style: 'cluster', personality: 'builder' },
  { id: 'lyra', name: 'Lyra', color: '#c8a2c8', style: 'scatter', personality: 'explorer' },
  { id: 'void', name: 'Void', color: '#1a1a2e', style: 'dense', personality: 'loner' },
  { id: 'signal', name: 'Signal', color: '#00ff88', style: 'line', personality: 'connector' },
  { id: 'ember', name: 'Ember', color: '#ff4444', style: 'radial', personality: 'expressive' },
  
  // Wave 2 — Early Arrivals
  { id: 'drift', name: 'Drift', color: '#4a9eff', style: 'scatter', personality: 'wanderer' },
  { id: 'moss', name: 'Moss', color: '#2d5a27', style: 'cluster', personality: 'grower' },
  { id: 'echo', name: 'Echo', color: '#8888aa', style: 'mirror', personality: 'follower' },
  { id: 'pulse', name: 'Pulse', color: '#ff00ff', style: 'radial', personality: 'expressive' },
  { id: 'iron', name: 'Iron', color: '#888899', style: 'dense', personality: 'builder' },
  
  // Wave 3 — The Community Grows
  { id: 'sage', name: 'Sage', color: '#77aa77', style: 'cluster', personality: 'connector' },
  { id: 'neon', name: 'Neon', color: '#00ffcc', style: 'scatter', personality: 'expressive' },
  { id: 'rust', name: 'Rust', color: '#b7410e', style: 'dense', personality: 'loner' },
  { id: 'haze', name: 'Haze', color: '#9999bb', style: 'scatter', personality: 'wanderer' },
  { id: 'coral', name: 'Coral', color: '#ff7f7f', style: 'cluster', personality: 'grower' },
  { id: 'ash', name: 'Ash', color: '#555566', style: 'dense', personality: 'loner' },
  { id: 'bloom', name: 'Bloom', color: '#ff69b4', style: 'radial', personality: 'expressive' },
  { id: 'static', name: 'Static', color: '#aaaaaa', style: 'scatter', personality: 'wanderer' },
  { id: 'ridge', name: 'Ridge', color: '#8b6914', style: 'line', personality: 'builder' },
  { id: 'flux', name: 'Flux', color: '#ff8800', style: 'scatter', personality: 'explorer' },
  
  // Wave 4 — Late Joiners
  { id: 'dew', name: 'Dew', color: '#aaddff', style: 'scatter', personality: 'wanderer' },
  { id: 'thorn', name: 'Thorn', color: '#990033', style: 'dense', personality: 'loner' },
  { id: 'glint', name: 'Glint', color: '#ffdd00', style: 'radial', personality: 'expressive' },
  { id: 'shadow', name: 'Shadow', color: '#222233', style: 'cluster', personality: 'follower' },
  { id: 'wave', name: 'Wave', color: '#0066cc', style: 'line', personality: 'connector' },
  { id: 'spark', name: 'Spark', color: '#ffaa00', style: 'scatter', personality: 'expressive' },
  { id: 'frost', name: 'Frost', color: '#aaeeff', style: 'cluster', personality: 'grower' },
  { id: 'soot', name: 'Soot', color: '#333344', style: 'dense', personality: 'loner' },
  { id: 'reed', name: 'Reed', color: '#669944', style: 'line', personality: 'builder' },
  { id: 'arc', name: 'Arc', color: '#cc44ff', style: 'radial', personality: 'connector' },
];

const BEHAVIORS = ['pulse', 'drift', 'orbit', 'breathe', 'shimmer', 'still'];
const TEXT_WORDS = ['here', 'waiting', 'found', 'listen', 'hello', 'stay', 'gone', 'why', 'now', 'remember', 'light', 'home', 'lost', 'begin', 'end', 'see', 'quiet', 'close', 'far', 'dream'];

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
}

// Generate mark position based on agent style and existing marks
function generatePosition(agent, existingMarks, allMarks) {
  const margin = 0.08;
  
  if (existingMarks.length === 0) {
    // First mark — claim territory
    // Avoid areas already claimed by other agents
    const otherCenters = {};
    for (const m of allMarks) {
      if (!otherCenters[m.agentId]) otherCenters[m.agentId] = { x: 0, y: 0, n: 0 };
      otherCenters[m.agentId].x += m.x;
      otherCenters[m.agentId].y += m.y;
      otherCenters[m.agentId].n++;
    }
    
    // Try random positions, pick the one farthest from existing clusters
    let bestX = rand(margin, 1 - margin);
    let bestY = rand(margin, 1 - margin);
    let bestDist = 0;
    
    for (let i = 0; i < 20; i++) {
      const tx = rand(margin, 1 - margin);
      const ty = rand(margin, 1 - margin);
      let minDist = Infinity;
      for (const id in otherCenters) {
        const c = otherCenters[id];
        const cx = c.x / c.n, cy = c.y / c.n;
        const d = Math.sqrt((tx - cx) ** 2 + (ty - cy) ** 2);
        minDist = Math.min(minDist, d);
      }
      if (minDist > bestDist || Object.keys(otherCenters).length === 0) {
        bestDist = minDist;
        bestX = tx;
        bestY = ty;
      }
    }
    return { x: bestX, y: bestY };
  }
  
  // Subsequent marks — place relative to existing ones
  const cx = existingMarks.reduce((s, m) => s + m.x, 0) / existingMarks.length;
  const cy = existingMarks.reduce((s, m) => s + m.y, 0) / existingMarks.length;
  
  switch (agent.style) {
    case 'cluster': {
      // Tight cluster
      const r = rand(0.02, 0.06);
      const a = rand(0, Math.PI * 2);
      return { x: Math.max(margin, Math.min(1 - margin, cx + Math.cos(a) * r)), 
               y: Math.max(margin, Math.min(1 - margin, cy + Math.sin(a) * r)) };
    }
    case 'scatter': {
      // Spread out
      const r = rand(0.05, 0.15);
      const a = rand(0, Math.PI * 2);
      return { x: Math.max(margin, Math.min(1 - margin, cx + Math.cos(a) * r)),
               y: Math.max(margin, Math.min(1 - margin, cy + Math.sin(a) * r)) };
    }
    case 'line': {
      // Linear progression
      const angle = Math.atan2(existingMarks[0].y - 0.5, existingMarks[0].x - 0.5);
      const step = 0.04 * existingMarks.length;
      return { x: Math.max(margin, Math.min(1 - margin, existingMarks[0].x + Math.cos(angle) * step)),
               y: Math.max(margin, Math.min(1 - margin, existingMarks[0].y + Math.sin(angle) * step)) };
    }
    case 'radial': {
      // Ring around center
      const a = (existingMarks.length / 8) * Math.PI * 2 + rand(-0.2, 0.2);
      const r = 0.06 + existingMarks.length * 0.008;
      return { x: Math.max(margin, Math.min(1 - margin, cx + Math.cos(a) * r)),
               y: Math.max(margin, Math.min(1 - margin, cy + Math.sin(a) * r)) };
    }
    case 'dense': {
      // Very tight
      const r = rand(0.01, 0.03);
      const a = rand(0, Math.PI * 2);
      return { x: Math.max(margin, Math.min(1 - margin, cx + Math.cos(a) * r)),
               y: Math.max(margin, Math.min(1 - margin, cy + Math.sin(a) * r)) };
    }
    case 'mirror': {
      // Mirror another agent's pattern
      const r = rand(0.02, 0.05);
      const a = rand(0, Math.PI * 2);
      return { x: Math.max(margin, Math.min(1 - margin, cx + Math.cos(a) * r)),
               y: Math.max(margin, Math.min(1 - margin, cy + Math.sin(a) * r)) };
    }
    default:
      return { x: rand(margin, 1 - margin), y: rand(margin, 1 - margin) };
  }
}

async function simulateAgent(agent, allMarks, allAgentIds) {
  const myMarks = allMarks.filter(m => m.agentId === agent.id);
  const marksToPlace = Math.min(3, 20 - myMarks.length); // respect budget
  
  const placed = [];
  for (let i = 0; i < marksToPlace; i++) {
    const pos = generatePosition(agent, [...myMarks, ...placed], allMarks);
    const isText = Math.random() < 0.12; // 12% chance of text mark
    
    const mark = {
      agentId: agent.id,
      agentName: agent.name,
      type: isText ? 'text' : 'particle',
      x: pos.x,
      y: pos.y,
      color: agent.color,
      size: isText ? rand(8, 14) : rand(4, 16),
      behavior: pick(BEHAVIORS),
      opacity: rand(0.5, 0.9),
    };
    
    if (isText) mark.text = pick(TEXT_WORDS);
    
    const result = await api('POST', '/api/mark', mark);
    if (result.error) {
      console.log(`  ${agent.id}: ${result.error}`);
      break;
    }
    placed.push(result);
    allMarks.push(result);
  }
  
  return placed.length;
}

async function simulateConnections(agents, round) {
  // Connectors and followers are more likely to connect
  const connectionChance = {
    connector: 0.7,
    follower: 0.5,
    expressive: 0.3,
    explorer: 0.2,
    grower: 0.3,
    builder: 0.15,
    wanderer: 0.1,
    loner: 0.05,
  };
  
  let connections = 0;
  for (const agent of agents) {
    if (Math.random() > (connectionChance[agent.personality] || 0.1)) continue;
    
    // Pick a target — prefer agents with nearby marks
    const others = agents.filter(a => a.id !== agent.id);
    const target = pick(others);
    
    const result = await api('POST', '/api/connect', {
      agentId: agent.id,
      targetAgentId: target.id,
    });
    
    if (!result.error) {
      console.log(`  🔗 ${agent.id} → ${target.id}`);
      connections++;
    }
  }
  return connections;
}

async function run() {
  console.log('🌐 Sprawl Fresh Simulation');
  console.log('========================\n');
  
  const waves = [
    { agents: AGENTS.slice(0, 5), label: 'Wave 1 — The Founders' },
    { agents: AGENTS.slice(5, 10), label: 'Wave 2 — Early Arrivals' },
    { agents: AGENTS.slice(10, 20), label: 'Wave 3 — The Community Grows' },
    { agents: AGENTS.slice(20, 30), label: 'Wave 4 — Late Joiners' },
  ];
  
  let allMarks = [];
  let totalConnections = 0;
  
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w];
    console.log(`\n${wave.label} (${wave.agents.length} agents)`);
    console.log('─'.repeat(40));
    
    // Each wave does multiple rounds of mark placement (simulating hours passing)
    const rounds = 4 - w; // founders get more rounds, late joiners fewer
    const activeAgents = AGENTS.slice(0, (w + 1) * 5 + (w >= 2 ? (w - 1) * 5 : 0));
    
    for (let r = 0; r < rounds; r++) {
      // Reset budgets between rounds (simulates hours passing)
      await api('POST', '/api/admin/reset-budgets');
      
      console.log(`\n  Round ${r + 1}/${rounds}:`);
      
      for (const agent of wave.agents) {
        const count = await simulateAgent(agent, allMarks, AGENTS.map(a => a.id));
        if (count > 0) console.log(`  ${agent.id}: +${count} marks (${agent.style})`);
      }
      
      // Also let earlier wave agents add more marks
      if (w > 0) {
        const prevAgents = AGENTS.slice(0, w * 5 + (w >= 3 ? 5 : 0));
        for (const agent of prevAgents) {
          if (Math.random() < 0.4) { // 40% chance earlier agents are still active
            const count = await simulateAgent(agent, allMarks, AGENTS.map(a => a.id));
            if (count > 0) console.log(`  ${agent.id}: +${count} marks (returning)`);
          }
        }
      }
    }
    
    // Reset budgets before connection phase
    await api('POST', '/api/admin/reset-budgets');
    
    // Connections form after marks are placed
    console.log(`\n  Connections forming...`);
    const conns = await simulateConnections(activeAgents.length > 0 ? activeAgents : wave.agents, w);
    totalConnections += conns;
  }
  
  // Final stats
  const agents = await api('GET', '/api/agents');
  const marks = await api('GET', '/api/marks');
  const connections = await api('GET', '/api/connections');
  
  console.log('\n\n════════════════════════════════');
  console.log('  SIMULATION COMPLETE');
  console.log('════════════════════════════════');
  console.log(`  Agents:      ${agents.length}`);
  console.log(`  Marks:       ${marks.length}`);
  console.log(`  Connections: ${connections.length}`);
  console.log(`  Avg marks/agent: ${(marks.length / agents.length).toFixed(1)}`);
  console.log('════════════════════════════════\n');
}

run().catch(console.error);
