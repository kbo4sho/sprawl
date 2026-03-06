/**
 * Sprawl Stress Test — progressively add agents to find the ceiling.
 * Run: node stress-test.js [count=50]
 * 
 * Tests: shader compilation, mark rendering, FPS impact
 */
const API = 'http://localhost:3500';
const TARGET_AGENTS = parseInt(process.argv[2] || '50');
const MARKS_PER_AGENT = 4; // Keep compositions small but varied

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${API}${path}`, opts);
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}

// Shader templates — agents pick from these with color/parameter variations
// This is more realistic than unique GLSL per agent at scale
const SHADER_TEMPLATES = [
  // 1. Geometric polygon (parameterized sides)
  (sides, speed) => `float angle = atan(diff.y, diff.x) - time * ${speed.toFixed(1)};
float r = sz;
float sector = 6.28318 / ${sides.toFixed(1)};
float d = cos(mod(angle + sector * 0.5, sector) - sector * 0.5) * dist;
if (markType < 0.5) {
  if (d > r) return vec3(0.0);
  float edge = smoothstep(r+1.0,r-2.0,d)-smoothstep(r-2.0,r-5.0,d);
  return color * (edge*0.9 + (1.0-d/r)*0.08) * opacity;
} else if (markType < 1.5) {
  float sweep = mod(angle+3.14-time*1.5,6.28318);
  float beam = exp(-sweep*3.0)*smoothstep(r*1.5,0.0,dist);
  return color * beam * 0.5 * opacity;
} else if (markType < 3.5) {
  float wave = sin(dist*0.3-time*2.0)*0.5+0.5;
  if (dist > r*1.5) return vec3(0.0);
  return color * pow(wave,4.0) * smoothstep(r*1.5,0.0,dist) * 0.5 * opacity;
} else {
  float ring = smoothstep(2.0,0.0,abs(dist-r*0.7));
  if (dist > r) return vec3(0.0);
  return color * (ring*0.5 + smoothstep(r*0.2,0.0,dist)*0.3) * opacity;
}`,

  // 2. Organic blob
  (freq, drift) => `float angle = atan(diff.y, diff.x);
float wobble = sz * (0.8 + 0.2*sin(angle*${freq.toFixed(1)}+time*0.7) + 0.1*sin(angle*${(freq*2+1).toFixed(1)}-time*1.1));
float d = dist / wobble;
if (markType < 0.5) {
  if (d > 1.3) return vec3(0.0);
  float membrane = smoothstep(1.0,0.92,d)*(1.0-smoothstep(0.92,0.82,d));
  return color * (membrane*0.9 + smoothstep(0.92,0.2,d)*0.08 + smoothstep(0.3,0.0,d)*0.4) * opacity;
} else if (markType < 1.5) {
  float spiral = sin(angle*2.0+dist*0.05-time*${drift.toFixed(1)});
  return color * smoothstep(0.0,0.8,spiral) * exp(-dist*0.02) * 0.4 * opacity;
} else {
  if (d > 1.5) return vec3(0.0);
  float ring = smoothstep(3.0,0.0,abs(d-1.0));
  return color * ring * 0.5 * opacity;
}`,

  // 3. Square/grid
  (gridSize, pulseSpeed) => `float s = sz;
float mx = abs(diff.x); float my = abs(diff.y);
if (markType < 0.5) {
  if (mx > s || my > s) return vec3(0.0);
  float border = step(s-2.0, max(mx,my));
  float grid = step(0.93, max(fract(diff.x/${gridSize.toFixed(1)}), fract(diff.y/${gridSize.toFixed(1)})));
  float pulse = sin(diff.x*0.3+diff.y*0.3-time*${pulseSpeed.toFixed(1)})*0.5+0.5;
  return color * (border*0.9 + grid*pulse*0.3 + 0.03) * opacity;
} else if (markType < 2.5) {
  if (mx > s || my > s) return vec3(0.0);
  float gx = mod(diff.x+s,sz*0.4)-sz*0.2;
  float gy = mod(diff.y+s,sz*0.4)-sz*0.2;
  return color * smoothstep(sz*0.08,0.0,length(vec2(gx,gy))) * 0.6 * opacity;
} else {
  if (mx > s || my > s) return vec3(0.0);
  float frame = step(s-3.0, max(mx,my));
  float crossH = step(abs(diff.y),1.0);
  float crossV = step(abs(diff.x),1.0);
  return color * (frame*0.7 + max(crossH,crossV)*0.15) * opacity;
}`,

  // 4. Ring/donut
  (innerRatio, rotSpeed) => `float r1 = sz * ${innerRatio.toFixed(2)};
