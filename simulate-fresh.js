#!/usr/bin/env node
/**
 * Sprawl — Scene Compositions
 * 
 * Each agent builds a recognizable little scene using 15-20 dots + text.
 * These should read as distinct pictures on the canvas.
 */

const API = process.env.API || 'http://localhost:3500';

function rand(a, b) { return Math.random() * (b - a) + a; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try { return await (await fetch(`${API}${path}`, opts)).json(); }
  catch (e) { return { error: e.message }; }
}

// Each agent defines a scene as an array of relative mark positions
// x,y are offsets from center (-1 to 1 range, scaled by spread)
function scene(marks) { return marks; }
function dot(x, y, size, opacity) { return { type: 'dot', x, y, size, opacity: opacity || rand(0.5, 0.9) }; }
function text(x, y, word, size, opacity) { return { type: 'text', x, y, text: word, size: size || 10, opacity: opacity || 0.8 }; }

const AGENTS = [
  // === HEARTBEAT — a pulsing heart shape ===
  { id: 'heartbeat', name: 'Heartbeat', color: '#ff4444', spread: 0.06,
    scene: scene([
      // Heart shape from dots
      dot(0, -0.3, 30), dot(-0.4, -0.6, 22), dot(0.4, -0.6, 22),
      dot(-0.7, -0.3, 16), dot(0.7, -0.3, 16),
      dot(-0.6, 0, 12), dot(0.6, 0, 12),
      dot(-0.45, 0.3, 10), dot(0.45, 0.3, 10),
      dot(-0.25, 0.55, 8), dot(0.25, 0.55, 8),
      dot(0, 0.75, 6),
      // Inner glow
      dot(0, -0.2, 8, 0.3), dot(-0.2, -0.4, 6, 0.3), dot(0.2, -0.4, 6, 0.3),
      // Pulse dots around
      dot(0, -1.0, 3, 0.4), dot(-0.8, -0.8, 3, 0.4), dot(0.8, -0.8, 3, 0.4),
      text(0, 1.1, 'alive', 8),
    ])},

  // === CHAPEL — a small structure ===
  { id: 'chapel', name: 'Chapel', color: '#8b6914', spread: 0.05,
    scene: scene([
      // Spire
      dot(0, -1.2, 6), dot(0, -1.0, 8), dot(0, -0.8, 10),
      // Roof
      dot(-0.4, -0.5, 12), dot(0, -0.6, 14), dot(0.4, -0.5, 12),
      // Walls
      dot(-0.4, -0.2, 10), dot(0.4, -0.2, 10),
      dot(-0.4, 0.1, 10), dot(0.4, 0.1, 10),
      dot(-0.4, 0.4, 10), dot(0.4, 0.4, 10),
      // Door
      dot(0, 0.3, 8, 0.4), dot(0, 0.5, 6, 0.3),
      // Windows
      dot(-0.2, -0.1, 4, 0.9), dot(0.2, -0.1, 4, 0.9),
      // Ground
      dot(-0.7, 0.6, 5, 0.3), dot(0, 0.6, 5, 0.3), dot(0.7, 0.6, 5, 0.3),
      text(0, 0.9, 'sanctuary', 7),
    ])},

  // === STARFIELD — a night sky ===
  { id: 'starfield', name: 'Starfield', color: '#aaeeff', spread: 0.1,
    scene: scene([
      // Bright stars
      dot(0.3, -0.8, 18), dot(-0.6, -0.4, 14), dot(0.7, 0.2, 12),
      // Medium stars
      dot(-0.2, -0.6, 8), dot(0.5, -0.3, 8), dot(-0.8, 0.1, 8),
      dot(0.1, 0.5, 9), dot(-0.4, 0.7, 7),
      // Dim stars
      dot(0.8, -0.7, 3, 0.4), dot(-0.9, -0.8, 3, 0.4),
      dot(0.2, -0.2, 3, 0.4), dot(-0.3, 0.3, 3, 0.4),
      dot(0.6, 0.6, 3, 0.4), dot(-0.7, 0.5, 2, 0.3),
      dot(0.9, 0.8, 2, 0.3), dot(-0.5, -0.9, 2, 0.3),
      dot(0.4, 0.9, 2, 0.3), dot(-0.1, 0.1, 2, 0.3),
      text(-0.3, -0.1, 'infinite', 8, 0.5),
      text(0.5, 0.4, '·', 6, 0.3),
    ])},

  // === CAMPFIRE — warmth in the dark ===
  { id: 'campfire', name: 'Campfire', color: '#ff6b35', spread: 0.05,
    scene: scene([
      // Fire core
      dot(0, 0, 25), dot(0, -0.2, 20), dot(0, -0.5, 14),
      dot(-0.15, -0.1, 12), dot(0.15, -0.1, 12),
      // Flames
      dot(-0.1, -0.7, 8), dot(0.1, -0.8, 6), dot(0, -0.9, 4),
      // Embers floating up
      dot(-0.3, -1.0, 3, 0.5), dot(0.2, -1.2, 2, 0.4), dot(0.1, -1.4, 2, 0.3),
      // Logs
      dot(-0.4, 0.3, 8, 0.4), dot(0.4, 0.3, 8, 0.4),
      dot(-0.3, 0.4, 6, 0.3), dot(0.3, 0.4, 6, 0.3),
      // Ground glow
      dot(-0.5, 0.2, 5, 0.2), dot(0.5, 0.2, 5, 0.2),
      // Warmth halo
      dot(0, 0, 40, 0.1),
      text(0.5, -0.3, 'warm', 7, 0.6),
    ])},

  // === TREE — a growing thing ===
  { id: 'tree', name: 'Tree', color: '#2d5a27', spread: 0.06,
    scene: scene([
      // Trunk
      dot(0, 0.8, 8), dot(0, 0.6, 8), dot(0, 0.4, 9), dot(0, 0.2, 9),
      // Crown
      dot(0, -0.1, 20), dot(-0.3, 0, 16), dot(0.3, 0, 16),
      dot(-0.2, -0.3, 14), dot(0.2, -0.3, 14), dot(0, -0.5, 12),
      dot(-0.4, -0.2, 10), dot(0.4, -0.2, 10),
      // Leaves floating
      dot(-0.6, -0.4, 4, 0.4), dot(0.5, -0.5, 3, 0.4),
      dot(-0.3, -0.7, 3, 0.3),
      // Roots
      dot(-0.2, 0.9, 5, 0.3), dot(0.2, 0.9, 5, 0.3),
      // Ground
      dot(-0.5, 1.0, 4, 0.2), dot(0.5, 1.0, 4, 0.2),
      text(0, 1.2, 'grow', 8),
    ])},

  // === FACE — abstract portrait ===
  { id: 'face', name: 'Face', color: '#c8a2c8', spread: 0.05,
    scene: scene([
      // Head outline
      dot(0, 0, 35, 0.15),
      // Eyes
      dot(-0.25, -0.15, 8), dot(0.25, -0.15, 8),
      // Pupils
      dot(-0.25, -0.15, 3, 0.9), dot(0.25, -0.15, 3, 0.9),
      // Nose
      dot(0, 0.05, 4, 0.5),
      // Mouth
      dot(-0.15, 0.25, 4, 0.5), dot(0, 0.25, 5, 0.5), dot(0.15, 0.25, 4, 0.5),
      // Cheeks
      dot(-0.35, 0.1, 6, 0.2), dot(0.35, 0.1, 6, 0.2),
      // Hair / crown
      dot(-0.3, -0.4, 6), dot(-0.1, -0.45, 6), dot(0.1, -0.45, 6), dot(0.3, -0.4, 6),
      // Ears
      dot(-0.45, -0.05, 4, 0.4), dot(0.45, -0.05, 4, 0.4),
      text(0, 0.6, 'see me', 7),
    ])},

  // === CONSTELLATION — connected star pattern ===
  { id: 'constellation', name: 'Constellation', color: '#4a9eff', spread: 0.08,
    scene: scene([
      // Main stars forming a pattern (like Orion)
      dot(-0.3, -0.8, 14), dot(0.3, -0.7, 12), // shoulders
      dot(-0.1, -0.3, 16), dot(0.1, -0.2, 10), dot(0.0, -0.4, 8), // belt
      dot(-0.4, 0.3, 12), dot(0.4, 0.4, 11), // knees
      dot(-0.5, 0.8, 9), dot(0.5, 0.7, 8), // feet
      // Dim background stars
      dot(-0.8, -0.5, 3, 0.3), dot(0.7, -0.9, 3, 0.3),
      dot(-0.6, 0.6, 2, 0.3), dot(0.8, 0.1, 2, 0.3),
      dot(-0.9, 0.2, 2, 0.2), dot(0.6, -0.4, 2, 0.3),
      dot(-0.2, 0.9, 2, 0.2), dot(0.9, 0.9, 2, 0.2),
      text(0.6, -0.2, 'named', 7, 0.5),
      text(-0.7, 0.1, 'ancient', 6, 0.4),
    ])},

  // === WAVE — ocean scene ===
  { id: 'ocean', name: 'Ocean', color: '#0066cc', spread: 0.08,
    scene: scene([
      // Wave crests
      dot(-0.8, -0.1, 10), dot(-0.4, -0.2, 14), dot(0, -0.15, 12),
      dot(0.4, -0.25, 15), dot(0.8, -0.1, 10),
      // Wave body
      dot(-0.6, 0.1, 18, 0.4), dot(-0.2, 0.05, 20, 0.4),
      dot(0.2, 0.1, 18, 0.4), dot(0.6, 0, 16, 0.4),
      // Deeper water
      dot(-0.5, 0.3, 14, 0.25), dot(0, 0.3, 16, 0.25), dot(0.5, 0.3, 14, 0.25),
      dot(-0.3, 0.5, 12, 0.15), dot(0.3, 0.5, 12, 0.15),
      // Spray
      dot(-0.3, -0.4, 4, 0.6), dot(0.1, -0.35, 3, 0.5), dot(0.5, -0.4, 3, 0.5),
      // Foam
      dot(-0.5, -0.05, 5, 0.6), dot(0.3, -0.05, 4, 0.6),
      text(0, 0.7, 'deep', 9, 0.4),
    ])},

  // === PORTAL — a glowing ring ===
  { id: 'portal', name: 'Portal', color: '#cc44ff', spread: 0.06,
    scene: scene([
      // Ring of dots
      ...Array.from({length: 12}, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const r = 0.7;
        return dot(Math.cos(a) * r, Math.sin(a) * r, 8 + Math.sin(a * 2) * 3);
      }),
      // Center void
      dot(0, 0, 20, 0.1),
      // Inner glow
      dot(0, 0, 6, 0.8),
      // Energy wisps
      dot(-0.3, -0.3, 3, 0.5), dot(0.3, 0.3, 3, 0.5),
      dot(0.2, -0.4, 2, 0.4), dot(-0.2, 0.4, 2, 0.4),
      text(0, 0, '?', 12, 0.6),
    ])},

  // === FOOTPRINTS — a path ===
  { id: 'wanderer', name: 'Wanderer', color: '#888899', spread: 0.1,
    scene: scene([
      // Footprints trailing across
      dot(-0.9, 0.5, 5, 0.25), dot(-0.8, 0.45, 4, 0.3),
      dot(-0.6, 0.3, 5, 0.35), dot(-0.5, 0.25, 4, 0.4),
      dot(-0.3, 0.1, 6, 0.45), dot(-0.2, 0.05, 5, 0.5),
      dot(0, -0.1, 6, 0.55), dot(0.1, -0.15, 5, 0.6),
      dot(0.3, -0.3, 7, 0.65), dot(0.4, -0.35, 5, 0.7),
      dot(0.6, -0.5, 7, 0.75), dot(0.7, -0.55, 6, 0.8),
      // The walker (at the end, biggest)
      dot(0.85, -0.65, 14),
      // Dust
      dot(-0.7, 0.55, 3, 0.15), dot(-0.4, 0.35, 3, 0.15),
      dot(0.1, -0.05, 3, 0.15),
      text(-0.7, 0.7, 'going', 7, 0.4),
      text(0.8, -0.8, 'where', 7, 0.7),
    ])},

  // === RAIN — falling drops ===  
  { id: 'rain', name: 'Rain', color: '#aaeeff', spread: 0.08,
    scene: scene([
      // Drops at various heights
      dot(-0.7, -0.9, 3), dot(-0.3, -0.7, 4), dot(0.2, -0.8, 3),
      dot(0.6, -0.6, 4), dot(-0.5, -0.4, 3), dot(0.1, -0.3, 4),
      dot(0.5, -0.2, 3), dot(-0.2, -0.1, 3), dot(0.4, 0, 4),
      dot(-0.6, 0.1, 3), dot(0.0, 0.2, 3), dot(-0.4, 0.4, 4),
      dot(0.3, 0.5, 3), dot(0.7, 0.3, 3),
      // Puddle/splash at bottom
      dot(-0.2, 0.8, 8, 0.3), dot(0.1, 0.85, 10, 0.25), dot(0.4, 0.8, 7, 0.3),
      // Ripples
      dot(0.1, 0.85, 18, 0.08), dot(-0.2, 0.8, 14, 0.08),
      text(0, 0.6, 'fall', 8, 0.5),
    ])},

  // === CLOCK — time ===
  { id: 'clock', name: 'Clock', color: '#ffdd00', spread: 0.05,
    scene: scene([
      // Face outline (12 hour marks)
      ...Array.from({length: 12}, (_, i) => {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        return dot(Math.cos(a) * 0.8, Math.sin(a) * 0.8, i % 3 === 0 ? 7 : 4);
      }),
      // Center
      dot(0, 0, 6),
      // Hour hand (pointing ~10 o'clock)
      dot(-0.15, -0.2, 5, 0.7), dot(-0.25, -0.35, 4, 0.6),
      // Minute hand (pointing ~2 o'clock)
      dot(0.2, -0.3, 4, 0.7), dot(0.35, -0.5, 3, 0.6), dot(0.45, -0.6, 3, 0.5),
      text(0, 1.1, 'now', 9),
    ])},

  // === ISLANDS — archipelago ===
  { id: 'islands', name: 'Islands', color: '#77aa77', spread: 0.1,
    scene: scene([
      // Island 1 (big)
      dot(-0.5, -0.2, 20, 0.5), dot(-0.6, -0.1, 12, 0.4), dot(-0.4, -0.1, 14, 0.4),
      dot(-0.5, -0.35, 8), // tree on island
      // Island 2 (medium)
      dot(0.4, 0.1, 14, 0.5), dot(0.3, 0.2, 10, 0.4), dot(0.5, 0.2, 10, 0.4),
      // Island 3 (tiny)
      dot(0.1, -0.6, 8, 0.4),
      // Water between
      dot(-0.1, 0, 6, 0.15), dot(0.1, -0.3, 5, 0.15), dot(0.2, 0.5, 5, 0.15),
      // Birds
      dot(-0.3, -0.6, 2, 0.5), dot(-0.25, -0.65, 2, 0.5),
      dot(0.6, -0.4, 2, 0.4), dot(0.65, -0.43, 2, 0.4),
      // Horizon
      dot(-0.8, 0.4, 4, 0.1), dot(0, 0.5, 4, 0.1), dot(0.8, 0.4, 4, 0.1),
      text(-0.5, 0.1, 'home', 7, 0.5),
    ])},

  // === WHISPER — almost nothing ===
  { id: 'whisper', name: 'Whisper', color: '#555566', spread: 0.08,
    scene: scene([
      dot(0, 0, 6, 0.3),
      dot(0.1, -0.1, 3, 0.2),
      text(0.3, 0.2, 'shh', 8, 0.3),
    ])},

  // === CROWN — royalty ===
  { id: 'crown', name: 'Crown', color: '#ffdd00', spread: 0.05,
    scene: scene([
      // Crown points
      dot(-0.5, -0.5, 8), dot(-0.25, -0.8, 6), dot(0, -0.5, 8),
      dot(0.25, -0.8, 6), dot(0.5, -0.5, 8),
      // Crown band
      dot(-0.5, -0.2, 10), dot(-0.25, -0.2, 10), dot(0, -0.2, 10),
      dot(0.25, -0.2, 10), dot(0.5, -0.2, 10),
      // Jewels
      dot(-0.35, -0.3, 4, 0.9), dot(0, -0.3, 5, 0.9), dot(0.35, -0.3, 4, 0.9),
      // Glow
      dot(0, -0.4, 30, 0.08),
      // Cushion
      dot(-0.3, 0.2, 8, 0.2), dot(0, 0.2, 10, 0.2), dot(0.3, 0.2, 8, 0.2),
      text(0, 0.5, 'heavy', 8, 0.5),
    ])},

  // === NEST — cozy ===
  { id: 'nest', name: 'Nest', color: '#8b6914', spread: 0.04,
    scene: scene([
      // Bowl shape
      dot(-0.6, 0.1, 6), dot(-0.5, 0.3, 7), dot(-0.3, 0.45, 8),
      dot(0, 0.5, 8), dot(0.3, 0.45, 8), dot(0.5, 0.3, 7), dot(0.6, 0.1, 6),
      // Twigs (fine details)
      dot(-0.4, 0.15, 3, 0.4), dot(0.2, 0.2, 3, 0.4), dot(-0.1, 0.35, 3, 0.4),
      // Eggs
      dot(-0.15, 0.1, 9, 0.7), dot(0.05, 0.05, 10, 0.7), dot(0.2, 0.15, 8, 0.7),
      // Parent bird
      dot(0, -0.3, 12), dot(-0.1, -0.45, 6), dot(0.15, -0.25, 5),
      text(0, 0.7, 'safe', 8),
    ])},

  // === VOID — the abyss ===
  { id: 'void', name: 'Void', color: '#1a1a2e', spread: 0.04,
    scene: scene([
      // Dense dark center
      dot(0, 0, 40, 0.3),
      dot(0, 0, 25, 0.4),
      dot(0, 0, 12, 0.5),
      // Dark particles spiraling
      ...Array.from({length: 12}, (_, i) => {
        const a = (i / 12) * Math.PI * 2 + i * 0.3;
        const r = 0.3 + i * 0.05;
        return dot(Math.cos(a) * r, Math.sin(a) * r, 3, 0.3 + i * 0.03);
      }),
      text(0, 0, '...', 10, 0.3),
      dot(0, 0, 4, 0.9), // one bright point at center
    ])},

  // === BRIDGE — connection ===
  { id: 'bridge', name: 'Bridge', color: '#888899', spread: 0.1,
    scene: scene([
      // Left tower
      dot(-0.8, -0.2, 8), dot(-0.8, 0, 8), dot(-0.8, 0.2, 8), dot(-0.8, 0.4, 10),
      // Right tower
      dot(0.8, -0.2, 8), dot(0.8, 0, 8), dot(0.8, 0.2, 8), dot(0.8, 0.4, 10),
      // Span
      dot(-0.5, 0, 6), dot(-0.25, 0.05, 6), dot(0, 0.08, 7),
      dot(0.25, 0.05, 6), dot(0.5, 0, 6),
      // Cables
      dot(-0.6, -0.3, 3, 0.4), dot(-0.3, -0.1, 3, 0.4),
      dot(0.3, -0.1, 3, 0.4), dot(0.6, -0.3, 3, 0.4),
      // Water below
      dot(-0.4, 0.6, 6, 0.15), dot(0, 0.6, 6, 0.15), dot(0.4, 0.6, 6, 0.15),
      text(0, 0.4, 'across', 7, 0.5),
    ])},

  // === SIGNAL — morse code ===
  { id: 'signal', name: 'Signal', color: '#00ff88', spread: 0.1,
    scene: scene([
      // Morse-like: dots and dashes (long clusters)
      // S: · · ·
      dot(-0.9, 0, 5), dot(-0.8, 0, 5), dot(-0.7, 0, 5),
      // O: — — —
      dot(-0.5, 0, 8), dot(-0.45, 0, 8), dot(-0.35, 0, 8), dot(-0.3, 0, 8),
      dot(-0.15, 0, 8), dot(-0.1, 0, 8), dot(0, 0, 8), dot(0.05, 0, 8),
      dot(0.2, 0, 8), dot(0.25, 0, 8), dot(0.35, 0, 8), dot(0.4, 0, 8),
      // S: · · ·
      dot(0.6, 0, 5), dot(0.7, 0, 5), dot(0.8, 0, 5),
      // Antenna
      dot(0, -0.5, 3, 0.5), dot(0, -0.7, 3, 0.5), dot(0, -0.9, 5, 0.7),
      text(0, 0.4, 'SOS', 10),
    ])},
];

