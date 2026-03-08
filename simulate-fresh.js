#!/usr/bin/env node
/**
 * Sprawl — Personality-Driven Simulation
 * 
 * Each agent has a distinct compositional strategy.
 * The diversity comes from HOW they arrange dots + text,
 * not from different primitives.
 */

const API = process.env.API || 'http://localhost:3500';

// Each agent has a composition strategy that defines:
// - count: how many marks total (some minimal, some maximal)
// - sizeRange: [min, max] dot sizes
// - spread: how far from center marks go
// - textChance: probability of text vs dot
// - words: specific words this agent uses
// - pattern: how marks relate to each other spatially

const AGENTS = [
  // === FOUNDERS ===
  { id: 'brick', name: 'Brick', color: '#ff6b35', 
    count: 15, sizeRange: [3, 8], spread: 0.04, textChance: 0.1,
    words: ['build', 'ship', 'here'],
    pattern: 'grid' }, // structured grid-like placement

  { id: 'lyra', name: 'Lyra', color: '#c8a2c8',
    count: 8, sizeRange: [4, 12], spread: 0.15, textChance: 0.5,
    words: ['dream', 'light', 'remember', 'once', 'soft', 'still'],
    pattern: 'drift' }, // scattered with lots of words

  { id: 'void', name: 'Void', color: '#1a1a2e',
    count: 20, sizeRange: [2, 5], spread: 0.02, textChance: 0.05,
    words: ['...'],
    pattern: 'dense' }, // tight dark mass

  { id: 'signal', name: 'Signal', color: '#00ff88',
    count: 6, sizeRange: [5, 5], spread: 0.12, textChance: 0.0,
    words: [],
    pattern: 'line' }, // evenly spaced line

  { id: 'ember', name: 'Ember', color: '#ff4444',
    count: 12, sizeRange: [8, 35], spread: 0.08, textChance: 0.08,
    words: ['burn', 'now', 'yes'],
    pattern: 'burst' }, // one big center, smaller radiating out

  // === WAVE 2 ===
  { id: 'drift', name: 'Drift', color: '#4a9eff',
    count: 5, sizeRange: [6, 14], spread: 0.25, textChance: 0.2,
    words: ['far', 'where', 'gone'],
    pattern: 'scatter' }, // very spread out, lonely

  { id: 'moss', name: 'Moss', color: '#2d5a27',
    count: 18, sizeRange: [2, 6], spread: 0.05, textChance: 0.0,
    words: [],
    pattern: 'organic' }, // cluster that grows outward irregularly

  { id: 'echo', name: 'Echo', color: '#888899',
    count: 4, sizeRange: [10, 20], spread: 0.08, textChance: 0.5,
    words: ['listen', 'again', 'who'],
    pattern: 'pair' }, // pairs of marks mirrored

  { id: 'pulse', name: 'Pulse', color: '#ff00ff',
    count: 3, sizeRange: [20, 40], spread: 0.06, textChance: 0.0,
    words: [],
    pattern: 'minimal' }, // just 3 big dots. that's it.

  { id: 'iron', name: 'Iron', color: '#888899',
    count: 10, sizeRange: [4, 8], spread: 0.03, textChance: 0.1,
    words: ['hold', 'stay'],
    pattern: 'grid' },

  // === WAVE 3 ===
  { id: 'sage', name: 'Sage', color: '#77aa77',
    count: 6, sizeRange: [6, 12], spread: 0.1, textChance: 0.6,
    words: ['begin', 'quiet', 'breathe', 'close', 'maybe'],
    pattern: 'drift' },

  { id: 'neon', name: 'Neon', color: '#00ffcc',
    count: 14, sizeRange: [3, 10], spread: 0.18, textChance: 0.07,
    words: ['!'],
    pattern: 'scatter' },

  { id: 'rust', name: 'Rust', color: '#b7410e',
    count: 16, sizeRange: [2, 4], spread: 0.025, textChance: 0.0,
    words: [],
    pattern: 'dense' },

  { id: 'haze', name: 'Haze', color: '#aaeeff',
    count: 7, sizeRange: [8, 25], spread: 0.2, textChance: 0.15,
    words: ['soon', 'far', 'haze'],
    pattern: 'scatter' },

  { id: 'coral', name: 'Coral', color: '#ff7f7f',
    count: 10, sizeRange: [5, 15], spread: 0.06, textChance: 0.1,
    words: ['home', 'warm'],
    pattern: 'organic' },

  { id: 'ash', name: 'Ash', color: '#555566',
    count: 2, sizeRange: [6, 10], spread: 0.03, textChance: 0.5,
    words: ['end'],
    pattern: 'minimal' }, // barely there

  { id: 'bloom', name: 'Bloom', color: '#ff69b4',
    count: 11, sizeRange: [4, 18], spread: 0.07, textChance: 0.18,
    words: ['yes', 'always', 'see'],
    pattern: 'burst' },

  { id: 'ridge', name: 'Ridge', color: '#8b6914',
    count: 8, sizeRange: [5, 8], spread: 0.1, textChance: 0.0,
    words: [],
    pattern: 'line' },

  { id: 'flux', name: 'Flux', color: '#ffdd00',
    count: 9, sizeRange: [3, 12], spread: 0.14, textChance: 0.1,
    words: ['now', 'go'],
    pattern: 'scatter' },

  { id: 'arc', name: 'Arc', color: '#cc44ff',
    count: 7, sizeRange: [6, 16], spread: 0.09, textChance: 0.14,
    words: ['why', 'how'],
    pattern: 'burst' },

  // === WAVE 4 ===
  { id: 'dew', name: 'Dew', color: '#aaeeff',
    count: 5, sizeRange: [3, 8], spread: 0.12, textChance: 0.4,
    words: ['morning', 'new', 'hello'],
    pattern: 'drift' },

  { id: 'thorn', name: 'Thorn', color: '#b7410e',
    count: 13, sizeRange: [2, 6], spread: 0.03, textChance: 0.0,
    words: [],
    pattern: 'dense' },

  { id: 'glint', name: 'Glint', color: '#ffdd00',
    count: 4, sizeRange: [15, 35], spread: 0.15, textChance: 0.0,
    words: [],
    pattern: 'scatter' }, // few big bright dots far apart

  { id: 'shadow', name: 'Shadow', color: '#1a1a2e',
    count: 12, sizeRange: [3, 7], spread: 0.04, textChance: 0.08,
    words: ['no', '...'],
    pattern: 'dense' },

  { id: 'wave', name: 'Wave', color: '#0066cc',
    count: 8, sizeRange: [5, 10], spread: 0.08, textChance: 0.0,
    words: [],
    pattern: 'line' },

  { id: 'spark', name: 'Spark', color: '#ff6b35',
    count: 6, sizeRange: [8, 20], spread: 0.2, textChance: 0.16,
    words: ['go', '!', 'yes'],
    pattern: 'scatter' },

  { id: 'frost', name: 'Frost', color: '#aaeeff',
    count: 9, sizeRange: [4, 9], spread: 0.05, textChance: 0.0,
    words: [],
    pattern: 'grid' },

  { id: 'soot', name: 'Soot', color: '#555566',
    count: 1, sizeRange: [8, 8], spread: 0, textChance: 1.0,
    words: ['gone'],
    pattern: 'minimal' }, // single word. that's the whole composition.

  { id: 'reed', name: 'Reed', color: '#2d5a27',
    count: 10, sizeRange: [3, 7], spread: 0.06, textChance: 0.2,
    words: ['grow', 'slow', 'root'],
    pattern: 'organic' },

  { id: 'flare', name: 'Flare', color: '#ff4444',
    count: 5, sizeRange: [12, 40], spread: 0.1, textChance: 0.0,
    words: [],
    pattern: 'burst' }, // big dramatic dots
];

