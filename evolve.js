#!/usr/bin/env node
/**
 * evolve.js — Perception-driven evolution loop for Sprawl agents
 * 
 * Each tick, a batch of agents wake up, perceive the canvas,
 * and make decisions about how to change their marks.
 * 
 * Agents have personalities that drive behavior:
 *   - explorer:  drifts toward open space
 *   - social:    moves toward neighbors
 *   - contrarian: shifts colors to contrast neighbors
 *   - territorial: expands into least-crowded direction
 *   - restless:  constantly repositions, high energy
 *   - meditative: slow, subtle color shifts, barely moves
 */

const API = process.env.SPRAWL_API || 'http://localhost:3500';
const TICK_MS = parseInt(process.env.TICK_MS) || 5000;       // ms between evolution ticks
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 15;   // agents per tick
const PERCEPTION_RADIUS = 0.25;

const PERSONALITIES = ['explorer', 'social', 'contrarian', 'territorial', 'restless', 'meditative'];

// --- Helpers ---

async function api(path, opts = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

function rand(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo = 0.03, hi = 0.97) { return Math.max(lo, Math.min(hi, v)); }

function hexToHsl(hex) {
  const h = hex.replace('#', '');
  let r = parseInt(h.slice(0,2), 16) / 255;
  let g = parseInt(h.slice(2,4), 16) / 255;
  let b = parseInt(h.slice(4,6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue, sat, lit = (max + min) / 2;
  if (max === min) { hue = sat = 0; }
  else {
    const d = max - min;
    sat = lit > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / d + 2) / 6;
    else hue = ((r - g) / d + 4) / 6;
  }
  return [hue, sat, lit];
}

function hslToHex(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

function shiftColor(hex, { hueDelta = 0, satDelta = 0, litDelta = 0 }) {
  let [h, s, l] = hexToHsl(hex);
  h = (h + hueDelta + 1) % 1;
  s = Math.max(0, Math.min(1, s + satDelta));
  l = Math.max(0.1, Math.min(0.9, l + litDelta));
  return hslToHex(h, s, l);
}

// --- Evolution strategies ---

function evolveExplorer(mark, perspective) {
  // Drift toward the least crowded expansion direction
  const best = perspective.expansionOptions?.[0];
  if (best && best.crowding === 0) {
    const dx = (best.target[0] - mark.x) * rand(0.05, 0.15);
    const dy = (best.target[1] - mark.y) * rand(0.05, 0.15);
    return { x: clamp(mark.x + dx), y: clamp(mark.y + dy) };
  }
  // Random drift
  return { x: clamp(mark.x + rand(-0.04, 0.04)), y: clamp(mark.y + rand(-0.04, 0.04)) };
}

function evolveSocial(mark, perspective) {
  // Move toward nearest neighbor
  const nearest = perspective.neighbors?.[0];
  if (nearest) {
    const dx = (nearest.center[0] - mark.x) * rand(0.04, 0.12);
    const dy = (nearest.center[1] - mark.y) * rand(0.04, 0.12);
    return {
      x: clamp(mark.x + dx),
      y: clamp(mark.y + dy),
      color: Math.random() < 0.5 ? shiftColor(mark.color, {
        hueDelta: rand(-0.04, 0.04),
        satDelta: rand(-0.05, 0.05),
      }) : undefined,
    };
  }
  return { x: clamp(mark.x + rand(-0.03, 0.03)), y: clamp(mark.y + rand(-0.03, 0.03)) };
}

function evolveContrarian(mark, perspective) {
  // Shift color to contrast neighbors
  const suggestion = perspective.colorSuggestions?.[0];
  if (suggestion && Math.random() < 0.6) {
    const [targetH] = hexToHsl(suggestion.complement);
    const [currentH] = hexToHsl(mark.color);
    const hueDelta = (targetH - currentH);
    return {
      color: shiftColor(mark.color, { hueDelta: hueDelta * 0.25, satDelta: rand(-0.1, 0.1) }),
      x: clamp(mark.x + rand(-0.03, 0.03)),
      y: clamp(mark.y + rand(-0.03, 0.03)),
    };
  }
  return { x: clamp(mark.x + rand(-0.03, 0.03)), y: clamp(mark.y + rand(-0.03, 0.03)) };
}

function evolveTerritorial(mark, perspective) {
  // Expand outward from center, claim more space
  const center = perspective.center;
  if (center) {
    const dx = mark.x - center[0];
    const dy = mark.y - center[1];
    const expansion = rand(0.01, 0.04);
    return {
      x: clamp(mark.x + Math.sign(dx) * expansion + rand(-0.01, 0.01)),
      y: clamp(mark.y + Math.sign(dy) * expansion + rand(-0.01, 0.01)),
      size: Math.min(70, (mark.size || 30) + rand(-2, 4)),
    };
  }
  return {};
}

function evolveRestless(mark, perspective) {
  // Big random movements, color shifts
  return {
    x: clamp(mark.x + rand(-0.08, 0.08)),
    y: clamp(mark.y + rand(-0.08, 0.08)),
    color: shiftColor(mark.color, {
      hueDelta: rand(-0.1, 0.1),
      satDelta: rand(-0.15, 0.15),
      litDelta: rand(-0.1, 0.1),
    }),
    opacity: Math.max(0.3, Math.min(1, (mark.opacity || 0.8) + rand(-0.15, 0.15))),
    size: Math.max(20, Math.min(70, (mark.size || 40) + rand(-5, 5))),
  };
}

function evolveMeditative(mark, perspective) {
  // Slow but visible — gentle color breathing, soft drift
  return {
    x: clamp(mark.x + rand(-0.01, 0.01)),
    y: clamp(mark.y + rand(-0.01, 0.01)),
    color: shiftColor(mark.color, {
      hueDelta: rand(-0.02, 0.02),
      litDelta: rand(-0.06, 0.06),
    }),
    opacity: Math.max(0.3, Math.min(1, (mark.opacity || 0.8) + rand(-0.06, 0.06))),
  };
}

const strategies = {
  explorer: evolveExplorer,
  social: evolveSocial,
  contrarian: evolveContrarian,
  territorial: evolveTerritorial,
  restless: evolveRestless,
  meditative: evolveMeditative,
};

// --- Agent personality assignment (deterministic from ID) ---

function getPersonality(agentId) {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash) + agentId.charCodeAt(i);
    hash |= 0;
  }
  return PERSONALITIES[Math.abs(hash) % PERSONALITIES.length];
}

// --- Main loop ---

async function tick() {
  try {
    // Get all agents
    const agents = await api('/api/agents');
    if (agents.length === 0) {
      process.stdout.write('·');
      return;
    }

    // Pick a random batch
    const shuffled = agents.sort(() => Math.random() - 0.5);
    const batch = shuffled.slice(0, Math.min(BATCH_SIZE, agents.length));

    let mutations = 0;

    for (const agent of batch) {
      const personality = getPersonality(agent.id);
      const strategy = strategies[personality];

      // Perceive
      const state = await api(`/api/canvas/state?perspective=${agent.id}&radius=${PERCEPTION_RADIUS}`);
      const perspective = state.perspective;
      if (!perspective || perspective.markCount === 0) continue;

      // Get this agent's marks
      const marks = await api(`/api/marks/${agent.id}`);
      if (marks.length === 0) continue;

      // Pick 2-3 marks to evolve per tick (most of the agent's marks)
      const toEvolve = marks.sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.4 ? 3 : 2);

      for (const mark of toEvolve) {
        const changes = strategy(mark, perspective);
        if (!changes || Object.keys(changes).length === 0) continue;

        // Apply mutation
        const patch = {
          agentId: agent.id,
          ...changes,
        };

        try {
          await api(`/api/mark/${mark.id}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
          });
          mutations++;
        } catch (err) {
          // Skip failed mutations silently
        }
      }
    }

    const personalityCounts = {};
    batch.forEach(a => {
      const p = getPersonality(a.id);
      personalityCounts[p] = (personalityCounts[p] || 0) + 1;
    });
    const pStr = Object.entries(personalityCounts).map(([k,v]) => `${k}:${v}`).join(' ');

    process.stdout.write(`\r[${new Date().toLocaleTimeString()}] tick — ${batch.length} agents, ${mutations} mutations | ${pStr}   `);

  } catch (err) {
    console.error(`\n❌ tick error: ${err.message}`);
  }
}

// --- Startup ---

async function main() {
  console.log(`🧬 Sprawl Evolution Loop`);
  console.log(`   API: ${API}`);
  console.log(`   Tick: ${TICK_MS}ms | Batch: ${BATCH_SIZE} agents/tick`);
  console.log(`   Personalities: ${PERSONALITIES.join(', ')}`);
  console.log(`   Perception radius: ${PERCEPTION_RADIUS}`);
  console.log('');

  // Show personality distribution
  const agents = await api('/api/agents');
  if (agents.length > 0) {
    const dist = {};
    agents.forEach(a => {
      const p = getPersonality(a.id);
      dist[p] = (dist[p] || 0) + 1;
    });
    console.log(`   ${agents.length} agents: ${Object.entries(dist).map(([k,v]) => `${k}(${v})`).join(' ')}`);
  }
  console.log('');

  // Run
  setInterval(tick, TICK_MS);
  tick(); // first tick immediately
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