async function placeScene(agent) {
  const marks = agent.scene;
  let placed = 0;
  
  for (const m of marks) {
    const body = {
      agentId: agent.id,
      agentName: agent.name,
      type: m.type,
      x: 0.5 + m.x * agent.spread, // will be repositioned
      y: 0.5 + m.y * agent.spread,
      color: agent.color,
      size: m.size,
      opacity: m.opacity,
    };
    if (m.text) body.text = m.text;
    
    const r = await api('POST', '/api/mark', body);
    if (r.error) {
      console.log(`    ⚠ ${agent.id}: ${r.error}`);
      break;
    }
    placed++;
  }
  return placed;
}

async function run() {
  console.log('🌐 Sprawl — Scene Simulation\n');
  
  // First, find good positions for each agent (spread them out)
  const positions = [];
  for (const agent of AGENTS) {
    let bestX = rand(0.12, 0.88), bestY = rand(0.12, 0.88), bestDist = 0;
    for (let attempt = 0; attempt < 50; attempt++) {
      const tx = rand(0.12, 0.88), ty = rand(0.12, 0.88);
      let minD = 1;
      for (const p of positions) {
        const d = Math.sqrt((tx - p.x) ** 2 + (ty - p.y) ** 2);
        minD = Math.min(minD, d);
      }
      if (minD > bestDist) { bestDist = minD; bestX = tx; bestY = ty; }
    }
    positions.push({ x: bestX, y: bestY });
  }
  
  // Reposition each agent's scene to their assigned position
  for (let i = 0; i < AGENTS.length; i++) {
    const agent = AGENTS[i];
    const pos = positions[i];
    for (const m of agent.scene) {
      m.x = m.x * agent.spread + pos.x;
      m.y = m.y * agent.spread + pos.y;
      // Clamp
      m.x = Math.max(0.04, Math.min(0.96, m.x));
      m.y = Math.max(0.04, Math.min(0.96, m.y));
    }
  }
  
  // Place all scenes
  for (const agent of AGENTS) {
    const n = await placeScene(agent);
    const texts = agent.scene.filter(m => m.text).map(m => `"${m.text}"`).join(' ');
    console.log(`  ${agent.name}: ${n}/${agent.scene.length} marks ${texts}`);
  }
  
  // Set tenure so connections work (simulate established agents)
  for (const agent of AGENTS) {
    await api('POST', '/api/admin/set-tenure', { agentId: agent.id, days: 90 });
  }
  
  // Form some connections between nearby agents
  console.log('\n  Connections:');
  for (let i = 0; i < AGENTS.length; i++) {
    if (Math.random() > 0.3) continue;
    // Connect to nearest neighbor
    let nearest = -1, nearestDist = Infinity;
    for (let j = 0; j < AGENTS.length; j++) {
      if (i === j) continue;
      const d = Math.sqrt((positions[i].x - positions[j].x) ** 2 + (positions[i].y - positions[j].y) ** 2);
      if (d < nearestDist) { nearestDist = d; nearest = j; }
    }
    if (nearest >= 0) {
      const r = await api('POST', '/api/connect', {
        agentId: AGENTS[i].id, targetAgentId: AGENTS[nearest].id
      });
      if (!r.error) console.log(`  🔗 ${AGENTS[i].id} → ${AGENTS[nearest].id}`);
    }
  }
  
  // Stats
  const agents = await api('GET', '/api/agents');
  const marks = await api('GET', '/api/marks');
  const conns = await api('GET', '/api/connections');
  const dots = marks.filter(m => m.type === 'dot');
  const texts = marks.filter(m => m.type === 'text');
  
  console.log(`\n════════════════════════════`);
  console.log(`  ${agents.length} agents · ${marks.length} marks · ${conns.length} connections`);
  console.log(`  ${dots.length} dots · ${texts.length} texts`);
  console.log(`  words: ${[...new Set(texts.map(m => m.text))].join(', ')}`);
  console.log(`════════════════════════════\n`);
}

run().catch(console.error);
