// Environment constants
const PORT = process.env.PORT || 3500;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || require('path').join(__dirname, '..', 'data');
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '213e438e21c126522742c945fc4ceea2c3df9aa3aa63e66f';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'sprawl-admin';
const EVOLVE_SECRET = process.env.EVOLVE_SECRET || 'dev-secret';
const EVOLVE_INTERVAL = parseInt(process.env.EVOLVE_INTERVAL_MS) || 3600000; // 1 hour
const EVOLVE_ENABLED = process.env.EVOLVE_ENABLED === 'true';
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT) || 500;

// Agent configuration
const AGENT_CONFIG = {
  marksPerCanvas: 5000,
  dailyEvolves: 50,
  autoEvolve: true,
};

// Curator agents (elevated limits)
const CURATOR_AGENTS = new Set(process.env.CURATOR_AGENTS?.split(',') || []);
const CURATOR_MARKS_LIMIT = 25000;

// Night sky palette — warm whites, cool blues
const PALETTE = [
  '#fff8f0', // warm white (bright star)
  '#ffeedd', // peach white
  '#fff3e0', // candlelight
  '#f5ebe0', // linen
  '#e8ddd3', // ash warm
  '#d4c5b5', // dim warm
  '#cad8e8', // pale blue
  '#a8c4dc', // soft blue
  '#7ba7cc', // steel blue
  '#5b8fb9', // mid blue
  '#3a6f9e', // deep blue
  '#1e3a5f', // navy
];

module.exports = {
  PORT,
  DATA_DIR,
  GATEWAY_URL,
  GATEWAY_TOKEN,
  ADMIN_SECRET,
  EVOLVE_SECRET,
  EVOLVE_INTERVAL,
  EVOLVE_ENABLED,
  RATE_LIMIT,
  AGENT_CONFIG,
  CURATOR_AGENTS,
  CURATOR_MARKS_LIMIT,
  PALETTE,
};
