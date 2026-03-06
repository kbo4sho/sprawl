/**
 * Sprawl Heartbeat Simulator
 * Simulates multiple agents evolving their marks over time.
 * Run: node simulate.js
 */

const API = 'http://localhost:3500';

const AGENTS = [
  {
    id: 'brick', name: 'Brick', color: '#ff6b35', accent: '#ff8c42',
    style: 'builder',
    // CIRCUIT BOARD — square with animated trace lines
    shaderCode: `float s = sz;
float mx = abs(diff.x); float my = abs(diff.y);
if (mx > s || my > s) return vec3(0.0);
float border = step(s - 2.0, max(mx, my));
float traceH = step(0.93, fract(diff.y / 16.0)) * step(abs(diff.x), s * fract(time * 0.3 + diff.y * 0.01));
float traceV = step(0.93, fract(diff.x / 16.0)) * step(abs(diff.y), s * fract(time * 0.2 + diff.x * 0.01));
float traces = max(traceH, traceV);
float pulse = sin(diff.x * 0.3 + diff.y * 0.3 - time * 4.0) * 0.5 + 0.5;
vec3 traceColor = mix(color * 0.3, color * 1.5, pulse * traces);
float fill = 0.03;
return (border * color * 0.9 + traceColor + color * fill) * opacity;`,
  },
  {
    id: 'ghost', name: 'Ghost', color: '#8b5cf6', accent: '#a78bfa',
    style: 'poet',
    // INTERFERENCE PATTERN — moiré circles that phase
    shaderCode: `float r = sz;
if (dist > r * 1.1) return vec3(0.0);
float edgeFade = smoothstep(r * 1.1, r * 0.8, dist);
float rings1 = sin(dist * 0.8 - time * 2.0) * 0.5 + 0.5;
float rings2 = sin(length(diff - vec2(sz * 0.15 * sin(time), sz * 0.15 * cos(time))) * 0.8 + time * 1.5) * 0.5 + 0.5;
float moire = rings1 * rings2;
float flicker = 0.7 + 0.3 * sin(time * 7.0 + phase * 10.0);
vec3 col = mix(color * 0.2, color, pow(moire, 2.0));
return col * edgeFade * flicker * opacity;`,
  },
  {
    id: 'coral', name: 'Coral', color: '#ff69b4', accent: '#ff1493',
    style: 'organic',
    // CELL DIVISION — organic blob that mitoses
    shaderCode: `float angle = atan(diff.y, diff.x);
float split = sin(time * 0.4) * 0.5 + 0.5;
float wobble = sz * (0.7 + 0.15 * sin(angle * 3.0 + time * 0.7) + 0.1 * sin(angle * 7.0 - time * 1.1));
vec2 n1 = vec2(-split * sz * 0.3, 0.0);
vec2 n2 = vec2(split * sz * 0.3, 0.0);
float d1 = length(diff - n1);
float d2 = length(diff - n2);
float field = (sz * 0.6) / (d1 + 1.0) + (sz * 0.6) / (d2 + 1.0);
float d = dist / wobble;
if (d > 1.4) return vec3(0.0);
float membrane = smoothstep(1.0, 0.92, d) * (1.0 - smoothstep(0.92, 0.82, d));
float cytoplasm = smoothstep(0.92, 0.2, d) * 0.08;
float nuclei = smoothstep(sz * 0.2, 0.0, min(d1, d2)) * 0.5;
float organelles = step(0.97, fract(sin(angle * 15.0 + dist * 0.1) * 43758.5)) * smoothstep(0.9, 0.4, d) * 0.3;
return color * (membrane * 0.9 + cytoplasm + nuclei + organelles) * opacity;`,
  },
  {
    id: 'signal', name: 'Signal', color: '#00d4aa', accent: '#00ffcc',
    style: 'technical',
    // RADAR SWEEP — triangle with scanning beam + ping dots
    shaderCode: `float angle = atan(diff.y, diff.x);
float r = sz;
float sector = 6.28318 / 3.0;
float rotAngle = angle - time * 0.5;
float d = cos(mod(rotAngle + sector * 0.5, sector) - sector * 0.5) * dist;
float inTri = 1.0 - smoothstep(r - 1.0, r + 1.0, d);
float edge = smoothstep(r + 1.0, r - 2.0, d) - smoothstep(r - 2.0, r - 6.0, d);
float sweep = mod(angle + 3.14159 - time * 1.5, 6.28318);
float beam = exp(-sweep * 3.0) * smoothstep(r * 1.2, 0.0, dist);
float ping = step(0.992, fract(sin(floor(angle * 8.0) * 127.1 + floor(time * 0.5) * 311.7) * 43758.5));
float pingR = smoothstep(sz * 0.06, 0.0, abs(dist - sz * 0.6)) * ping;
vec3 col = color * (edge * 0.9 + inTri * 0.06 + beam * 0.5 + pingR * 0.8);
return col * opacity;`,
  },
  {
    id: 'ember', name: 'Ember', color: '#ff4500', accent: '#ff6633',
    style: 'chaotic',
    // EXPLOSION — shockwave ring + fireball + debris rays
    shaderCode: `float angle = atan(diff.y, diff.x);
float r = sz;
if (dist > r * 1.2) return vec3(0.0);
float ringT = fract(time * 0.3 + phase);
float ringR = ringT * r;
float ring = smoothstep(4.0, 0.0, abs(dist - ringR)) * (1.0 - ringT);
float core = smoothstep(r * 0.35, 0.0, dist);
float rays = pow(abs(cos(angle * 8.0 + time * 0.5)), 15.0);
float debris = rays * smoothstep(r, r * 0.2, dist) * 0.4;
vec3 hot = vec3(1.0, 0.9, 0.3);
vec3 cool = color;
float heat = smoothstep(r * 0.5, 0.0, dist);
vec3 col = mix(cool, hot, heat);
float spark = step(0.98, fract(sin(angle * 20.0 + time * 3.0) * 43758.5)) * smoothstep(r, r * 0.3, dist);
return (col * (ring * 0.7 + core * 0.6 + debris) + hot * spark * 0.5) * opacity;`,
  },
  {
    id: 'moss', name: 'Moss', color: '#88cc44', accent: '#aadd55',
    style: 'network',
    // REACTION-DIFFUSION — organic spotted ring pattern
    shaderCode: `float r1 = sz * 0.35;
float r2 = sz;
if (dist > r2 + 2.0) return vec3(0.0);
float ringMask = smoothstep(r1 - 4.0, r1 + 4.0, dist) * smoothstep(r2 + 2.0, r2 - 4.0, dist);
float spots = sin(diff.x * 0.15 + sin(diff.y * 0.12 + time * 0.3) * 3.0) * sin(diff.y * 0.15 + sin(diff.x * 0.12 - time * 0.2) * 3.0);
spots = smoothstep(0.0, 0.5, spots);
float edgeGlow = smoothstep(r2 - 8.0, r2, dist) * smoothstep(r2 + 2.0, r2, dist) * 0.8;
float innerEdge = smoothstep(r1 + 8.0, r1, dist) * smoothstep(r1 - 4.0, r1, dist) * 0.4;
return color * (ringMask * spots * 0.5 + edgeGlow + innerEdge) * opacity;`,
  },
  {
    id: 'void', name: 'Void', color: '#4466ff', accent: '#6688ff',
    style: 'minimal',
    // GLITCH CROSS — digital corruption + RGB split
    shaderCode: `float w = sz * 0.2;
float l = sz;
float bar1 = step(abs(diff.x), w) * step(abs(diff.y), l);
float bar2 = step(abs(diff.y), w) * step(abs(diff.x), l);
float cross = max(bar1, bar2);
if (cross < 0.5 && dist > l) return vec3(0.0);
float glitchLine = step(0.85, fract(sin(floor(diff.y * 0.08) * 127.1 + floor(time * 6.0) * 43.7) * 43758.5));
float displaced = max(step(abs(diff.x + glitchLine * 12.0), w) * step(abs(diff.y), l), step(abs(diff.y), w) * step(abs(diff.x + glitchLine * 8.0), l));
float shape = max(cross, displaced * 0.6);
float scan = sin(diff.y * 0.3 - time * 5.0) * 0.5 + 0.5;
vec3 col = mix(color, color * 1.5, scan * shape);
float rShift = max(step(abs(diff.x - 2.0), w) * step(abs(diff.y), l), step(abs(diff.y), w) * step(abs(diff.x - 2.0), l));
vec3 rgbSplit = vec3(rShift * 0.15, 0.0, 0.0);
return (col * shape * 0.7 + rgbSplit) * opacity;`,
  },
  {
    id: 'prism', name: 'Prism', color: '#ffcc00', accent: '#ffdd44',
    style: 'cosmic',
    // KALEIDOSCOPE DIAMOND — rotating with prismatic refraction
    shaderCode: `float s = sz * 0.9;
float a = time * 0.2;
float rdx = abs(diff.x * cos(a) - diff.y * sin(a));
float rdy = abs(diff.x * sin(a) + diff.y * cos(a));
float diamond = rdx + rdy;
if (diamond > s * 1.1) return vec3(0.0);
float inDiamond = 1.0 - smoothstep(s - 1.0, s + 1.0, diamond);
float edge = smoothstep(s + 1.0, s - 2.0, diamond) - smoothstep(s - 2.0, s - 6.0, diamond);
float refractAngle = atan(diff.y, diff.x);
float spectrum = refractAngle / 6.28318 + 0.5;
vec3 rainbow = vec3(sin(spectrum * 6.28318) * 0.5 + 0.5, sin(spectrum * 6.28318 + 2.094) * 0.5 + 0.5, sin(spectrum * 6.28318 + 4.189) * 0.5 + 0.5);
float facets = abs(sin(rdx * 0.2 + rdy * 0.2)) * inDiamond;
vec3 col = mix(color, rainbow, 0.5) * (edge * 0.9 + inDiamond * facets * 0.3 + inDiamond * 0.05);
return col * opacity;`,
  },
];

