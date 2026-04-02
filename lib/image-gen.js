/**
 * lib/image-gen.js — Image generation (SDXL local or OpenAI fallback)
 * 
 * Extracted from curator-stream-transition.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Generate image using SDXL Turbo (local Python venv)
 * @param {string} prompt - Image prompt
 * @param {string} outputPath - Where to save the image
 * @returns {boolean} Success
 */
function generateWithSDXL(prompt, outputPath) {
  const venvPython = path.join(__dirname, '..', 'sdxl-env', 'bin', 'python3');
  const script = path.join(__dirname, '..', 'generate-reference.py');
  
  if (!fs.existsSync(venvPython)) {
    return false;
  }
  
  try {
    execSync(
      `${venvPython} ${script} --prompt "${prompt.replace(/"/g, '\\"')}" --output "${outputPath}" --steps 4 --size 1024`,
      { timeout: 120000, stdio: 'pipe' }
    );
    return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000;
  } catch {
    return false;
  }
}

/**
 * Generate image using OpenAI DALL-E 3
 * @param {string} prompt - Image prompt
 * @param {string} outputPath - Where to save the image
 * @returns {Promise<boolean>} Success
 */
async function generateWithOpenAI(prompt, outputPath) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }
  
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
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000;
}

/**
 * Generate image (tries SDXL first, falls back to OpenAI)
 * @param {string} prompt - Image prompt
 * @param {string} outputPath - Where to save the image
 * @returns {Promise<boolean>} Success
 */
async function generateImage(prompt, outputPath) {
  // Try SDXL first (local only — venv won't exist on Railway)
  try {
    const sdxlSuccess = generateWithSDXL(prompt, outputPath);
    if (sdxlSuccess) {
      console.log('[image-gen] Generated via SDXL');
      return true;
    }
    console.log('[image-gen] SDXL unavailable, falling back to OpenAI');
  } catch (err) {
    console.warn('[image-gen] SDXL error, falling back to OpenAI:', err.message);
  }

  // Fall back to OpenAI
  if (!OPENAI_API_KEY) {
    throw new Error('SDXL unavailable and OPENAI_API_KEY not set — cannot generate image');
  }
  const success = await generateWithOpenAI(prompt, outputPath);
  if (success) {
    console.log('[image-gen] Generated via OpenAI DALL-E 3');
  }
  return success;
}

module.exports = {
  generateWithSDXL,
  generateWithOpenAI,
  generateImage,
};
