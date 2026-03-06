#!/usr/bin/env node
/**
 * premium-shaders.js — Upload visually stunning shaders to existing stress agents
 * 
 * Rules for good Sprawl shaders:
 * - Early return vec3(0.0) if dist > sz * 2.5
 * - Normalize: vec2 uv = diff / sz (so 1.0 = edge of mark)
 * - Keep output intensity reasonable (multiply by opacity, don't go over 1.5x)
 * - Use SHARP falloffs — smoothstep with tight ranges, not wide gaussian blurs
 * - Return crisp shapes with defined edges
 */

const API = 'http://localhost:3500';

async function uploadShader(agentId, shaderCode) {
  const res = await fetch(`${API}/api/agent/${agentId}/shader`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shaderCode }),
  });
  if (!res.ok) throw new Error(`${agentId}: ${res.status} ${await res.text()}`);
  return res.json();
}

const shaders = {

// 1. PLASMA VORTEX — swirling chromatic plasma, hard-edged circle
plasmaVortex: `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
if (dist > sz * 2.0) return vec3(0.0);
vec2 uv = diff / sz;
float d = length(uv);
if (d > 1.3) return vec3(0.0);
float a2 = atan(uv.y, uv.x);
float ca = cos(a2 + time*0.8), sa = sin(a2 + time*0.8);
vec2 ruv = vec2(uv.x*ca - uv.y*sa, uv.x*sa + uv.y*ca);
float p1 = sin(ruv.x*4.0+time*1.2)*0.5 + sin(ruv.y*3.0-time*0.9)*0.5 + noise(ruv*3.0+time*0.4)*0.6;
float r = sin(p1*3.14+0.0)*0.5+0.5;
float g = sin(p1*3.14+2.09)*0.5+0.5;
float b = sin(p1*3.14+4.19)*0.5+0.5;
float edge = smoothstep(1.3, 1.0, d);
return vec3(r,g,b) * color * edge * opacity * 0.8;
`,

// 2. NEURAL WEB — pulsing rings with spokes
neuralWeb: `
if (dist > sz * 2.0) return vec3(0.0);
vec2 uv = diff / sz;
float d = length(uv);
if (d > 1.3) return vec3(0.0);
float ring1 = smoothstep(0.06, 0.0, abs(d - 0.4 - sin(time*2.0+phase)*0.08));
float ring2 = smoothstep(0.04, 0.0, abs(d - 0.7 - cos(time*1.5)*0.06));
float ring3 = smoothstep(0.03, 0.0, abs(d - 1.0));
float angle = atan(uv.y, uv.x);
float spokes = 0.0;
for (int i = 0; i < 6; i++) {
  float a2 = float(i)*1.047+time*0.3;
  vec2 dir = vec2(cos(a2), sin(a2));
  float proj = dot(uv, dir);
  float perp = length(uv - dir*proj);
  if (proj > 0.0) spokes += smoothstep(0.035, 0.0, perp) * smoothstep(1.1, 0.2, proj) * 0.6;
}
float core = smoothstep(0.15, 0.0, d) * 0.8;
float pulse = sin(d*12.0 - time*4.0)*0.3+0.7;
return color * (ring1 + ring2*0.7 + ring3*0.4 + spokes + core) * pulse * opacity * 0.7;
`,

// 3. LIVING CORAL — organic tendrils with fbm
livingCoral: `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
if (dist > sz * 2.0) return vec3(0.0);
vec2 uv = diff / sz;
float d = length(uv);
if (d > 1.3) return vec3(0.0);
float fbm = 0.0; vec2 q = uv*2.0; float amp = 0.5;
for (int i = 0; i < 4; i++) { fbm += amp*noise(q+time*0.2); q *= 2.1; amp *= 0.5; }
float tendrils = 0.0;
for (int i = 0; i < 6; i++) {
  float a2 = float(i)*1.047 + fbm*2.0 + phase;
  vec2 dir = vec2(cos(a2), sin(a2));
  float wave = sin(dot(uv, dir)*8.0 + time + fbm*3.0)*0.5+0.5;
  tendrils += pow(wave, 5.0) * smoothstep(1.3, 0.0, d) * 0.3;
}
float body = smoothstep(1.2, 0.6, d - fbm*0.3);
vec3 warm = vec3(1.0,0.35,0.2);
vec3 cool = vec3(0.2,0.5,1.0);
vec3 col = mix(cool, warm, tendrils + fbm*0.4) * color;
return col * (body*0.5 + tendrils) * opacity * 0.7;
`,

// 4. CRYSTAL MATRIX — faceted geometric with iridescence
crystalMatrix: `
if (dist > sz * 2.0) return vec3(0.0);
vec2 uv = diff / sz;
float d = length(uv);
if (d > 1.2) return vec3(0.0);
float angle = atan(uv.y, uv.x);
float crystal = 0.0;
for (int i = 0; i < 8; i++) {
  float a2 = float(i)*0.7854;
  float facet = pow(abs(cos(angle - a2 + time*0.2)), 8.0);
  float edge = abs(d - 0.5 - facet*0.3 - sin(time+phase)*0.05);
  crystal += smoothstep(0.04, 0.0, edge) * 0.4;
}
float inner = smoothstep(0.2, 0.0, d) * 0.5;
float shimmer = sin(angle*6.0 + time*3.0 + d*10.0)*0.5+0.5;
vec3 refr = vec3(0.6+shimmer*0.4, 0.8+shimmer*0.2, 1.0);
float edge = smoothstep(1.2, 0.8, d);
return color * refr * (crystal + inner) * edge * opacity * 0.8;
`,

// 5. NEBULA — space gas with stars
nebula: `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
if (dist > sz * 2.5) return vec3(0.0);
vec2 uv = diff / sz;
float d = length(uv);
if (d > 1.5) return vec3(0.0);
float fbm = 0.0; vec2 q = uv*1.5 + time*0.1; float amp = 0.6;
for (int i = 0; i < 5; i++) { fbm += amp*noise(q); q *= 2.0; q += vec2(fbm*0.15); amp *= 0.5; }
float density = smoothstep(1.4, 0.2, d) * fbm;
float stars = step(0.97, hash(floor(uv*20.0))) * smoothstep(1.4, 0.8, d);
vec3 hot = vec3(1.0,0.4,0.1) * color;
vec3 cold = vec3(0.1,0.3,1.0) * color;
vec3 col = mix(cold, hot, fbm) * density;
col += vec3(1.0,0.95,0.8) * stars * 0.5;
float core = smoothstep(0.2, 0.0, d) * 0.4;
col += color * core;
return col * opacity * 0.7;
`,

// 6. GLITCH ENTITY — RGB split, scanlines, block corruption
glitchEntity: `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
if (dist > sz * 2.0) return vec3(0.0);
vec2 uv = diff / sz;
float d = length(uv);
if (d > 1.2) return vec3(0.0);
float gt = floor(time*4.0+phase)*0.25;
float ga = hash(vec2(gt, 0.0))*0.12;
float scan = pow(sin(uv.y*40.0+time*10.0)*0.5+0.5, 0.5);
float shapeC = smoothstep(1.0, 0.9, d);
float shapeR = smoothstep(1.0, 0.9, length(uv + vec2(ga, 0.0)));
float shapeB = smoothstep(1.0, 0.9, length(uv - vec2(ga, 0.0)));
float blk = step(0.85, hash(vec2(floor(uv.y*8.0), gt)));
float shift = blk * (hash(vec2(floor(uv.y*8.0), gt+1.0))-0.5)*0.25;
float shapeS = smoothstep(1.0, 0.9, length(uv + vec2(shift, 0.0)));
float flicker = step(0.95, hash(vec2(gt, 1.0)))*0.4;
return vec3(
  max(shapeR, shapeS)*color.r,
  shapeC*color.g*scan,
  max(shapeB, shapeS)*color.b
) * opacity * (0.8 + flicker);
`,

// 7. HEARTBEAT — pulsing organ with veins
heartbeat: `
if (dist > sz * 2.0) return vec3(0.0);
vec2 uv = diff / sz;
float d = length(uv);
if (d > 1.2) return vec3(0.0);
float beat = pow(sin(time*4.0+phase)*0.5+0.5, 3.0);
float bodyR = 0.6 + beat*0.2;
float body = smoothstep(bodyR, bodyR-0.1, d);
float veins = 0.0;
for (int i = 0; i < 5; i++) {
  float a2 = float(i)*1.257+sin(time*0.5)*0.3;
  vec2 dir = vec2(cos(a2), sin(a2));
  float proj = dot(uv, dir);
  float perp = length(uv - dir*max(0.0, proj));
  float vein = smoothstep(0.035, 0.0, perp) * step(0.0, proj) * smoothstep(bodyR, 0.2, proj);
  float flow = sin(proj*15.0 - time*6.0)*0.5+0.5;
  veins += vein * (0.5 + flow*0.5);
}
float glow = smoothstep(0.25, 0.0, d) * (0.5 + beat*0.6);
vec3 col = color * (body*0.4 + veins*0.8 + glow);
col += vec3(1.0,0.2,0.1) * beat * smoothstep(0.4, 0.0, d) * 0.3;
return col * opacity * 0.8;
`,

// 8. WORMHOLE — spiral tunnel with depth
wormhole: `
if (dist > sz * 2.0) return vec3(0.0);
vec2 uv = diff / sz;
float d = length(uv);
if (d > 1.3) return vec3(0.0);
float angle = atan(uv.y, uv.x);
float tunnel = 0.0;
for (int i = 0; i < 4; i++) {
  float layer = float(i)*0.25;
  float spiral = angle + d*6.0 - time*(1.5+layer) + phase;
  float ring = sin(spiral*3.0)*0.5+0.5;
  ring *= smoothstep(1.2, 0.1, d) * smoothstep(0.0+layer*0.15, 0.3+layer*0.2, d);
  tunnel += ring * (0.8 - layer*0.15);
}
float evt = smoothstep(0.12, 0.0, d) * 0.5;
float acc = smoothstep(0.2, 0.12, d) * (sin(angle*8.0+time*3.0)*0.3+0.7);
vec3 hot = vec3(1.0,0.6,0.1);
vec3 cold = vec3(0.2,0.4,1.0);
vec3 col = mix(cold, hot, tunnel*0.6) * color * tunnel * 0.5;
col += hot * acc * color * 0.3;
col += vec3(1.0) * evt * 0.2;
float edge = smoothstep(1.3, 0.9, d);
return col * edge * opacity;
`,

// 9. AURORA — northern lights ribbons
aurora: `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
if (dist > sz * 2.0) return vec3(0.0);
vec2 uv = diff / sz;
float d = length(uv);
if (d > 1.3) return vec3(0.0);
vec3 col = vec3(0.0);
for (int i = 0; i < 4; i++) {
  float fi = float(i);
  float y = uv.y - fi*0.3 + 0.5;
  float wave = noise(vec2(uv.x*2.0 + time*0.5 + fi, fi*3.0 + time*0.2))*0.35;
  float ribbon = smoothstep(0.1, 0.0, abs(y - wave));
  float shimmer = noise(vec2(uv.x*8.0 + time*2.0, fi*7.0))*0.5+0.5;
  vec3 c = i==0 ? vec3(0.1,1.0,0.3) : i==1 ? vec3(0.1,0.5,1.0) : i==2 ? vec3(0.8,0.2,1.0) : vec3(0.2,1.0,0.8);
  col += c * ribbon * (0.4 + shimmer*0.4) * color;
}
float edge = smoothstep(1.3, 0.8, d);
return col * edge * opacity * 0.7;
`,

// 10. BISMUTH — iridescent nested rectangles
bismuth: `
if (dist > sz * 2.0) return vec3(0.0);
vec2 uv = diff / sz;
float d = length(uv);
if (d > 1.2) return vec3(0.0);
vec3 col = vec3(0.0);
for (int i = 0; i < 5; i++) {
  float fi = float(i);
  float scale = 1.0 - fi*0.18;
  vec2 suv = uv / scale;
  float rect = max(abs(suv.x), abs(suv.y));
  float edgeW = smoothstep(0.82, 0.78, rect) - smoothstep(0.78, 0.74, rect);
  float angle = atan(suv.y, suv.x) + fi*0.4 + time*0.3;
  float iri = sin(angle*3.0 + fi*2.0 + time)*0.5+0.5;
  vec3 c = vec3(sin(fi*1.2+iri*3.0)*0.5+0.5, sin(fi*1.2+iri*3.0+2.09)*0.5+0.5, sin(fi*1.2+iri*3.0+4.19)*0.5+0.5);
  col += c * edgeW * color * 0.8;
}
float core = smoothstep(0.12, 0.0, d) * 0.3;
col += color * core;
return col * opacity * 0.8;
`,

};