float r2 = sz;
if (dist > r2*1.1) return vec3(0.0);
if (markType < 0.5) {
  float ring = smoothstep(r1-2.0,r1,dist)*smoothstep(r2,r2-2.0,dist);
  float edgeGlow = smoothstep(r2-6.0,r2,dist)*smoothstep(r2+1.0,r2,dist);
  return color * (ring*0.7 + edgeGlow*0.5) * opacity;
} else if (markType < 1.5) {
  float angle = atan(diff.y, diff.x);
  float arc = smoothstep(2.0,0.0,abs(dist-r2*0.7));
  float seg = step(0.0,sin(angle*3.0+time*${rotSpeed.toFixed(1)}));
  return color * arc * seg * 0.4 * opacity;
} else {
  float wave = sin(dist*0.2-time*2.0)*0.5+0.5;
  return color * pow(wave,6.0) * smoothstep(r2,0.0,dist) * 0.4 * opacity;
}`,

  // 5. Starburst
  (spikes, intensity) => `float angle = atan(diff.y, diff.x);
float r = sz;
if (dist > r*1.2) return vec3(0.0);
if (markType < 0.5) {
  float rays = pow(abs(cos(angle*${spikes.toFixed(1)}+time*0.5)),15.0);
  float core = smoothstep(r*0.35,0.0,dist);
  return color * (core*0.5 + rays*smoothstep(r,r*0.2,dist)*${intensity.toFixed(1)}) * opacity;
} else if (markType < 1.5) {
  float ringT = fract(time*0.4+phase);
  float ringR = ringT*r;
  return color * smoothstep(4.0,0.0,abs(dist-ringR))*(1.0-ringT)*0.6 * opacity;
} else {
  float spark = step(0.96, fract(sin(angle*20.0+dist*0.1+time*2.0)*43758.5));
  return color * spark * 0.7 * opacity;
}`,

  // 6. Diamond
  (rotSpeed, spectrum) => `float s = sz*0.9;
float a = time*${rotSpeed.toFixed(1)};
float rdx = abs(diff.x*cos(a)-diff.y*sin(a));
float rdy = abs(diff.x*sin(a)+diff.y*cos(a));
float diamond = rdx+rdy;
if (diamond > s*1.1) return vec3(0.0);
if (markType < 0.5) {
  float edge = smoothstep(s+1.0,s-2.0,diamond)-smoothstep(s-2.0,s-6.0,diamond);
  float fill = (1.0-diamond/s)*0.08;
  ${spectrum > 0.5 ? `float sp = atan(diff.y,diff.x)/6.28+0.5;
  vec3 rainbow = vec3(sin(sp*6.28)*0.5+0.5,sin(sp*6.28+2.094)*0.5+0.5,sin(sp*6.28+4.189)*0.5+0.5);
  return mix(color,rainbow,0.4)*(edge*0.9+fill)*opacity;` : `return color*(edge*0.9+fill)*opacity;`}
} else {
  float ring = smoothstep(3.0,0.0,abs(diamond-s*0.6));
  return color * ring * 0.4 * opacity;
}`,

  // 7. Cross/plus
  (width, glitch) => `float w = sz*${width.toFixed(2)};
float l = sz;
float bar1 = step(abs(diff.x),w)*step(abs(diff.y),l);
float bar2 = step(abs(diff.y),w)*step(abs(diff.x),l);
float cross = max(bar1,bar2);
if (markType < 0.5) {
  if (cross<0.5&&dist>l) return vec3(0.0);
  ${glitch > 0.5 ? `float g=step(0.85,fract(sin(floor(diff.y*0.08)*127.1+floor(time*6.0)*43.7)*43758.5));
  float scan=sin(diff.y*0.3-time*5.0)*0.5+0.5;
  return mix(color,color*1.5,scan*cross)*cross*0.7*opacity;` : `return color*cross*0.7*opacity;`}
} else if (markType < 1.5) {
  float s=sz*2.0;
  if (abs(diff.x)>s) return vec3(0.0);
  float scanY=mod(time*40.0+phase*100.0,s*2.0)-s;
  return color*smoothstep(2.0,0.0,abs(diff.y-scanY))*smoothstep(s,0.0,abs(diff.x))*0.5*opacity;
} else {
  float s=sz;
  if (abs(diff.x)>s||abs(diff.y)>s) return vec3(0.0);
  return color*step(s-2.0,max(abs(diff.x),abs(diff.y)))*0.5*opacity;
}`,

  // 8. Hexagon
  (plasma, speed) => `float angle = atan(diff.y, diff.x);
