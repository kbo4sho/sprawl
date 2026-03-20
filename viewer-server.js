#!/usr/bin/env node

/**
 * viewer-server.js — Local server for live viewer + replay trigger
 * 
 * Serves the viewer HTML and provides a /replay endpoint that
 * runs the wave speed run in the background.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3999;
const VIEWER_PATH = path.join(__dirname, 'live-viewer-v2.html');

const WAVE_REFS = [
  'curator-frames/wave-curl.png',
  'curator-frames/wave-break.png',
  'curator-frames/wave-foam.png',
  'curator-frames/wave-retreat.png',
];

let replayRunning = false;

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(VIEWER_PATH, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }
  
  if (req.method === 'POST' && req.url === '/replay') {
    if (replayRunning) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Already running' }));
      return;
    }
    
    replayRunning = true;
    const startTime = Date.now();
    
    const child = spawn('node', [
      'curator-speedrun.js',
      ...WAVE_REFS,
    ], { cwd: __dirname, stdio: 'pipe' });
    
    let output = '';
    child.stdout.on('data', d => { output += d.toString(); });
    child.stderr.on('data', d => { output += d.toString(); });
    
    child.on('close', (code) => {
      replayRunning = false;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`Replay finished in ${elapsed}s (exit ${code})`);
    });
    
    // Respond immediately — replay runs in background
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started', compositions: WAVE_REFS.length }));
    return;
  }
  
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🎨 Live viewer: http://localhost:${PORT}`);
  console.log(`   Replay endpoint: POST http://localhost:${PORT}/replay`);
});
