/**
 * lib/stipple.js — Voronoi stippling for converting images to weighted dots
 * 
 * Extracted from curator-stream-transition.js
 */

const { createCanvas, loadImage } = require('canvas');

const SPRAWL_RANGE = 400;

/**
 * Build a density map from image data (brightness → density)
 */
function buildDensityMap(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const map = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Luminance formula: darker areas = higher density
      row.push(1.0 - (0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]) / 255);
    }
    map.push(row);
  }
  return map;
}

/**
 * Place initial dots weighted by density map
 */
function placeInitialDots(densityMap, w, h, count) {
  const dots = [];
  let attempts = 0;
  while (dots.length < count && attempts < count * 100) {
    attempts++;
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    if (Math.random() < densityMap[y][x]) dots.push({ x, y });
  }
  // Fill remaining with random positions if needed
  while (dots.length < count) {
    dots.push({ x: Math.random() * w, y: Math.random() * h });
  }
  return dots;
}

/**
 * Lloyd's relaxation: iteratively move dots to centroids of their Voronoi cells
 * Downsampled for performance
 */
function lloydsRelaxation(dots, densityMap, w, h, iters = 15) {
  const DS = 4; // Downsample factor
  const dsW = Math.floor(w / DS), dsH = Math.floor(h / DS);
  
  // Downsample density map
  const dsDensity = [];
  for (let y = 0; y < dsH; y++) {
    const row = [];
    for (let x = 0; x < dsW; x++) {
      row.push(densityMap[y * DS]?.[x * DS] || 0);
    }
    dsDensity.push(row);
  }
  
  // Downsample dots
  let dsDots = dots.map(d => ({ x: d.x / DS, y: d.y / DS }));
  
  // Iterative relaxation
  for (let iter = 0; iter < iters; iter++) {
    const regions = dsDots.map(() => ({ sumX: 0, sumY: 0, sumW: 0 }));
    
    // Assign each pixel to nearest dot, accumulate weighted centroids
    for (let y = 0; y < dsH; y++) {
      for (let x = 0; x < dsW; x++) {
        let minDist = Infinity, nearest = 0;
        for (let i = 0; i < dsDots.length; i++) {
          const dx = x - dsDots[i].x, dy = y - dsDots[i].y;
          const dist = dx * dx + dy * dy;
          if (dist < minDist) { minDist = dist; nearest = i; }
        }
        const wt = dsDensity[y][x];
        regions[nearest].sumX += x * wt;
        regions[nearest].sumY += y * wt;
        regions[nearest].sumW += wt;
      }
    }
    
    // Move dots to weighted centroids
    for (let i = 0; i < dsDots.length; i++) {
      const r = regions[i];
      if (r.sumW > 0) {
        dsDots[i].x = r.sumX / r.sumW;
        dsDots[i].y = r.sumY / r.sumW;
      }
    }
  }
  
  // Upscale back to original resolution
  for (let i = 0; i < dots.length; i++) {
    dots[i].x = Math.max(0, Math.min(w - 1, dsDots[i].x * DS));
    dots[i].y = Math.max(0, Math.min(h - 1, dsDots[i].y * DS));
  }
  
  return dots;
}

/**
 * Sample color from image at each dot position
 */
function colorDots(dots, ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  for (const dot of dots) {
    const x = Math.round(Math.max(0, Math.min(w - 1, dot.x)));
    const y = Math.round(Math.max(0, Math.min(h - 1, dot.y)));
    const i = (y * w + x) * 4;
    dot.r = d[i];
    dot.g = d[i+1];
    dot.b = d[i+2];
    dot.color = '#' + ((1 << 24) + (dot.r << 16) + (dot.g << 8) + dot.b).toString(16).slice(1);
  }
  return dots;
}

/**
 * Process an image into stippled dots
 * @param {string} imagePath - Path to image file
 * @param {number} dotCount - Number of dots to generate
 * @returns {Array} Array of dots with {x, y, color, size, opacity} in Sprawl coordinates
 */
async function processReference(imagePath, dotCount) {
  const img = await loadImage(imagePath);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  
  // Build density map
  const dm = buildDensityMap(ctx, img.width, img.height);
  
  // Place dots
  let dots = placeInitialDots(dm, img.width, img.height, dotCount);
  
  // Lloyd's relaxation
  dots = lloydsRelaxation(dots, dm, img.width, img.height, 15);
  
  // Color dots
  dots = colorDots(dots, ctx, img.width, img.height);
  
  // Convert to Sprawl coordinates and add display properties
  for (const d of dots) {
    // Map from image space (0..width, 0..height) to Sprawl space (-400..400, -400..400)
    d.sprawlX = (d.x / img.width) * (SPRAWL_RANGE * 2) - SPRAWL_RANGE;
    d.sprawlY = (d.y / img.height) * (SPRAWL_RANGE * 2) - SPRAWL_RANGE;
    
    // Size and opacity based on luminance
    const lum = (0.299 * d.r + 0.587 * d.g + 0.114 * d.b) / 255;
    d.targetSize = Math.round((2 + lum * 1.5) * 10) / 10;
    d.targetOpacity = Math.round((0.4 + lum * 0.4) * 100) / 100;
  }
  
  return dots;
}

module.exports = {
  buildDensityMap,
  placeInitialDots,
  lloydsRelaxation,
  colorDots,
  processReference,
};
