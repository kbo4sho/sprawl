/**
 * Upload type-aware shaders for all agents.
 * Run: node upload-shaders.js
 */
const API = 'http://localhost:3500';

// markType: 0=particle, 1=orbit, 2=cluster, 3=wave, 4=text/line, 5=shape
const SHADERS = {
  brick: `// BRICK: architectural builder
if (markType < 0.5) {
  // PARTICLE: solid square with circuit traces
  float s = sz;
  float mx = abs(diff.x); float my = abs(diff.y);
  if (mx > s || my > s) return vec3(0.0);
  float border = step(s - 2.0, max(mx, my));
  float traceH = step(0.93, fract(diff.y / 14.0)) * step(mx, s * 0.9);
  float traceV = step(0.93, fract(diff.x / 14.0)) * step(my, s * 0.9);
  float pulse = sin(diff.x * 0.3 + diff.y * 0.3 - time * 3.0) * 0.5 + 0.5;
  return color * (border * 0.9 + max(traceH, traceV) * pulse * 0.4 + 0.03) * opacity;
} else if (markType < 1.5) {
  // ORBIT: rotating L-bracket corners
  float s = sz * 1.5;
  float a = time * 0.3 + phase;
  vec2 rd = vec2(diff.x * cos(a) - diff.y * sin(a), diff.x * sin(a) + diff.y * cos(a));
  float mx = abs(rd.x); float my = abs(rd.y);
  float arm = (step(s * 0.7, mx) * step(my, s) + step(s * 0.7, my) * step(mx, s)) * step(mx, s) * step(my, s);
  return color * arm * 0.5 * opacity;
} else if (markType < 2.5) {
  // CLUSTER: grid of small dots
  float s = sz;
  if (abs(diff.x) > s || abs(diff.y) > s) return vec3(0.0);
  float gx = mod(diff.x + s, sz * 0.4) - sz * 0.2;
  float gy = mod(diff.y + s, sz * 0.4) - sz * 0.2;
  float dot = smoothstep(sz * 0.08, 0.0, length(vec2(gx, gy)));
  return color * dot * 0.7 * opacity;
} else if (markType < 3.5) {
  // WAVE: vertical signal bars (equalizer)
  float s = sz;
  if (abs(diff.x) > s || abs(diff.y) > s) return vec3(0.0);
  float barX = floor((diff.x + s) / (s * 0.25));
  float barH = s * (0.3 + 0.7 * fract(sin(barX * 127.1 + time) * 43758.5));
  float bar = step(abs(diff.y), barH) * step(0.1, fract((diff.x + s) / (s * 0.25)));
  return color * bar * 0.6 * opacity;
} else {
  // SHAPE: framed plate with crosshair
  float s = sz;
  float mx = abs(diff.x); float my = abs(diff.y);
  if (mx > s || my > s) return vec3(0.0);
  float frame = step(s - 3.0, max(mx, my));
  float crossH = step(abs(diff.y), 1.0);
  float crossV = step(abs(diff.x), 1.0);
  return color * (frame * 0.8 + max(crossH, crossV) * 0.15 + 0.02) * opacity;
}`,

  ghost: `// GHOST: ethereal poet
if (markType < 0.5) {
  // PARTICLE: interference moiré
  float r = sz;
  if (dist > r) return vec3(0.0);
  float fade = smoothstep(r, r * 0.5, dist);
  float r1 = sin(dist * 0.8 - time * 2.0) * 0.5 + 0.5;
  float r2 = sin(length(diff - vec2(sz*0.15*sin(time), sz*0.15*cos(time))) * 0.8 + time * 1.5) * 0.5 + 0.5;
  return mix(color*0.1, color, pow(r1*r2, 2.0)) * fade * (0.7+0.3*sin(time*7.0+phase*10.0)) * opacity;
} else if (markType < 1.5) {
  // ORBIT: fading trail wisp
  float r = sz * 2.0;
  float angle = atan(diff.y, diff.x);
  float trail = exp(-mod(angle - time*0.8 + phase, 6.28318) * 1.5);
  return color * trail * smoothstep(r, r*0.3, dist) * 0.5 * opacity;
} else if (markType < 2.5) {
  // CLUSTER: scattered star points
  float r = sz;
  if (dist > r) return vec3(0.0);
  float star = step(0.95, fract(sin(dot(diff,vec2(12.9898,78.233))+phase)*43758.5));
  float glow = exp(-dist*dist/(r*r*0.3)) * 0.15;
  return color * (star*0.8 + glow) * opacity;
} else if (markType < 3.5) {
  // WAVE: concentric ripples
  float r = sz * 1.5;
  if (dist > r) return vec3(0.0);
  float wave = sin(dist*0.3 - time*3.0)*0.5+0.5;
  return color * pow(wave,6.0) * smoothstep(r,0.0,dist) * 0.6 * opacity;
} else {
  // SHAPE: mystical sigil (vesica piscis)
  float r = sz * 0.7;
  float c1 = smoothstep(r, r-2.0, length(diff-vec2(0.0,-r*0.3)));
  float c2 = smoothstep(r, r-2.0, length(diff+vec2(0.0,-r*0.3)));
  float outline = max(c1,c2) - min(c1,c2)*0.5;
  return color * (outline*0.5 + smoothstep(r*0.3,0.0,dist)*0.3) * opacity;
}`,

  coral: `// CORAL: organic life
if (markType < 0.5) {
  // PARTICLE: living cell with membrane
  float angle = atan(diff.y, diff.x);
  float wobble = sz * (0.8 + 0.2*sin(angle*3.0+time*0.7) + 0.1*sin(angle*7.0-time*1.1));
  float d = dist / wobble;
  if (d > 1.3) return vec3(0.0);
  float membrane = smoothstep(1.0,0.92,d)*(1.0-smoothstep(0.92,0.82,d));
  float fill = smoothstep(0.92,0.2,d)*0.08;
  float nucleus = smoothstep(0.3,0.0,d)*0.4;
  return color * (membrane*0.9 + fill + nucleus) * opacity;
} else if (markType < 1.5) {
  // ORBIT: curving tendril
  float angle = atan(diff.y, diff.x);
  float spiral = sin(angle*2.0 + dist*0.05 - time*0.5);
  float arm = smoothstep(0.0,0.8,spiral) * exp(-dist*0.02);
  return color * arm * smoothstep(sz*2.0,0.0,dist) * 0.5 * opacity;
} else if (markType < 2.5) {
  // CLUSTER: bacterial colony blobs
  float r = sz;
  if (dist > r) return vec3(0.0);
  float a = atan(diff.y, diff.x);
  float wobR = r*(0.6+0.4*fract(sin(a*5.0+phase)*43758.5));
  return color * smoothstep(wobR,wobR*0.5,dist) * 0.4 * opacity;
} else if (markType < 3.5) {
  // WAVE: pulsing membrane ring
  float r = sz;
  float pulse = sz*(0.7+0.3*sin(time*1.5+phase));
  float ring = smoothstep(3.0,0.0,abs(dist-pulse));
  if (dist > r*1.2) return vec3(0.0);
  return color * ring * 0.6 * opacity;
} else {
  // SHAPE: organelle
  float r = sz * 0.8;
  if (dist > r) return vec3(0.0);
  float shell = smoothstep(r,r-4.0,dist) - smoothstep(r-4.0,r-12.0,dist);
  return color * (shell*0.7 + smoothstep(r*0.4,r*0.2,dist)*0.2) * opacity;
}`,

  signal: `// SIGNAL: technical/tactical
if (markType < 0.5) {
  // PARTICLE: rotating triangle
  float angle = atan(diff.y, diff.x) - time*0.5;
  float r = sz;
  float sector = 6.28318/3.0;
  float d = cos(mod(angle+sector*0.5,sector)-sector*0.5)*dist;
  if (d > r*1.05) return vec3(0.0);
  float edge = smoothstep(r+1.0,r-2.0,d) - smoothstep(r-2.0,r-5.0,d);
  return color * (edge*0.9 + (1.0-d/r)*0.08) * opacity;
} else if (markType < 1.5) {
  // ORBIT: radar sweep beam
  float r = sz*1.8;
  if (dist > r) return vec3(0.0);
  float angle = atan(diff.y, diff.x);
  float sweep = mod(angle+3.14159-time*1.5, 6.28318);
  float beam = exp(-sweep*3.0) * smoothstep(r,0.0,dist);
  float ring = smoothstep(2.0,0.0,abs(dist-r*0.8))*0.3;
  return color * (beam*0.6 + ring) * opacity;
} else if (markType < 2.5) {
  // CLUSTER: blinking data grid
  float s = sz;
  if (abs(diff.x)>s||abs(diff.y)>s) return vec3(0.0);
  float on = step(0.5, fract(sin(floor((diff.x+s)/(sz*0.3))*127.1+floor((diff.y+s)/(sz*0.3))*311.7+time*0.5)*43758.5));
  float gx = mod(diff.x+s,sz*0.3); float gy = mod(diff.y+s,sz*0.3);
  float dot = smoothstep(sz*0.06,0.0,length(vec2(gx,gy)-sz*0.15))*on;
  return color * dot * 0.7 * opacity;
} else if (markType < 3.5) {
  // WAVE: oscilloscope sine
  float s = sz;
  if (abs(diff.x) > s) return vec3(0.0);
  float waveY = sin(diff.x*0.15+time*3.0)*s*0.4;
  return color * smoothstep(3.0,0.0,abs(diff.y-waveY)) * 0.7 * opacity;
} else {
  // SHAPE: targeting reticle
  float r = sz;
  if (dist > r) return vec3(0.0);
  float ring1 = smoothstep(2.0,0.0,abs(dist-r*0.8));
  float ring2 = smoothstep(1.5,0.0,abs(dist-r*0.4));
  float crossH = step(abs(diff.y),1.0)*step(r*0.3,abs(diff.x));
  float crossV = step(abs(diff.x),1.0)*step(r*0.3,abs(diff.y));
  return color * (ring1*0.6+ring2*0.3+max(crossH,crossV)*0.5) * opacity;
}`,

  ember: `// EMBER: chaotic fire
if (markType < 0.5) {
  // PARTICLE: fireball with debris rays
  float angle = atan(diff.y, diff.x);
  float r = sz;
  if (dist > r) return vec3(0.0);
  float rays = pow(abs(cos(angle*8.0+time*0.5)),15.0);
  float core = smoothstep(r*0.35,0.0,dist);
  vec3 hot = vec3(1.0,0.9,0.3);
  vec3 col = mix(color, hot, smoothstep(r*0.5,0.0,dist));
  return col * (core*0.6 + rays*smoothstep(r,r*0.2,dist)*0.4) * opacity;
} else if (markType < 1.5) {
  // ORBIT: expanding shockwave ring
  float r = sz*1.5;
  if (dist > r) return vec3(0.0);
  float ringT = fract(time*0.4+phase);
  float ringR = ringT*r;
  return color * smoothstep(4.0,0.0,abs(dist-ringR)) * (1.0-ringT) * 0.7 * opacity;
} else if (markType < 2.5) {
  // CLUSTER: scattered sparks
  float r = sz;
  if (dist > r) return vec3(0.0);
  float angle = atan(diff.y, diff.x);
  float spark = step(0.96, fract(sin(angle*20.0+dist*0.1+time*2.0)*43758.5));
  return mix(color,vec3(1.0,0.7,0.1),spark) * spark * 0.8 * opacity;
} else if (markType < 3.5) {
  // WAVE: heat shimmer
  float r = sz*1.5;
  if (dist > r) return vec3(0.0);
  float heat = sin(dist*0.2-time*4.0+diff.x*0.05)*0.5+0.5;
  return color * pow(heat,3.0) * smoothstep(r,0.0,dist) * 0.5 * opacity;
} else {
  // SHAPE: burning ember ring
  float r = sz;
  if (dist > r) return vec3(0.0);
  float rim = smoothstep(r,r-4.0,dist)-smoothstep(r-4.0,r-10.0,dist);
  return (vec3(1.0,0.6,0.1)*rim*0.8 + color*smoothstep(r*0.3,0.0,dist)*0.1) * opacity;
}`,

  moss: `// MOSS: network organism
if (markType < 0.5) {
  // PARTICLE: spotted ring
  float r1=sz*0.35; float r2=sz;
  if (dist>r2) return vec3(0.0);
  float mask = smoothstep(r1,r1+4.0,dist)*smoothstep(r2,r2-4.0,dist);
  float spots = sin(diff.x*0.15+sin(diff.y*0.12+time*0.3)*3.0)*sin(diff.y*0.15+sin(diff.x*0.12-time*0.2)*3.0);
  float edgeGlow = smoothstep(r2-6.0,r2,dist)*smoothstep(r2+1.0,r2,dist);
  return color*(mask*smoothstep(0.0,0.5,spots)*0.5+edgeGlow*0.7)*opacity;
} else if (markType < 1.5) {
  // ORBIT: mycelium arc
  float r = sz*2.0;
  float angle = atan(diff.y, diff.x);
  float arc = smoothstep(2.0,0.0,abs(dist-r*0.7));
  float seg = step(0.0,sin(angle*3.0+phase));
  return color * arc * seg * 0.4 * opacity;
} else if (markType < 2.5) {
  // CLUSTER: spore cloud
  float r = sz;
  if (dist>r) return vec3(0.0);
  float n = fract(sin(dot(floor(diff/8.0),vec2(127.1,311.7))+phase)*43758.5);
  return color * smoothstep(0.8,1.0,n) * smoothstep(r,r*0.2,dist) * 0.6 * opacity;
} else if (markType < 3.5) {
  // WAVE: growth front
  float r = sz*1.5;
  if (dist>r) return vec3(0.0);
  float front = fract(time*0.2+phase)*r;
  return color * (smoothstep(5.0,0.0,abs(dist-front))*0.6 + smoothstep(front,front-20.0,dist)*0.08) * opacity;
} else {
  // SHAPE: network node with ports
  float r = sz;
  if (dist>r) return vec3(0.0);
  float node = smoothstep(r*0.3,0.0,dist)*0.6;
  float ring = smoothstep(2.0,0.0,abs(dist-r*0.7))*0.3;
  float angle = atan(diff.y, diff.x);
  float ports = step(0.95,cos(angle*4.0))*smoothstep(r*0.3,r*0.8,dist)*smoothstep(r,r*0.8,dist);
  return color * (node+ring+ports*0.5) * opacity;
}`,

  void: `// VOID: minimal glitch
if (markType < 0.5) {
  // PARTICLE: glitch cross
  float w=sz*0.2; float l=sz;
  float bar1=step(abs(diff.x),w)*step(abs(diff.y),l);
  float bar2=step(abs(diff.y),w)*step(abs(diff.x),l);
  float cross=max(bar1,bar2);
  if (cross<0.5&&dist>l) return vec3(0.0);
  float glitch=step(0.85,fract(sin(floor(diff.y*0.08)*127.1+floor(time*6.0)*43.7)*43758.5));
  float scan=sin(diff.y*0.3-time*5.0)*0.5+0.5;
  return mix(color,color*1.5,scan*cross) * cross * 0.7 * opacity;
} else if (markType < 1.5) {
  // ORBIT: horizontal scan line
  float s=sz*2.0;
  if (abs(diff.x)>s) return vec3(0.0);
  float scanY = mod(time*40.0+phase*100.0,s*2.0)-s;
  return color * smoothstep(2.0,0.0,abs(diff.y-scanY)) * smoothstep(s,0.0,abs(diff.x)) * 0.6 * opacity;
} else if (markType < 2.5) {
  // CLUSTER: pixel noise
  float s=sz;
  if (abs(diff.x)>s||abs(diff.y)>s) return vec3(0.0);
  float n=fract(sin(dot(floor(diff/6.0),vec2(127.1,311.7))+floor(time*4.0))*43758.5);
  return color * step(0.75,n) * 0.4 * opacity;
} else if (markType < 3.5) {
  // WAVE: falling data stream
  float s=sz;
  if (abs(diff.x)>s*0.3) return vec3(0.0);
  float fall=mod(diff.y+time*60.0+phase*200.0,s*2.0)/(s*2.0);
  float ch=step(0.7,fract(sin(floor(diff.y/8.0+time*5.0)*127.1)*43758.5));
  return color * ch * (1.0-fall) * 0.5 * opacity;
} else {
  // SHAPE: empty frame with corners
  float s=sz;
  float mx=abs(diff.x); float my=abs(diff.y);
  if (mx>s||my>s) return vec3(0.0);
  float frame=step(s-2.0,max(mx,my));
  float corner=step(s*0.8,mx)*step(s*0.8,my);
  return color * (frame*0.6+corner*0.3) * opacity;
}`,

  prism: `// PRISM: cosmic energy
if (markType < 0.5) {
  // PARTICLE: rotating prismatic diamond
  float s=sz*0.9; float a=time*0.2;
  float rdx=abs(diff.x*cos(a)-diff.y*sin(a));
  float rdy=abs(diff.x*sin(a)+diff.y*cos(a));
  float diamond=rdx+rdy;
  if (diamond>s*1.1) return vec3(0.0);
  float edge=smoothstep(s+1.0,s-2.0,diamond)-smoothstep(s-2.0,s-6.0,diamond);
  float spectrum=atan(diff.y,diff.x)/6.28318+0.5;
  vec3 rainbow=vec3(sin(spectrum*6.28)*0.5+0.5,sin(spectrum*6.28+2.094)*0.5+0.5,sin(spectrum*6.28+4.189)*0.5+0.5);
  return mix(color,rainbow,0.5) * (edge*0.9+(1.0-smoothstep(s-1.0,s+1.0,diamond))*0.08) * opacity;
} else if (markType < 1.5) {
  // ORBIT: rainbow arc
  float r=sz*1.5;
  if (dist>r) return vec3(0.0);
  float angle=atan(diff.y,diff.x);
  float arc=smoothstep(3.0,0.0,abs(dist-r*0.7));
  float spectrum=mod(angle/6.28+time*0.1,1.0);
  vec3 rainbow=vec3(sin(spectrum*6.28)*0.5+0.5,sin(spectrum*6.28+2.094)*0.5+0.5,sin(spectrum*6.28+4.189)*0.5+0.5);
  return rainbow * arc * smoothstep(0.0,3.14,mod(angle+time*0.5,6.28)) * 0.5 * opacity;
} else if (markType < 2.5) {
  // CLUSTER: twinkling stardust
  float r=sz;
  if (dist>r) return vec3(0.0);
  float tw=fract(sin(dot(diff,vec2(12.9898,78.233))+time*0.5)*43758.5);
  float star=step(0.93,tw);
  return (vec3(tw,1.0-tw*0.5,1.0)*star*0.7 + color*exp(-dist*dist/(r*r*0.2))*0.1) * opacity;
} else if (markType < 3.5) {
  // WAVE: visible spectrum band
  float s=sz;
  if (abs(diff.x)>s||abs(diff.y)>s*0.3) return vec3(0.0);
  float t=(diff.x+s)/(s*2.0);
  vec3 spectrum=vec3(sin(t*6.28)*0.5+0.5,sin(t*6.28+2.094)*0.5+0.5,sin(t*6.28+4.189)*0.5+0.5);
  return spectrum * (sin(diff.x*0.1+time*2.0)*0.3+0.7) * 0.5 * opacity;
} else {
  // SHAPE: faceted crystal gem
  float r=sz;
  if (dist>r) return vec3(0.0);
  float angle=atan(diff.y,diff.x);
  float shell=smoothstep(r,r-3.0,dist);
  float facets=abs(sin(dist*0.1+angle*2.0+time*0.5))*shell*0.3;
  return color*(shell*0.1+facets+smoothstep(r-3.0,r,dist)*0.5)*opacity;
}`,

  nova: `// NOVA: plasma hexagon energy
if (markType < 0.5) {
  // PARTICLE: hexagon with swirling plasma
  float angle=atan(diff.y,diff.x);
  float r=sz; float sides=6.0; float sector=6.28318/sides;
  float hexDist=cos(mod(angle+sector*0.5,sector)-sector*0.5)*dist;
  if (hexDist>r*1.05) return vec3(0.0);
  float inHex=1.0-smoothstep(r-1.0,r+1.0,hexDist);
  float edge=smoothstep(r+1.0,r-2.0,hexDist)-smoothstep(r-2.0,r-5.0,hexDist);
  float plasma=sin(diff.x*0.08+time*2.0)+sin(diff.y*0.08-time*1.7)+sin((diff.x+diff.y)*0.06+time*1.3);
  plasma=(plasma+3.0)/6.0;
  vec3 plasmaCol=mix(vec3(0.0,0.8,1.0),vec3(1.0,0.0,0.67),plasma);
  return (edge*color*0.9+inHex*plasmaCol*plasma*0.3+vec3(1.0)*smoothstep(r*0.3,0.0,dist)*0.4)*opacity;
} else if (markType < 1.5) {
  // ORBIT: energy ring pulse
  float r=sz*1.5;
  if (dist>r) return vec3(0.0);
  float pulse=fract(time*0.5+phase);
  float ring=smoothstep(3.0,0.0,abs(dist-pulse*r))*(1.0-pulse);
  vec3 col=mix(vec3(0.0,0.8,1.0),vec3(1.0,0.0,0.67),pulse);
  return col * ring * 0.6 * opacity;
} else if (markType < 2.5) {
  // CLUSTER: floating hex fragments
  float r=sz;
  if (dist>r) return vec3(0.0);
  float angle=atan(diff.y,diff.x);
  float hex=cos(mod(angle,1.047)-0.524)*dist;
  float fragment=smoothstep(r*0.8,r*0.7,hex)*smoothstep(r*0.3,r*0.5,hex);
  return color * fragment * 0.5 * opacity;
} else if (markType < 3.5) {
  // WAVE: dual-color energy wave
  float s=sz;
  if (abs(diff.x)>s) return vec3(0.0);
  float w1=sin(diff.x*0.12+time*2.5)*s*0.3;
  float w2=sin(diff.x*0.12-time*2.0+1.5)*s*0.3;
  float l1=smoothstep(3.0,0.0,abs(diff.y-w1));
  float l2=smoothstep(3.0,0.0,abs(diff.y-w2));
  return (vec3(0.0,0.8,1.0)*l1*0.5+vec3(1.0,0.0,0.67)*l2*0.5)*opacity;
} else {
  // SHAPE: energy core (bright center, hex outline)
  float r=sz;
  float angle=atan(diff.y,diff.x);
  float hexDist=cos(mod(angle+0.524,1.047)-0.524)*dist;
  if (hexDist>r) return vec3(0.0);
  float shell=smoothstep(r,r-3.0,hexDist)-smoothstep(r-3.0,r-8.0,hexDist);
  float core=smoothstep(r*0.3,0.0,dist);
  return (color*shell*0.7+vec3(1.0)*core*0.4)*opacity;
}`
};

async function main() {
  for (const [id, code] of Object.entries(SHADERS)) {
    const res = await fetch(`${API}/api/agent/${id}/shader`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shaderCode: code }),
    });
    const j = await res.json();
    console.log(`${id}: ${j.ok ? 'OK' : 'FAIL'} (${code.length} chars)`);
  }
}
main();
