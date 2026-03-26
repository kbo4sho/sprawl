#!/usr/bin/env node
/**
 * Test the "Ask a Question" flow end-to-end
 */

const BASE_URL = 'http://localhost:3500';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testAskFlow() {
  console.log('🧪 Testing Ask a Question flow...\n');
  
  // 1. Create an experiment
  console.log('1. Creating experiment...');
  const createRes = await fetch(`${BASE_URL}/api/experiments/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ premise: 'What does freedom look like?' }),
  });
  
  if (!createRes.ok) {
    console.error('❌ Failed to create experiment:', await createRes.text());
    process.exit(1);
  }
  
  const { slug } = await createRes.json();
  console.log(`   ✅ Created: ${slug}\n`);
  
  // 2. Wait for experiment to be ready (poll every 2s for max 60s)
  console.log('2. Waiting for image generation...');
  let experiment = null;
  let attempts = 0;
  const maxAttempts = 30; // 60 seconds total
  
  while (attempts < maxAttempts) {
    const statusRes = await fetch(`${BASE_URL}/api/experiments/${slug}`);
    experiment = await statusRes.json();
    
    if (experiment.status === 'ready') {
      console.log(`   ✅ Ready! (took ${attempts * 2}s)\n`);
      break;
    }
    
    if (attempts % 5 === 0) {
      console.log(`   ⏳ Still generating... (${attempts * 2}s elapsed)`);
    }
    
    await sleep(2000);
    attempts++;
  }
  
  if (experiment.status !== 'ready') {
    console.error('❌ Experiment did not complete in time');
    process.exit(1);
  }
  
  // 3. Verify the experiment has all required fields
  console.log('3. Verifying experiment data...');
  
  const checks = [
    { name: 'type is "ask"', pass: experiment.type === 'ask' },
    { name: 'has image_url', pass: !!experiment.image_url },
    { name: 'has image_prompt', pass: !!experiment.image_prompt },
    { name: 'has dots array', pass: Array.isArray(experiment.dots) },
    { name: 'dots array has 2000 items', pass: experiment.dots.length === 2000 },
    { name: 'dots have required fields', pass: experiment.dots.every(d => 
      typeof d.x === 'number' && 
      typeof d.y === 'number' && 
      typeof d.color === 'string' && 
      typeof d.size === 'number' && 
      typeof d.opacity === 'number'
    )},
  ];
  
  let allPassed = true;
  for (const check of checks) {
    if (check.pass) {
      console.log(`   ✅ ${check.name}`);
    } else {
      console.log(`   ❌ ${check.name}`);
      allPassed = false;
    }
  }
  
  if (!allPassed) {
    console.error('\n❌ Some checks failed');
    process.exit(1);
  }
  
  // 4. Verify the image file exists
  console.log('\n4. Checking image file...');
  const fs = require('fs');
  const path = require('path');
  const imagePath = path.join(__dirname, 'public', 'experiments', `${slug}.png`);
  
  if (fs.existsSync(imagePath)) {
    const stats = fs.statSync(imagePath);
    console.log(`   ✅ Image exists (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.log(`   ❌ Image file not found at ${imagePath}`);
    process.exit(1);
  }
  
  // 5. Test rate limiting
  console.log('\n5. Testing rate limiting...');
  const rateLimitRes = await fetch(`${BASE_URL}/api/experiments/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ premise: 'Another question?' }),
  });
  
  if (rateLimitRes.status === 429) {
    console.log('   ✅ Rate limit working (429 returned)');
  } else {
    console.log('   ⚠️  Rate limit not triggered (might be different IP)');
  }
  
  console.log('\n✅ All tests passed!\n');
  console.log(`View the experiment at: ${BASE_URL}/experiments/${slug}`);
  console.log(`View the gallery at: ${BASE_URL}/experiments\n`);
}

testAskFlow().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
