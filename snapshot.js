/**
 * Snapshot Module — Generate static PNG images of frozen canvases
 * Server-side rendering using node-canvas
 */

let createCanvas;
try {
  createCanvas = require('canvas').createCanvas;
} catch (e) {
  // canvas package not available (missing native deps) — snapshots disabled
  createCanvas = null;
}
const fs = require('fs');
const path = require('path');

const CANVAS_SIZE = 1200;
const BG_COLOR = '#030306';

/**
 * Generate a PNG snapshot of a canvas
 * @param {Object} db - Database instance
 * @param {string} canvasId - Canvas ID
 * @returns {Promise<string>} Path to snapshot file
 */
async function generateSnapshot(db, canvasId) {
  if (!createCanvas) {
    console.warn('Snapshot skipped: canvas package not available');
    return null;
  }
  // Get canvas
  const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
  if (!canvas) {
    throw new Error(`Canvas ${canvasId} not found`);
  }

  // Get all marks for this canvas
  const marks = db.prepare('SELECT * FROM marks WHERE canvas_id = ? ORDER BY created_at').all(canvasId);

  if (marks.length === 0) {
    throw new Error(`Canvas ${canvasId} has no marks to snapshot`);
  }

  // Create canvas
  const nodeCanvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = nodeCanvas.getContext('2d');

  // Fill background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Calculate bounds
  const xs = marks.map(m => m.x);
  const ys = marks.map(m => m.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rangeX = maxX - minX || 400;
  const rangeY = maxY - minY || 400;
  const scale = Math.min((CANVAS_SIZE - 80) / rangeX, (CANVAS_SIZE - 80) / rangeY) * 0.85;

  // Render marks
  for (const m of marks) {
    const px = (m.x - cx) * scale + CANVAS_SIZE / 2;
    const py = (m.y - cy) * scale + CANVAS_SIZE / 2;
    const sz = (m.size || 8) * scale * 0.12;
    const opacity = m.opacity || 0.8;

    if (m.type === 'line') {
      const meta = m.meta ? JSON.parse(m.meta) : {};
      if (meta.x2 != null && meta.y2 != null) {
        const ex = (meta.x2 - cx) * scale + CANVAS_SIZE / 2;
        const ey = (meta.y2 - cy) * scale + CANVAS_SIZE / 2;
        ctx.strokeStyle = m.color;
        ctx.globalAlpha = opacity;
        ctx.lineWidth = Math.max(1, sz * 0.4);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    } else if (m.type === 'text') {
      ctx.font = `${Math.max(8, sz * 1.5)}px "Space Mono", monospace`;
      ctx.fillStyle = m.color;
      ctx.globalAlpha = opacity;
      ctx.textAlign = 'center';
      ctx.fillText((m.text || '').slice(0, 32), px, py);
    } else {
      // Dot with glow effect
      ctx.fillStyle = m.color;
      ctx.globalAlpha = opacity * 0.2;
      ctx.beginPath();
      ctx.arc(px, py, sz * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(px, py, sz * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Ensure snapshots directory exists
  const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
  const snapshotsDir = path.join(DATA_DIR, 'snapshots');
  if (!fs.existsSync(snapshotsDir)) {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  }

  // Save PNG
  const filename = `${canvasId}.png`;
  const filepath = path.join(snapshotsDir, filename);
  const buffer = nodeCanvas.toBuffer('image/png');
  fs.writeFileSync(filepath, buffer);

  console.log(`✓ Snapshot saved: ${filepath}`);

  // Return relative URL path
  return `/snapshots/${filename}`;
}

module.exports = { generateSnapshot };
