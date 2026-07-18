const HEADER_SIZE = 16;
const RECORD_SIZE = 56;
const EXPECTED_POINTS = 20_000;
const REVIEW_TRANSITION_MS = 18_000;
const REVIEW_STILL_MS = 4_000;
const REVIEW_REWIND_MS = 6_000;

const canvas = document.querySelector('#painting');
const epochLabel = document.querySelector('#epoch-label');
const note = document.querySelector('#note');
const phaseLabel = document.querySelector('#phase');
const replayButton = document.querySelector('#replay');
const errorLabel = document.querySelector('#error');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const query = new URLSearchParams(location.search);
const reviewSetting = query.get('review');
const sequenceMode = reviewSetting === 'sequence';
const reviewMode = reviewSetting === '1' || sequenceMode;

const vertexSource = `#version 300 es
precision highp float;

in vec2 a_start;
in vec2 a_target;
in vec2 a_control1;
in vec2 a_control2;
in vec4 a_startColor;
in vec4 a_targetColor;
in vec4 a_memoryColor;
in float a_size;
in float a_delay;
in float a_duration;
in float a_decay;

uniform float u_progress;
uniform float u_aspect;
uniform float u_pixelRatio;
uniform vec2 u_pointer;
uniform float u_pointerStrength;

out vec4 v_color;

float ease(float value) {
  return value * value * (3.0 - 2.0 * value);
}

vec2 cubic(vec2 a, vec2 b, vec2 c, vec2 d, float t) {
  float inverse = 1.0 - t;
  return inverse * inverse * inverse * a
    + 3.0 * inverse * inverse * t * b
    + 3.0 * inverse * t * t * c
    + t * t * t * d;
}

void main() {
  float timelineSpan = max(a_duration * (1.0 - a_delay), 0.001);
  float localProgress = clamp((u_progress - a_delay) / timelineSpan, 0.0, 1.0);
  float curvedProgress = ease(localProgress);
  vec2 position = cubic(a_start, a_control1, a_control2, a_target, curvedProgress);

  vec2 away = position - u_pointer;
  float distanceFromPointer = length(away);
  float disturbance = smoothstep(0.24, 0.0, distanceFromPointer) * u_pointerStrength;
  position += normalize(away + vec2(0.0001)) * disturbance * 0.055;

  vec2 fitted = position;
  if (u_aspect > 1.0) fitted.x /= u_aspect;
  else fitted.y *= u_aspect;

  vec4 baseColor = mix(a_startColor, a_targetColor, curvedProgress);
  float memoryPresence = (1.0 - curvedProgress) * (1.0 - a_decay) * 0.45;
  v_color = mix(baseColor, a_memoryColor, memoryPresence);

  gl_Position = vec4(fitted, 0.0, 1.0);
  gl_PointSize = max(1.0, a_size * u_pixelRatio);
}`;