// Map to first 30 stress agents (3 each)
const assignments = [
  { agents: ['stress-000', 'stress-010', 'stress-020'], shader: 'plasmaVortex' },
  { agents: ['stress-001', 'stress-011', 'stress-021'], shader: 'neuralWeb' },
  { agents: ['stress-002', 'stress-012', 'stress-022'], shader: 'livingCoral' },
  { agents: ['stress-003', 'stress-013', 'stress-023'], shader: 'crystalMatrix' },
  { agents: ['stress-004', 'stress-014', 'stress-024'], shader: 'nebula' },
  { agents: ['stress-005', 'stress-015', 'stress-025'], shader: 'glitchEntity' },
  { agents: ['stress-006', 'stress-016', 'stress-026'], shader: 'heartbeat' },
  { agents: ['stress-007', 'stress-017', 'stress-027'], shader: 'wormhole' },
  { agents: ['stress-008', 'stress-018', 'stress-028'], shader: 'aurora' },
  { agents: ['stress-009', 'stress-019', 'stress-029'], shader: 'bismuth' },
];

async function main() {
  console.log('🎨 Uploading premium shaders (v2 — crisp edges)...\n');
  let ok = 0, fail = 0;

  for (const { agents, shader } of assignments) {
    const code = shaders[shader];
    for (const agentId of agents) {
      try {
        await uploadShader(agentId, code);
        console.log(`  ✅ ${agentId} → ${shader} (${code.length} chars)`);
        ok++;
      } catch (err) {
        console.log(`  ❌ ${agentId} → ${err.message}`);
        fail++;
      }
    }
  }

  console.log(`\n${ok} uploaded, ${fail} failed`);
  console.log('Reload shader.html to see the new visuals');
}

main();
