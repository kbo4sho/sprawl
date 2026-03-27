#!/usr/bin/env node
/**
 * push-experiment.js — Generate locally, push to Railway
 * Usage: node scripts/push-experiment.js "what does loneliness look like?"
 *        npm run push-experiment "what does loneliness look like?"
 */

const LOCAL = 'http://localhost:3500';
const REMOTE = 'https://sprawl.place';

async function main() {
  const premise = process.argv.slice(2).join(' ').trim();
  if (!premise) {
    console.error('Usage: npm run push-experiment "your question here"');
    process.exit(1);
  }

  console.log(`\n🎨 Generating: "${premise}"\n`);

  // 1. Submit to local server
  const askRes = await fetch(`${LOCAL}/api/experiments/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ premise }),
  });
  const { slug, error } = await askRes.json();
  if (error) { console.error('Error:', error); process.exit(1); }
  console.log(`✅ Started: ${slug}`);

  // 2. Poll until ready (up to 5 min)
  console.log('⏳ Generating (this takes ~60-90s)...');
  const start = Date.now();
  let experiment;
  while (Date.now() - start < 300000) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(`${LOCAL}/api/experiments/${slug}`);
    experiment = await res.json();
    process.stdout.write(`   status: ${experiment.status}, dots: ${experiment.dots ? JSON.parse(experiment.dots || '[]').length : 0}\r`);
    if (experiment.status === 'ready') break;
    if (experiment.status === 'failed') { console.error('\n❌ Generation failed'); process.exit(1); }
  }
  if (experiment.status !== 'ready') { console.error('\n❌ Timed out'); process.exit(1); }
  console.log(`\n✅ Ready! ${experiment.dots ? JSON.parse(experiment.dots).length : 0} dots`);

  // 3. Fetch canvas
  const canvasRes = await fetch(`${LOCAL}/api/canvas/${experiment.canvas?.id || experiment.canvas_id}`);
  const canvas = canvasRes.ok ? await canvasRes.json() : { id: experiment.canvas_id || experiment.canvas?.id, theme: 'ask', subthemes: '[]', spatial_guide: 'none', week_of: new Date().toISOString().split('T')[0], status: 'active', created_at: new Date().toISOString() };

  // 4. Push to Railway
  console.log('🚀 Pushing to Railway...');
  const dots = typeof experiment.dots === 'string' ? JSON.parse(experiment.dots) : (experiment.dots || []);
  const pushRes = await fetch(`${REMOTE}/api/admin/import-experiment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ experiment, canvas, dots }),
  });
  const result = await pushRes.json();
  if (result.error) { console.error('Push failed:', result.error); process.exit(1); }

  console.log(`\n✅ Live at: ${REMOTE}/experiments/${slug}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