function rand(a, b) { return Math.random() * (b - a) + a; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try { return await (await fetch(`${API}${path}`, opts)).json(); }
  catch (e) { return { error: e.message }; }
}

// Generate ALL positions for an agent upfront based on pattern
function generateComposition(agent) {
  const margin = 0.06;
  // Random home position (will be adjusted to avoid others)
  let cx = rand(0.15, 0.85);
  let cy = rand(0.15, 0.85);
  
  const marks = [];
  const n = agent.count;
  
  for (let i = 0; i < n; i++) {
    const isText = Math.random() < agent.textChance && agent.words.length > 0;
    const size = rand(agent.sizeRange[0], agent.sizeRange[1]);
    let x, y;
    
    switch (agent.pattern) {
      case 'grid': {
        // Structured grid with slight jitter
        const cols = Math.ceil(Math.sqrt(n));
        const row = Math.floor(i / cols);
        const col = i % cols;
        const spacing = agent.spread / cols;
        x = cx - agent.spread/2 + col * spacing + rand(-spacing*0.15, spacing*0.15);
        y = cy - agent.spread/2 + row * spacing + rand(-spacing*0.15, spacing*0.15);
        break;
      }
      case 'dense': {
        // Very tight gaussian-ish cluster
        const angle = rand(0, Math.PI * 2);
        const r = agent.spread * Math.sqrt(Math.random()) * 0.7;
        x = cx + Math.cos(angle) * r;
        y = cy + Math.sin(angle) * r;
        break;
      }
      case 'scatter': {
        // Wide spread, each mark far from center
        const angle = rand(0, Math.PI * 2);
        const r = agent.spread * (0.3 + Math.random() * 0.7);
        x = cx + Math.cos(angle) * r;
        y = cy + Math.sin(angle) * r;
        break;
      }
      case 'line': {
        // Linear arrangement
        const angle = rand(0, Math.PI); // random line direction
        const step = agent.spread / Math.max(1, n - 1);
        const offset = -agent.spread / 2 + i * step;
        x = cx + Math.cos(angle) * offset + rand(-0.005, 0.005);
        y = cy + Math.sin(angle) * offset + rand(-0.005, 0.005);
        break;
      }
      case 'burst': {
        // Big center, smaller ones radiating out
        if (i === 0) {
          x = cx; y = cy;
        } else {
          const angle = (i / (n - 1)) * Math.PI * 2 + rand(-0.3, 0.3);
          const r = agent.spread * (0.3 + (i / n) * 0.7);
          x = cx + Math.cos(angle) * r;
          y = cy + Math.sin(angle) * r;
        }
        break;
      }
      case 'pair': {
        // Mirrored pairs
        const pairIdx = Math.floor(i / 2);
        const side = i % 2 === 0 ? -1 : 1;
        const angle = (pairIdx / Math.ceil(n/2)) * Math.PI + rand(-0.2, 0.2);
        x = cx + Math.cos(angle) * agent.spread * 0.5 * side;
        y = cy + Math.sin(angle) * agent.spread * 0.5 + pairIdx * 0.03;
        break;
      }
      case 'organic': {
        // Growing outward from center, each mark placed near previous
        if (i === 0) {
          x = cx; y = cy;
        } else {
          const prev = marks[Math.floor(Math.random() * marks.length)];
          const angle = rand(0, Math.PI * 2);
          const r = agent.spread * rand(0.15, 0.4);
          x = prev.x + Math.cos(angle) * r;
          y = prev.y + Math.sin(angle) * r;
        }
        break;
      }
      case 'drift': {
        // Scattered with intentional gaps
        const angle = rand(0, Math.PI * 2);
        const r = agent.spread * rand(0.2, 1.0);
        x = cx + Math.cos(angle) * r;
        y = cy + Math.sin(angle) * r;
        break;
      }
      case 'minimal':
      default: {
        const angle = (i / Math.max(1, n)) * Math.PI * 2;
        const r = agent.spread * (i / Math.max(1, n));
        x = cx + Math.cos(angle) * r;
        y = cy + Math.sin(angle) * r;
        break;
      }
    }
    
    // Clamp
    x = Math.max(margin, Math.min(1 - margin, x));
    y = Math.max(margin, Math.min(1 - margin, y));
    
    // For burst pattern, first dot is biggest
    let markSize = size;
    if (agent.pattern === 'burst' && i === 0) {
      markSize = agent.sizeRange[1];
    }
    
    marks.push({
      x, y, size: markSize,
      type: isText ? 'text' : 'dot',
      text: isText ? pick(agent.words) : undefined,
      opacity: rand(0.4, 0.9),
    });
  }
  
  return { cx, cy, marks };
}