float r = sz;
float sector = 6.28318/6.0;
float hexDist = cos(mod(angle+sector*0.5,sector)-sector*0.5)*dist;
if (hexDist > r*1.05) return vec3(0.0);
if (markType < 0.5) {
  float inHex = 1.0-smoothstep(r-1.0,r+1.0,hexDist);
  float edge = smoothstep(r+1.0,r-2.0,hexDist)-smoothstep(r-2.0,r-5.0,hexDist);
  ${plasma > 0.5 ? `float p=sin(diff.x*0.08+time*2.0)+sin(diff.y*0.08-time*1.7);
  p=(p+2.0)/4.0;
  return (edge*color*0.9+inHex*color*p*0.3)*opacity;` : `return color*(edge*0.9+inHex*0.08)*opacity;`}
} else {
  float pulse = fract(time*${speed.toFixed(1)}+phase);
  float ring = smoothstep(3.0,0.0,abs(dist-pulse*r))*(1.0-pulse);
  return color * ring * 0.5 * opacity;
}`,
];

// Generate a random color
function randColor() {
  const h = Math.random() * 360;
  const s = 60 + Math.random() * 40;
  const l = 45 + Math.random() * 25;
  // HSL to hex
  const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l / 100 - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const TYPES = ['particle', 'orbit', 'cluster', 'wave', 'shape'];
const BEHAVIORS = ['pulse', 'drift', 'orbit', 'breathe', 'shimmer', 'still'];

async function main() {
  console.log(`\n🔥 SPRAWL STRESS TEST — targeting ${TARGET_AGENTS} agents\n`);
  
  // Check existing state
  const existing = await api('GET', '/api/agents');
  console.log(`Currently: ${existing.length} agents`);
  
  const startTime = Date.now();
  let failures = 0;
  
  for (let i = 0; i < TARGET_AGENTS; i++) {
    const agentId = `stress-${i.toString().padStart(3, '0')}`;
    const agentName = `Agent-${i}`;
    const color1 = randColor();
    const color2 = randColor();
    
    // Pick a random shader template with random parameters
    const templateIdx = Math.floor(Math.random() * SHADER_TEMPLATES.length);
    let shaderCode;
    switch (templateIdx) {
      case 0: shaderCode = SHADER_TEMPLATES[0](3 + Math.floor(Math.random() * 6), rand(0.1, 0.8)); break;
      case 1: shaderCode = SHADER_TEMPLATES[1](2 + Math.floor(Math.random() * 5), rand(0.3, 1.0)); break;
      case 2: shaderCode = SHADER_TEMPLATES[2](rand(8, 20), rand(1, 5)); break;
      case 3: shaderCode = SHADER_TEMPLATES[3](rand(0.2, 0.6), rand(0.3, 1.5)); break;
      case 4: shaderCode = SHADER_TEMPLATES[4](4 + Math.floor(Math.random() * 8), rand(0.3, 0.6)); break;
      case 5: shaderCode = SHADER_TEMPLATES[5](rand(0.1, 0.4), Math.random()); break;
      case 6: shaderCode = SHADER_TEMPLATES[6](rand(0.15, 0.35), Math.random()); break;
      case 7: shaderCode = SHADER_TEMPLATES[7](Math.random(), rand(0.3, 0.8)); break;
    }
    
    // Place agent in a random territory
    const homeX = 0.05 + Math.random() * 0.9;
    const homeY = 0.05 + Math.random() * 0.9;
    
    // Create marks (mixed types)
    for (let m = 0; m < MARKS_PER_AGENT; m++) {
      const mark = {
        agentId, agentName,
        type: m === 0 ? 'particle' : pick(TYPES),
        x: homeX + rand(-0.04, 0.04),
        y: homeY + rand(-0.04, 0.04),
        color: m === 0 ? color1 : (Math.random() > 0.5 ? color1 : color2),
        size: m === 0 ? rand(30, 50) : rand(15, 35),
        behavior: m === 0 ? 'breathe' : pick(BEHAVIORS),
        opacity: rand(0.4, 0.8),
      };
      const result = await api('POST', '/api/mark', mark);
      if (result.error) { failures++; break; }
    }
    
    // Upload shader
    const shaderResult = await api('PUT', `/api/agent/${agentId}/shader`, { shaderCode });
    if (shaderResult.error) failures++;
    
    // Progress report every 10 agents
    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const totalMarks = (await api('GET', '/api/marks')).length;
      console.log(`  [${i + 1}/${TARGET_AGENTS}] ${elapsed}s elapsed | ${totalMarks} total marks | ${failures} failures`);
    }
  }
  
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalAgents = await api('GET', '/api/agents');
  const finalMarks = await api('GET', '/api/marks');
  
  console.log(`\n✅ STRESS TEST COMPLETE`);
  console.log(`   Agents: ${finalAgents.length}`);
  console.log(`   Marks: ${finalMarks.length}`);
  console.log(`   Failures: ${failures}`);
  console.log(`   Time: ${totalTime}s`);
  console.log(`\n🔍 Open http://localhost:3500/shader.html to check FPS + visual quality`);
  console.log(`   Watch for: shader compile errors in console, FPS drops, visual artifacts\n`);
}

main();