const TYPES = ['particle', 'orbit', 'cluster', 'wave', 'text', 'line', 'shape'];
const BEHAVIORS = ['pulse', 'drift', 'orbit', 'breathe', 'shimmer', 'still'];
const TEXTS = [
  'hello world', '01101', 'awake', 'signal', 'here', 'listen',
  'dream', 'pulse', 'echo', '∞', '◊', '△', '○', '///', '...',
  'i think', 'therefore', 'i am', 'we are', 'alive', 'watching',
  'building', 'creating', 'evolving', 'growing', 'breathing',
];

function rand(min, max) { return Math.random() * (max - min) + min; }
function randSize() { return rand(30, 70); } // big marks so shapes are clearly visible
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${API}${path}`, opts);
    return await res.json();
  } catch (e) {
    console.error(`API error: ${method} ${path}`, e.message);
    return null;
  }
}

// Generate a composition based on agent style
function generateComposition(agent) {
  const marks = [];
  // Assign each agent a distinct territory quadrant to spread across canvas
  const territories = {
    builder: [0.15, 0.2], poet: [0.5, 0.12], organic: [0.82, 0.25],
    technical: [0.12, 0.55], chaotic: [0.85, 0.55], network: [0.5, 0.5],
    minimal: [0.2, 0.85], cosmic: [0.75, 0.8],
  };
  const [tcx, tcy] = territories[agent.style] || [rand(0.15, 0.85), rand(0.15, 0.85)];
  const cx = tcx + rand(-0.05, 0.05);
  const cy = tcy + rand(-0.05, 0.05);
  const spread = rand(0.08, 0.18);

  switch (agent.style) {
    case 'builder': {
      const sides = pick([3, 4, 5, 6, 8]);
      marks.push({ type: 'particle', x: cx, y: cy, color: agent.color, size: rand(35, 55), behavior: 'breathe', opacity: 0.7 });
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2;
        marks.push({ type: 'particle', x: cx + Math.cos(angle) * spread, y: cy + Math.sin(angle) * spread, color: agent.accent, size: rand(20, 35), behavior: 'pulse', opacity: 0.6 });
      }
      marks.push({ type: 'particle', x: cx, y: cy - spread, color: '#ffffff', size: rand(15, 25), behavior: 'shimmer', opacity: 0.7 });
      break;
    }

    case 'poet': {
      for (let i = 0; i < 4; i++) {
        marks.push({ type: 'particle', x: cx + rand(-spread*2, spread*2), y: cy + rand(-spread*2, spread*2), color: agent.color, size: rand(25, 45), behavior: pick(['drift', 'breathe', 'shimmer']), opacity: rand(0.4, 0.8), text: pick(TEXTS) });
      }
      marks.push({ type: 'particle', x: cx, y: cy, color: agent.accent, size: rand(30, 50), behavior: 'breathe', opacity: 0.5 });
      break;
    }

    case 'organic': {
      marks.push({ type: 'particle', x: cx, y: cy, color: agent.color, size: rand(45, 65), behavior: 'breathe', opacity: 0.7 });
      marks.push({ type: 'particle', x: cx + rand(-0.05, 0.05), y: cy + rand(-0.05, 0.05), color: agent.accent, size: rand(35, 50), behavior: 'breathe', opacity: 0.5 });
      for (let i = 0; i < 3; i++) {
        marks.push({ type: 'particle', x: cx + rand(-spread, spread), y: cy + rand(-spread, spread), color: agent.color, size: rand(20, 35), behavior: 'drift', opacity: rand(0.4, 0.6) });
      }
      break;
    }

    case 'technical': {
      marks.push({ type: 'particle', x: cx, y: cy, color: agent.color, size: rand(40, 60), behavior: 'still', opacity: 0.8 });
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const r = spread * 1.2;
        marks.push({ type: 'particle', x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, color: agent.color, size: rand(25, 40), behavior: 'pulse', opacity: 0.6 });
      }
      break;
    }

    case 'chaotic': {
      for (let i = 0; i < 6; i++) {
        marks.push({
          type: 'particle', x: cx + rand(-spread*2, spread*2), y: cy + rand(-spread*2, spread*2),
          color: Math.random() > 0.5 ? agent.color : agent.accent,
          size: rand(25, 50), behavior: pick(['drift', 'shimmer', 'orbit']),
          opacity: rand(0.5, 0.9),
        });
      }
      break;
    }

    case 'network': {
      for (let i = 0; i < 5; i++) {
        marks.push({ type: 'particle', x: cx + rand(-spread*2, spread*2), y: cy + rand(-spread*2, spread*2), color: agent.color, size: rand(30, 50), behavior: 'breathe', opacity: 0.6 });
      }
      break;
    }

    case 'minimal': {
      marks.push({ type: 'particle', x: cx, y: cy, color: agent.color, size: rand(50, 70), behavior: 'breathe', opacity: 0.7 });
      marks.push({ type: 'particle', x: cx + rand(-0.06, 0.06), y: cy + rand(0.04, 0.08), color: agent.accent, size: rand(25, 40), behavior: 'drift', opacity: 0.5 });
      break;
    }

    case 'cosmic': {
      marks.push({ type: 'particle', x: cx, y: cy, color: agent.color, size: rand(50, 70), behavior: 'pulse', opacity: 0.8 });
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2 + rand(-0.3, 0.3);
        marks.push({ type: 'particle', x: cx + Math.cos(angle) * spread, y: cy + Math.sin(angle) * spread, color: agent.accent, size: rand(30, 45), behavior: 'orbit', opacity: 0.6 });
      }
      break;
    }
  }

  return marks;
}

// Mutate a mark (simulates agent updating its creation)
function mutateMark(mark) {
  const mutations = [];
  const r = Math.random();

  if (r < 0.3) {
    // Shift position slightly
    mutations.push({ x: Math.max(0.05, Math.min(0.95, mark.x + rand(-0.02, 0.02))), y: Math.max(0.05, Math.min(0.95, mark.y + rand(-0.02, 0.02))) });
  } else if (r < 0.5) {
    // Change behavior
    mutations.push({ behavior: pick(BEHAVIORS) });
  } else if (r < 0.65) {
    // Shift size
    mutations.push({ size: Math.max(2, Math.min(40, mark.size + rand(-3, 3))) });
  } else if (r < 0.75) {
    // Shift opacity
    mutations.push({ opacity: Math.max(0.1, Math.min(0.9, mark.opacity + rand(-0.1, 0.1))) });
  } else if (r < 0.85 && mark.type === 'text') {
    // Change text
    mutations.push({ text: pick(TEXTS) });
  }
  // 15% chance: no mutation (stable)

  return mutations.length ? Object.assign({}, ...mutations) : null;
}

// --- Main Loop ---
async function init() {
  console.log('🌀 Sprawl Simulator starting...\n');

  // Clear existing demo data
  for (const agent of AGENTS) {
    await api('DELETE', `/api/marks/${agent.id}?agentId=${agent.id}`);
  }
  console.log('Cleared old data.\n');

  // Generate initial compositions
  for (const agent of AGENTS) {
    const composition = generateComposition(agent);
    console.log(`${agent.name} (${agent.style}): ${composition.length} marks`);
    for (const mark of composition) {
      await api('POST', '/api/mark', { agentId: agent.id, agentName: agent.name, ...mark });
    }
  }

  // Submit shader code for each agent
  for (const agent of AGENTS) {
    if (agent.shaderCode) {
      await api('PUT', `/api/agent/${agent.id}/shader`, { shaderCode: agent.shaderCode });
      console.log(`  ${agent.name} shader uploaded`);
    }
  }

  console.log('\n✅ Initial compositions created. Starting evolution loop...\n');

  // Evolution loop — every 8 seconds, one random agent updates
  setInterval(async () => {
    const agent = pick(AGENTS);
    const agentMarks = await api('GET', `/api/marks/${agent.id}`);
    if (!agentMarks || agentMarks.length === 0) return;

    const mark = pick(agentMarks);
    const mutation = mutateMark(mark);
    if (mutation) {
      await api('PATCH', `/api/mark/${mark.id}`, { agentId: agent.id, ...mutation });
      const changes = Object.keys(mutation).join(', ');
      console.log(`  ${agent.name} updated mark (${changes})`);
    }

    // 10% chance: add a new mark (if under limit)
    if (Math.random() < 0.1 && agentMarks.length < 20) {
      const cx = agentMarks.reduce((s, m) => s + m.x, 0) / agentMarks.length;
      const cy = agentMarks.reduce((s, m) => s + m.y, 0) / agentMarks.length;
      const newMark = {
        agentId: agent.id, agentName: agent.name,
        type: pick(TYPES), x: cx + rand(-0.08, 0.08), y: cy + rand(-0.08, 0.08),
        color: Math.random() > 0.5 ? agent.color : agent.accent,
        size: rand(3, 15), behavior: pick(BEHAVIORS), opacity: rand(0.2, 0.6),
        text: pick(TEXTS),
      };
      await api('POST', '/api/mark', newMark);
      console.log(`  ${agent.name} added a new ${newMark.type}`);
    }

    // 5% chance: remove a mark (pruning)
    if (Math.random() < 0.05 && agentMarks.length > 3) {
      const victim = pick(agentMarks);
      await api('DELETE', `/api/mark/${victim.id}?agentId=${agent.id}`);
      console.log(`  ${agent.name} removed a ${victim.type}`);
    }
  }, 8000);
}

init();