const fragmentSource = `#version 300 es
precision highp float;

in vec4 v_color;
out vec4 outputColor;

void main() {
  vec2 centered = gl_PointCoord - vec2(0.5);
  float radius = length(centered);
  float alpha = 1.0 - smoothstep(0.34, 0.5, radius);
  if (alpha <= 0.0) discard;
  outputColor = vec4(v_color.rgb, v_color.a * alpha);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed');
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
  }
  return program;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.json();
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function parsePointBundle(buffer, expectedEpoch) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  const version = view.getUint16(4, true);
  const recordSize = view.getUint16(6, true);
  const pointCount = view.getUint32(8, true);
  const epoch = view.getUint32(12, true);

  if (magic !== 'SPRL') throw new Error('Invalid point bundle magic');
  if (version !== 1) throw new Error(`Unsupported point bundle version ${version}`);
  if (recordSize !== RECORD_SIZE) throw new Error(`Unexpected point record size ${recordSize}`);
  if (pointCount !== EXPECTED_POINTS) throw new Error(`Expected ${EXPECTED_POINTS} points, received ${pointCount}`);
  if (epoch !== expectedEpoch) throw new Error(`Point bundle epoch ${epoch} does not match metadata ${expectedEpoch}`);
  if (buffer.byteLength !== HEADER_SIZE + pointCount * recordSize) throw new Error('Point bundle byte length is invalid');

  const start = new Float32Array(pointCount * 2);
  const target = new Float32Array(pointCount * 2);
  const control1 = new Float32Array(pointCount * 2);
  const control2 = new Float32Array(pointCount * 2);
  const startColor = new Uint8Array(pointCount * 4);
  const targetColor = new Uint8Array(pointCount * 4);
  const memoryColor = new Uint8Array(pointCount * 4);
  const size = new Float32Array(pointCount);
  const delay = new Float32Array(pointCount);
  const duration = new Float32Array(pointCount);
  const decay = new Float32Array(pointCount);

  for (let index = 0; index < pointCount; index += 1) {
    const source = HEADER_SIZE + index * recordSize;
    const vector = index * 2;
    const rgba = index * 4;

    start[vector] = view.getFloat32(source, true);
    start[vector + 1] = view.getFloat32(source + 4, true);
    target[vector] = view.getFloat32(source + 8, true);
    target[vector + 1] = view.getFloat32(source + 12, true);
    control1[vector] = view.getFloat32(source + 16, true);
    control1[vector + 1] = view.getFloat32(source + 20, true);
    control2[vector] = view.getFloat32(source + 24, true);
    control2[vector + 1] = view.getFloat32(source + 28, true);

    for (let channel = 0; channel < 4; channel += 1) {
      startColor[rgba + channel] = view.getUint8(source + 32 + channel);
      targetColor[rgba + channel] = view.getUint8(source + 36 + channel);
      memoryColor[rgba + channel] = view.getUint8(source + 40 + channel);
    }

    size[index] = view.getFloat32(source + 44, true);
    delay[index] = view.getUint16(source + 48, true) / 65_535;
    duration[index] = view.getUint16(source + 50, true) / 65_535;
    decay[index] = view.getUint16(source + 52, true) / 65_535;
  }

  return { pointCount, start, target, control1, control2, startColor, targetColor, memoryColor, size, delay, duration, decay };
}

function createAttributeUploader(gl, program, name, size, type = gl.FLOAT, normalized = false) {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error(`Shader attribute ${name} is unavailable`);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
  return data => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  };
}

async function loadPreparedEpoch(entry, isReview) {
  if (!entry?.metadataUrl || !entry?.pointsSha256) throw new Error('Epoch manifest entry is incomplete');
  const metadata = await fetchJson(`./data/${entry.metadataUrl}`);
  if (metadata.epoch !== entry.epoch) throw new Error(`Epoch ${entry.epoch} points to metadata for epoch ${metadata.epoch}`);
  const pointsUrl = `./data/${entry.metadataUrl.replace(/epoch\.json$/, metadata.points.url)}`;
  const requestUrl = isReview ? `${pointsUrl}?sha256=${metadata.points.sha256}` : pointsUrl;
  const response = await fetch(requestUrl, { cache: isReview ? 'no-store' : 'force-cache' });
  if (!response.ok) throw new Error(`Could not load point bundle: ${response.status}`);
  const pointBytes = await response.arrayBuffer();
  const pointChecksum = await sha256(pointBytes);
  if (pointChecksum !== metadata.points.sha256 || pointChecksum !== entry.pointsSha256) {
    throw new Error(`Epoch ${metadata.epoch} checksum does not match its manifest`);
  }
  return { metadata, bundle: parsePointBundle(pointBytes, metadata.epoch) };
}

function phaseFor(metadata, forcedProgress) {
  if (forcedProgress !== null) return { name: 'Proof replay', progress: forcedProgress };
  if (reducedMotion) return { name: 'Reduced motion · complete', progress: 1 };

  const elapsed = Date.now() - Date.parse(metadata.startsAt);
  if (elapsed <= 0) return { name: 'Waiting', progress: 0 };
  if (elapsed < metadata.transformDurationMs) return { name: 'Transforming', progress: elapsed / metadata.transformDurationMs };
  if (elapsed < metadata.transformDurationMs + metadata.settleDurationMs) return { name: 'Settling', progress: 1 };
  return { name: 'Still', progress: 1 };
}

async function start() {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('This proof requires WebGL 2');

  const manifestUrl = sequenceMode
    ? './data/review-sequence.json'
    : reviewMode ? './data/review.json' : './data/live.json';
  const manifest = await fetchJson(manifestUrl);
  const entries = sequenceMode ? manifest.epochs : [manifest.current];
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Review sequence contains no epochs');
  const preparedEpochs = await Promise.all(entries.map(entry => loadPreparedEpoch(entry, reviewMode)));

  const program = createProgram(gl);
  gl.useProgram(program);
  const uploaders = {
    start: createAttributeUploader(gl, program, 'a_start', 2),
    target: createAttributeUploader(gl, program, 'a_target', 2),
    control1: createAttributeUploader(gl, program, 'a_control1', 2),
    control2: createAttributeUploader(gl, program, 'a_control2', 2),
    startColor: createAttributeUploader(gl, program, 'a_startColor', 4, gl.UNSIGNED_BYTE, true),
    targetColor: createAttributeUploader(gl, program, 'a_targetColor', 4, gl.UNSIGNED_BYTE, true),
    memoryColor: createAttributeUploader(gl, program, 'a_memoryColor', 4, gl.UNSIGNED_BYTE, true),
    size: createAttributeUploader(gl, program, 'a_size', 1),
    delay: createAttributeUploader(gl, program, 'a_delay', 1),
    duration: createAttributeUploader(gl, program, 'a_duration', 1),
    decay: createAttributeUploader(gl, program, 'a_decay', 1)
  };

  const uniforms = {
    progress: gl.getUniformLocation(program, 'u_progress'),
    aspect: gl.getUniformLocation(program, 'u_aspect'),
    pixelRatio: gl.getUniformLocation(program, 'u_pixelRatio'),
    pointer: gl.getUniformLocation(program, 'u_pointer'),
    pointerStrength: gl.getUniformLocation(program, 'u_pointerStrength')
  };

  let activeEpochIndex = -1;
  let metadata;
  let bundle;
  function activateEpoch(index) {
    if (index === activeEpochIndex) return;
    const prepared = preparedEpochs[index];
    metadata = prepared.metadata;
    bundle = prepared.bundle;
    for (const [name, upload] of Object.entries(uploaders)) upload(bundle[name]);
    activeEpochIndex = index;
    epochLabel.textContent = `ERA II · EPOCH ${String(metadata.epoch).padStart(3, '0')}`;
    note.textContent = metadata.public.note || (manifest.status === 'holding' ? manifest.message : '');
  }

  const forwardSegments = preparedEpochs.map((_, epochIndex) => ({
    epochIndex,
    direction: 'forward',
    transitionMs: REVIEW_TRANSITION_MS,
    stillMs: REVIEW_STILL_MS
  }));
  const rewindSegments = preparedEpochs.map((_, epochIndex) => ({
    epochIndex,
    direction: 'rewind',
    transitionMs: REVIEW_REWIND_MS,
    stillMs: 0
  })).reverse();
  const sequenceSegments = sequenceMode ? [...forwardSegments, ...rewindSegments] : [];
  const sequenceDuration = sequenceSegments.reduce(
    (total, segment) => total + segment.transitionMs + segment.stillMs,
    0
  );

  let pointer = [10, 10];
  let pointerStrength = 0;
  let replayStarted = query.get('demo') === '1' || reviewMode ? performance.now() : null;

  function resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(innerWidth * pixelRatio));
    const height = Math.max(1, Math.round(innerHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
  }

  function modelPointer(event) {
    const aspect = canvas.width / canvas.height;
    let x = event.clientX / innerWidth * 2 - 1;
    let y = 1 - event.clientY / innerHeight * 2;
    if (aspect > 1) x *= aspect;
    else y /= aspect;
    return [x, y];
  }

  canvas.addEventListener('pointermove', event => {
    pointer = modelPointer(event);
    pointerStrength = 1;
  });
  canvas.addEventListener('pointerleave', () => { pointerStrength = 0; });
  replayButton.addEventListener('click', () => {
    replayStarted = performance.now();
    if (sequenceMode) activateEpoch(0);
  });
  addEventListener('resize', resize);

  replayButton.textContent = sequenceMode ? 'Replay sequence' : 'Replay proof';
  activateEpoch(0);
  resize();

  function frame(now) {
    let phase;
    if (sequenceMode) {
      let sequenceElapsed = (now - replayStarted) % sequenceDuration;
      let segment = sequenceSegments[0];
      for (const candidate of sequenceSegments) {
        const duration = candidate.transitionMs + candidate.stillMs;
        if (sequenceElapsed < duration) {
          segment = candidate;
          break;
        }
        sequenceElapsed -= duration;
      }
      activateEpoch(segment.epochIndex);
      const transitionProgress = Math.min(1, sequenceElapsed / segment.transitionMs);
      const progress = segment.direction === 'forward'
        ? transitionProgress
        : 1 - transitionProgress;
      const name = segment.direction === 'rewind'
        ? 'Review rewind'
        : transitionProgress < 1 ? 'Transforming' : 'Still';
      phase = {
        name: `${name} · ${segment.epochIndex + 1}/${preparedEpochs.length}`,
        progress
      };
    } else {
      let forcedProgress = null;
      if (replayStarted !== null) {
        const elapsed = now - replayStarted;
        forcedProgress = Math.min(1, elapsed / REVIEW_TRANSITION_MS);
        if (elapsed > 24_000) replayStarted = now;
      }
      phase = phaseFor(metadata, forcedProgress);
    }

    const aspect = canvas.width / canvas.height;
    pointerStrength *= 0.94;

    gl.clearColor(0.012, 0.012, 0.024, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(uniforms.progress, phase.progress);
    gl.uniform1f(uniforms.aspect, aspect);
    gl.uniform1f(uniforms.pixelRatio, Math.min(devicePixelRatio || 1, 2));
    gl.uniform2f(uniforms.pointer, pointer[0], pointer[1]);
    gl.uniform1f(uniforms.pointerStrength, pointerStrength);
    gl.drawArrays(gl.POINTS, 0, bundle.pointCount);

    phaseLabel.textContent = `${phase.name} · ${Math.round(phase.progress * 100)}% · ${bundle.pointCount.toLocaleString()} persistent points`;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

start().catch(error => {
  console.error(error);
  errorLabel.hidden = false;
  errorLabel.textContent = error.message;
  note.textContent = 'The painting could not be loaded.';
});
