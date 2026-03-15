const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Dual-Layer Rendering System for Sprawl Canvas
 * 
 * Renders primitives (dots, lines, text, arcs) to a PNG, then passes to OpenAI
 * image generation to create the final artistic render.
 */

const CANVAS_SIZE = 1024;
const RENDER_DIR = path.join(__dirname, 'public', 'renders');

// Ensure render directory exists
if (!fs.existsSync(RENDER_DIR)) {
  fs.mkdirSync(RENDER_DIR, { recursive: true });
}

/**
 * Rasterize primitives to PNG
 * @param {Array} marks - Array of mark objects from database
 * @returns {Buffer} PNG buffer
 */
function rasterizePrimitives(marks) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext('2d');
  
  // Dark background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  
  // Transform coordinates: canvas center is (0,0), map to (512, 512)
  // Map [-500, 500] to [0, 1024]
  const scale = CANVAS_SIZE / 1000;
  const offsetX = CANVAS_SIZE / 2;
  const offsetY = CANVAS_SIZE / 2;
  
  const toCanvasX = (x) => x * scale + offsetX;
  const toCanvasY = (y) => y * scale + offsetY;
  
  // Draw each mark
  for (const mark of marks) {
    const x = toCanvasX(mark.x);
    const y = toCanvasY(mark.y);
    const size = mark.size * scale;
    const opacity = mark.opacity || 0.8;
    
    ctx.globalAlpha = opacity;
    
    switch (mark.type) {
      case 'dot': {
        ctx.fillStyle = mark.color;
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      
      case 'line': {
        let meta = {};
        try {
          meta = JSON.parse(mark.meta || '{}');
        } catch {}
        
        if (meta.x2 != null && meta.y2 != null) {
          const x2 = toCanvasX(meta.x2);
          const y2 = toCanvasY(meta.y2);
          
          ctx.strokeStyle = mark.color;
          ctx.lineWidth = size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        break;
      }
      
      case 'text': {
        if (mark.text) {
          ctx.fillStyle = mark.color;
          ctx.font = `${size}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(mark.text.slice(0, 32), x, y);
        }
        break;
      }
      
      case 'arc': {
        let meta = {};
        try {
          meta = JSON.parse(mark.meta || '{}');
        } catch {}
        
        const radius = (meta.radius || 30) * scale;
        const startAngle = meta.startAngle || 0;
        const endAngle = meta.endAngle || Math.PI;
        
        ctx.strokeStyle = mark.color;
        ctx.lineWidth = size;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(x, y, radius, startAngle, endAngle);
        ctx.stroke();
        break;
      }
    }
  }
  
  ctx.globalAlpha = 1.0;
  
  return canvas.toBuffer('image/png');
}

/**
 * Describe the primitive composition for the AI prompt
 * @param {Array} marks - Array of mark objects
 * @returns {String} Description of the composition
 */
function describeComposition(marks) {
  if (marks.length === 0) return 'empty canvas';
  
  // Count by type
  const types = {};
  const colors = {};
  let totalSize = 0;
  
  for (const mark of marks) {
    types[mark.type] = (types[mark.type] || 0) + 1;
    colors[mark.color] = (colors[mark.color] || 0) + 1;
    totalSize += mark.size || 10;
  }
  
  const avgSize = totalSize / marks.length;
  
  // Find clusters (simplified: just check if marks are grouped or scattered)
  const positions = marks.map(m => ({ x: m.x, y: m.y }));
  const centerX = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
  const centerY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
  const spread = Math.sqrt(
    positions.reduce((sum, p) => sum + (p.x - centerX) ** 2 + (p.y - centerY) ** 2, 0) / positions.length
  );
  
  const density = spread < 100 ? 'clustered' : spread < 300 ? 'distributed' : 'scattered';
  
  const typeDesc = Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
    .join(', ');
  
  const colorDesc = Object.keys(colors).length > 5 
    ? 'multicolored' 
    : Object.keys(colors).slice(0, 3).join(', ');
  
  return `${density} composition with ${typeDesc}. Colors: ${colorDesc}. Average mark size: ${avgSize.toFixed(1)}.`;
}

/**
 * Generate AI render using OpenAI image generation
 * @param {Buffer} primitivePng - Rasterized primitives
 * @param {Object} canvas - Canvas metadata (theme, subject, stylePrompt)
 * @param {Array} marks - Array of marks for description
 * @returns {Promise<Buffer>} Rendered image buffer
 */
async function generateAIRender(primitivePng, canvas, marks) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }
  
  const composition = describeComposition(marks);
  
  // Build prompt based on canvas metadata
  const prompt = `Create a beautiful ${canvas.style_prompt || 'artistic'} artwork. 
The composition should follow this abstract guide: ${composition}
Subject: ${canvas.subject || 'abstract composition'}
Style: ${canvas.theme || 'creative interpretation'}

The composition is inspired by the primitive marks shown, but you should create a cohesive, polished artwork that captures the essence and arrangement of the primitives while being visually stunning.`;
  
  // Note: According to the design doc, for gpt-image-1 we use prompt-only approach
  // (no image input needed). The primitives INFORM the prompt, not sent as image.
  // This is simpler than image-to-image.
  
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt.slice(0, 4000), // DALL-E has prompt limits
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      response_format: 'url',
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI image generation failed: ${JSON.stringify(error)}`);
  }
  
  const data = await response.json();
  const imageUrl = data.data[0]?.url;
  
  if (!imageUrl) {
    throw new Error('No image URL in OpenAI response');
  }
  
  // Download the image
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download rendered image: ${imageResponse.statusText}`);
  }
  
  const buffer = await imageResponse.arrayBuffer();
  return Buffer.from(buffer);
}

/**
 * Trigger a render pass for a canvas
 * @param {Object} db - Database instance
 * @param {String} canvasId - Canvas ID
 * @param {Function} broadcast - WebSocket broadcast function
 * @returns {Promise<Object>} Render result
 */
async function triggerRender(db, canvasId, broadcast) {
  console.log(`🎨 Starting render for canvas ${canvasId}...`);
  
  // Get canvas metadata
  const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
  if (!canvas) {
    throw new Error('Canvas not found');
  }
  
  // Get all marks for this canvas
  const marks = db.prepare('SELECT * FROM marks WHERE canvas_id = ? ORDER BY created_at').all(canvasId);
  
  if (marks.length === 0) {
    console.log('⚠ No marks to render, skipping');
    return { skipped: true, reason: 'no_marks' };
  }
  
  const contributionCount = canvas.contribution_count || 0;
  
  try {
    // Step 1: Rasterize primitives
    console.log(`  📐 Rasterizing ${marks.length} primitives...`);
    const primitivePng = rasterizePrimitives(marks);
    
    // Step 2: Generate AI render
    console.log(`  🤖 Generating AI render with OpenAI...`);
    const renderBuffer = await generateAIRender(primitivePng, canvas, marks);
    
    // Step 3: Save render to disk
    const canvasRenderDir = path.join(RENDER_DIR, canvasId);
    if (!fs.existsSync(canvasRenderDir)) {
      fs.mkdirSync(canvasRenderDir, { recursive: true });
    }
    
    const filename = `${contributionCount}.png`;
    const filepath = path.join(canvasRenderDir, filename);
    fs.writeFileSync(filepath, renderBuffer);
    
    const renderUrl = `/renders/${canvasId}/${filename}`;
    
    // Step 4: Update canvas record
    db.prepare('UPDATE canvases SET current_render_url = ? WHERE id = ?')
      .run(renderUrl, canvasId);
    
    // Step 5: Record in renders table (create if doesn't exist)
    db.exec(`
      CREATE TABLE IF NOT EXISTS renders (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL,
        contribution_count_at INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
      )
    `);
    
    const renderId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO renders (id, canvas_id, contribution_count_at, image_path, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(renderId, canvasId, contributionCount, renderUrl, Date.now());
    
    // Step 6: Broadcast to WebSocket clients
    if (broadcast) {
      broadcast({
        type: 'render_complete',
        canvasId,
        contributionCount,
        renderUrl,
      });
    }
    
    console.log(`✅ Render complete: ${renderUrl}`);
    
    return {
      success: true,
      renderUrl,
      contributionCount,
      markCount: marks.length,
    };
    
  } catch (error) {
    console.error(`❌ Render failed:`, error.message);
    throw error;
  }
}

module.exports = {
  triggerRender,
  rasterizePrimitives,
  generateAIRender,
  describeComposition,
};
