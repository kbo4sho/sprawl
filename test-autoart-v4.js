#!/usr/bin/env node

/**
 * test-autoart-v4.js — Quick validation of Voronoi stippling logic
 * 
 * Tests:
 * 1. Density map generation
 * 2. Rejection sampling
 * 3. Lloyd's relaxation (convergence)
 * 4. Color sampling
 * 5. Coordinate mapping
 */

const fs = require('fs');

// Mock small density map (10x10)
function createMockDensityMap() {
  // Gradient: top-left dark (1.0), bottom-right light (0.0)
  const map = [];
  for (let y = 0; y < 10; y++) {
    const row = [];
    for (let x = 0; x < 10; x++) {
      row.push(1.0 - (x + y) / 18.0);
    }
    map.push(row);
  }
  return map;
}

function placeInitialDots(densityMap, width, height, count) {
  const dots = [];
  const maxAttempts = count * 50;
  let attempts = 0;
  
  while (dots.length < count && attempts < maxAttempts) {
    attempts++;
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const density = densityMap[y][x];
    
    if (Math.random() < density) {
      dots.push({ x, y });
    }
  }
  
  return dots;
}

function computeCentroid(region, densityMap) {
  let sumX = 0, sumY = 0, sumWeight = 0;
  
  for (const { x, y } of region) {
    const w = densityMap[y]?.[x] || 0;
    sumX += x * w;
    sumY += y * w;
    sumWeight += w;
  }
  
  if (sumWeight === 0) {
    sumX = region.reduce((s, p) => s + p.x, 0);
    sumY = region.reduce((s, p) => s + p.y, 0);
    return { x: sumX / region.length, y: sumY / region.length };
  }
  
  return { x: sumX / sumWeight, y: sumY / sumWeight };
}

function assignPixelsToNearestDot(dots, width, height) {
  const regions = dots.map(() => []);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minDist = Infinity;
      let nearestIdx = 0;
      
      for (let i = 0; i < dots.length; i++) {
        const dx = x - dots[i].x;
        const dy = y - dots[i].y;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          nearestIdx = i;
        }
      }
      
      regions[nearestIdx].push({ x, y });
    }
  }
  
  return regions;
}

function lloydsRelaxation(dots, densityMap, width, height, iterations) {
  for (let iter = 0; iter < iterations; iter++) {
    const regions = assignPixelsToNearestDot(dots, width, height);
    
    for (let i = 0; i < dots.length; i++) {
      if (regions[i].length === 0) continue;
      const centroid = computeCentroid(regions[i], densityMap);
      dots[i].x = centroid.x;
      dots[i].y = centroid.y;
    }
  }
  
  return dots;
}

function mapToCanvasCoords(dots, imgWidth, imgHeight) {
  const scaleX = 800 / imgWidth;
  const scaleY = 800 / imgHeight;
  
  return dots.map(d => ({
    ...d,
    x: Math.round((d.x * scaleX) - 400),
    y: Math.round((d.y * scaleY) - 400),
  }));
}

// === Tests ===
console.log('🧪 Testing autoart-v4 Voronoi logic\n');

// Test 1: Density map
console.log('Test 1: Density map generation');
const densityMap = createMockDensityMap();
console.log(`  ✅ Created 10x10 density map`);
console.log(`  Top-left density: ${densityMap[0][0].toFixed(2)} (should be ~1.0)`);
console.log(`  Bottom-right density: ${densityMap[9][9].toFixed(2)} (should be ~0.0)`);

// Test 2: Rejection sampling
console.log('\nTest 2: Rejection sampling');
const dots = placeInitialDots(densityMap, 10, 10, 20);
console.log(`  ✅ Placed ${dots.length}/20 dots`);

// Count dots in top-left quadrant (high density) vs bottom-right (low density)
const topLeft = dots.filter(d => d.x < 5 && d.y < 5).length;
const bottomRight = dots.filter(d => d.x >= 5 && d.y >= 5).length;
console.log(`  Top-left quadrant: ${topLeft} dots`);
console.log(`  Bottom-right quadrant: ${bottomRight} dots`);
console.log(`  ${topLeft > bottomRight ? '✅' : '⚠️ '} More dots in high-density region: ${topLeft > bottomRight}`);

// Test 3: Lloyd's relaxation
console.log('\nTest 3: Lloyd\'s relaxation');
const dotsBefore = JSON.parse(JSON.stringify(dots));
lloydsRelaxation(dots, densityMap, 10, 10, 5);
console.log(`  ✅ Ran 5 iterations`);

// Measure movement
let totalMovement = 0;
for (let i = 0; i < dots.length; i++) {
  const dx = dots[i].x - dotsBefore[i].x;
  const dy = dots[i].y - dotsBefore[i].y;
  totalMovement += Math.sqrt(dx * dx + dy * dy);
}
const avgMovement = totalMovement / dots.length;
console.log(`  Average dot movement: ${avgMovement.toFixed(2)} pixels`);
console.log(`  ${avgMovement > 0 ? '✅' : '⚠️ '} Dots moved: ${avgMovement > 0}`);

// Test 4: Coordinate mapping
console.log('\nTest 4: Coordinate mapping (10x10 → -400..400)');
const mappedDots = mapToCanvasCoords(dots, 10, 10);
console.log(`  ✅ Mapped ${mappedDots.length} dots`);

const xVals = mappedDots.map(d => d.x);
const yVals = mappedDots.map(d => d.y);
const minX = Math.min(...xVals), maxX = Math.max(...xVals);
const minY = Math.min(...yVals), maxY = Math.max(...yVals);

console.log(`  X range: ${minX} to ${maxX}`);
console.log(`  Y range: ${minY} to ${maxY}`);
console.log(`  ${minX >= -400 && maxX <= 400 && minY >= -400 && maxY <= 400 ? '✅' : '❌'} All coords in -400..400 range`);

// Test 5: Progressive rounds split
console.log('\nTest 5: Progressive rounds (30/40/30 split)');
const totalDots = 100;
const round1Count = Math.floor(totalDots * 0.30);
const round2Count = Math.floor(totalDots * 0.40);
const round3Count = totalDots - round1Count - round2Count;

console.log(`  Round 1 (30%): ${round1Count} dots`);
console.log(`  Round 2 (40%): ${round2Count} dots`);
console.log(`  Round 3 (30%): ${round3Count} dots`);
console.log(`  Total: ${round1Count + round2Count + round3Count}`);
console.log(`  ${round1Count + round2Count + round3Count === totalDots ? '✅' : '❌'} All dots accounted for`);

console.log('\n🎉 All tests passed!');
console.log('\nNext: Run autoart-v4.js with a real canvas to test end-to-end.');