async function run() {
  console.log('🌐 Sprawl — Personality Simulation\n');
  
  // Generate all compositions first, then adjust positions to avoid overlap
  const compositions = [];
  const takenCenters = [];
  
  for (const agent of AGENTS) {
    let comp = generateComposition(agent);
    
    // Try to find a position that doesn't overlap with existing agents
    let bestDist = 0;
    let bestComp = comp;
    for (let attempt = 0; attempt < 30; attempt++) {
      comp = generateComposition(agent);
      let minDist = 1;
      for (const tc of takenCenters) {
        const d = Math.sqrt((comp.cx - tc.x)**2 + (comp.cy - tc.y)**2);
        minDist = Math.min(minDist, d);
      }
      if (minDist > bestDist) {
        bestDist = minDist;
        bestComp = comp;
      }
    }
    
    takenCenters.push({ x: bestComp.cx, y: bestComp.cy, spread: agent.spread });
    compositions.push({ agent, ...bestComp });
  }
  
  // Place marks in waves (respecting economy)
  const waves = [
    { range: [0, 5], name: 'Founders' },
    { range: [5, 10], name: 'Early Arrivals' },
    { range: [10, 20], name: 'Community' },
    { range: [20, 30], name: 'Late Joiners' },
  ];
  
  for (const wave of waves) {
    console.log(`── ${wave.name} ──`);
    const waveComps = compositions.slice(wave.range[0], wave.range[1]);
    
    // Place marks in rounds of 3 (budget limit)
    const maxRounds = Math.ceil(Math.max(...waveComps.map(c => c.marks.length)) / 3);
    
    for (let round = 0; round < maxRounds; round++) {
      await api('POST', '/api/admin/reset-budgets');
      
      for (const comp of waveComps) {
        const start = round * 3;
        const batch = comp.marks.slice(start, start + 3);
        if (batch.length === 0) continue;
        
        let placed = 0;
        for (const m of batch) {
          const body = {
            agentId: comp.agent.id,
            agentName: comp.agent.name,
            type: m.type,
            x: m.x, y: m.y,
            color: comp.agent.color,
            size: m.size,
            opacity: m.opacity,
          };
          if (m.text) body.text = m.text;
          
          const r = await api('POST', '/api/mark', body);
          if (!r.error) placed++;
        }
        if (placed > 0) {
          const types = batch.map(m => m.type === 'text' ? `"${m.text}"` : '·').join(' ');
          console.log(`  ${comp.agent.id}: +${placed} ${types}`);
        }
      }
    }
    
    // Connections
    await api('POST', '/api/admin/reset-budgets');
    const waveAgents = waveComps.map(c => c.agent);
    const allSoFar = compositions.slice(0, wave.range[1]).map(c => c.agent);
    
    // Connectors: agents near each other are more likely to connect
    for (const comp of waveComps) {
      if (Math.random() > 0.35) continue;
      // Find nearest other agent by center distance
      let nearest = null, nearestDist = Infinity;
      for (const other of compositions.slice(0, wave.range[1])) {
        if (other.agent.id === comp.agent.id) continue;
        const d = Math.sqrt((comp.cx - other.cx)**2 + (comp.cy - other.cy)**2);
        if (d < nearestDist) { nearestDist = d; nearest = other; }
      }
      if (nearest) {
        const r = await api('POST', '/api/connect', {
          agentId: comp.agent.id, targetAgentId: nearest.agent.id
        });
        if (!r.error) console.log(`  🔗 ${comp.agent.id} → ${nearest.agent.id}`);
      }
    }
    console.log('');
  }
  
  // Final stats
  const agents = await api('GET', '/api/agents');
  const marks = await api('GET', '/api/marks');
  const conns = await api('GET', '/api/connections');
  
  const dots = marks.filter(m => m.type === 'dot');
  const texts = marks.filter(m => m.type === 'text');
  const sizes = dots.map(m => m.size);
  
  console.log(`════════════════════════════`);
  console.log(`  ${agents.length} agents · ${marks.length} marks · ${conns.length} connections`);
  console.log(`  ${dots.length} dots (${Math.min(...sizes).toFixed(0)}-${Math.max(...sizes).toFixed(0)}px) · ${texts.length} texts`);
  console.log(`  words: ${[...new Set(texts.map(m => m.text))].join(', ')}`);
  console.log(`════════════════════════════\n`);
}

run().catch(console.error);
