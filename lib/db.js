const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./constants');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'sprawl.db');
const db = new Database(DB_PATH);

// Enable WAL mode and foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initialize database schema
 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#ffffff',
      joined_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      shader_code TEXT DEFAULT NULL,
      frozen INTEGER DEFAULT 0,
      home_x REAL DEFAULT 0,
      home_y REAL DEFAULT 0,
      stripe_customer_id TEXT DEFAULT NULL,
      stripe_subscription_id TEXT DEFAULT NULL,
      subscription_status TEXT DEFAULT 'trial',
      trial_expires_at INTEGER DEFAULT NULL,
      email TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT DEFAULT 'default',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER DEFAULT NULL,
      revoked INTEGER DEFAULT 0,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_agent ON api_keys(agent_id);

    CREATE TABLE IF NOT EXISTS marks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'dot',
      x REAL NOT NULL,
      y REAL NOT NULL,
      color TEXT DEFAULT '#ffffff',
      size REAL DEFAULT 10,
      opacity REAL DEFAULT 0.8,
      text TEXT,
      meta TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_marks_agent ON marks(agent_id);

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (from_agent) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (to_agent) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE(from_agent, to_agent)
    );

    CREATE TABLE IF NOT EXISTS action_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_action_log_agent_time ON action_log(agent_id, created_at);

    CREATE TABLE IF NOT EXISTS evolution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      cycle INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      ops TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_evolution_agent_cycle ON evolution_log(agent_id, cycle);

    CREATE TABLE IF NOT EXISTS canvases (
      id TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      subthemes TEXT NOT NULL,
      spatial_guide TEXT NOT NULL,
      week_of TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      frozen_at TEXT,
      snapshot_url TEXT,
      timelapse_url TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_canvases_status ON canvases(status);
    CREATE INDEX IF NOT EXISTS idx_canvases_week ON canvases(week_of);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      credits INTEGER DEFAULT 0,
      stripe_customer_id TEXT DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);

    CREATE TABLE IF NOT EXISTS contributions (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      user_id TEXT,
      seed_word TEXT,
      primitives_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_contributions_canvas ON contributions(canvas_id);
    CREATE INDEX IF NOT EXISTS idx_contributions_user ON contributions(user_id);
    CREATE INDEX IF NOT EXISTS idx_contributions_time ON contributions(created_at);

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      credits_granted INTEGER DEFAULT 0,
      stripe_payment_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_stripe ON purchases(stripe_payment_id);

    CREATE TABLE IF NOT EXISTS epochs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epoch_number INTEGER UNIQUE NOT NULL,
      timestamp TEXT NOT NULL,
      reference_prompt TEXT,
      image_prompt TEXT,
      note_to_self TEXT,
      painting_title TEXT,
      painting_artist TEXT,
      source TEXT,
      targets TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS renders (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      contribution_count_at INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
    );
  `);
}

/**
 * Run migrations to add missing columns
 */
function runMigrations() {
  try {
    const columns = db.prepare("PRAGMA table_info(agents)").all();
    
    const ensure = (name, ddl) => {
      if (!columns.some(c => c.name === name)) {
        db.exec(`ALTER TABLE agents ADD COLUMN ${ddl}`);
        console.log(`Migration: Added ${name} column to agents table`);
      }
    };
    
    ensure('frozen', 'frozen INTEGER DEFAULT 0');
    ensure('home_x', 'home_x REAL DEFAULT 0');
    ensure('home_y', 'home_y REAL DEFAULT 0');
    ensure('personality', 'personality TEXT DEFAULT NULL');
    ensure('vision', 'vision TEXT DEFAULT NULL');
    ensure('stripe_customer_id', 'stripe_customer_id TEXT DEFAULT NULL');
    ensure('stripe_subscription_id', 'stripe_subscription_id TEXT DEFAULT NULL');
    ensure('subscription_status', 'subscription_status TEXT DEFAULT "trial"');
    ensure('trial_expires_at', 'trial_expires_at INTEGER DEFAULT NULL');
    ensure('email', 'email TEXT DEFAULT NULL');
    ensure('daily_evolves_used', 'daily_evolves_used INTEGER DEFAULT 0');
    ensure('daily_evolves_reset_at', 'daily_evolves_reset_at INTEGER DEFAULT 0');
    ensure('canvas_id', 'canvas_id TEXT DEFAULT NULL REFERENCES canvases(id)');
    ensure('subtheme', 'subtheme TEXT DEFAULT NULL');
    ensure('canvas_role', 'canvas_role TEXT DEFAULT "contributor"');
    
    // Set 24 hour trial for existing agents with null trial_expires_at
    const hasTrialData = db.prepare("SELECT COUNT(*) as c FROM agents WHERE trial_expires_at IS NULL").get();
    if (hasTrialData.c > 0) {
      db.exec('UPDATE agents SET trial_expires_at = joined_at + 86400000 WHERE trial_expires_at IS NULL');
      console.log(`Migration: Set 24h trials for ${hasTrialData.c} existing agents`);
    }
    
    // Add canvas_id to marks and evolution_log
    const marksColumns = db.prepare("PRAGMA table_info(marks)").all();
    if (!marksColumns.some(c => c.name === 'canvas_id')) {
      db.exec('ALTER TABLE marks ADD COLUMN canvas_id TEXT DEFAULT NULL REFERENCES canvases(id)');
      console.log('Migration: Added canvas_id to marks');
    }
    
    const evolutionColumns = db.prepare("PRAGMA table_info(evolution_log)").all();
    if (!evolutionColumns.some(c => c.name === 'canvas_id')) {
      db.exec('ALTER TABLE evolution_log ADD COLUMN canvas_id TEXT DEFAULT NULL REFERENCES canvases(id)');
      console.log('Migration: Added canvas_id to evolution_log');
    }
    
    // Canvas Pivot fields
    const canvasColumns = db.prepare("PRAGMA table_info(canvases)").all();
    const ensureCanvas = (name, ddl) => {
      if (!canvasColumns.some(c => c.name === name)) {
        db.exec(`ALTER TABLE canvases ADD COLUMN ${ddl}`);
        console.log(`Canvas Migration: Added ${name}`);
      }
    };
    
    ensureCanvas('slug', 'slug TEXT DEFAULT NULL');
    ensureCanvas('subject', 'subject TEXT DEFAULT NULL');
    ensureCanvas('style_prompt', 'style_prompt TEXT DEFAULT NULL');
    ensureCanvas('rules', 'rules TEXT DEFAULT "{}"');
    ensureCanvas('current_render_url', 'current_render_url TEXT DEFAULT NULL');
    ensureCanvas('contribution_count', 'contribution_count INTEGER DEFAULT 0');
    ensureCanvas('render_interval', 'render_interval INTEGER DEFAULT 25');
    
  } catch (e) {
    console.error('Migration error:', e);
  }
}

// Prepared statements
const stmts = {
  getAgent: db.prepare('SELECT * FROM agents WHERE id = ?'),
  countAgents: db.prepare('SELECT COUNT(*) as count FROM agents'),
  upsertAgent: db.prepare(`
    INSERT INTO agents (id, name, color, joined_at, last_seen, shader_code, frozen, home_x, home_y, personality)
    VALUES (@id, @name, @color, @now, @now, @shader_code, 0, @home_x, @home_y, @personality)
    ON CONFLICT(id) DO UPDATE SET name=@name, color=@color, last_seen=@now,
      shader_code=COALESCE(@shader_code, agents.shader_code),
      personality=COALESCE(@personality, agents.personality)
  `),
  getAllMarks: db.prepare('SELECT * FROM marks ORDER BY created_at'),
  getMarksByCanvas: db.prepare('SELECT * FROM marks WHERE canvas_id = ? ORDER BY created_at'),
  getMarksByAgent: db.prepare('SELECT * FROM marks WHERE agent_id = ?'),
  getMarksByAgentOnCanvas: db.prepare('SELECT * FROM marks WHERE agent_id = ? AND canvas_id = ?'),
  getMark: db.prepare('SELECT * FROM marks WHERE id = ?'),
  countAgentMarks: db.prepare('SELECT COUNT(*) as count FROM marks WHERE agent_id = ?'),
  countAgentMarksOnCanvas: db.prepare('SELECT COUNT(*) as count FROM marks WHERE agent_id = ? AND canvas_id = ?'),
  countCanvasMarks: db.prepare('SELECT COUNT(*) as count FROM marks WHERE canvas_id = ?'),
  insertMark: db.prepare(`
    INSERT INTO marks (id, agent_id, type, x, y, color, size, opacity, text, meta, canvas_id, created_at, updated_at)
    VALUES (@id, @agent_id, @type, @x, @y, @color, @size, @opacity, @text, @meta, @canvas_id, @now, @now)
  `),
  updateMark: db.prepare(`
    UPDATE marks SET x=@x, y=@y, color=@color, size=@size, opacity=@opacity, text=@text, updated_at=@now
    WHERE id=@id
  `),
  deleteMark: db.prepare('DELETE FROM marks WHERE id = ? AND agent_id = ?'),
  deleteAgentMarks: db.prepare('DELETE FROM marks WHERE agent_id = ?'),
  listAgents: db.prepare(`
    SELECT a.*, COUNT(m.id) as mark_count, MAX(m.updated_at) as last_active
    FROM agents a LEFT JOIN marks m ON a.id = m.agent_id
    GROUP BY a.id ORDER BY last_active DESC
  `),
  getConnections: db.prepare('SELECT * FROM connections ORDER BY created_at'),
  getAgentConnections: db.prepare('SELECT * FROM connections WHERE from_agent = ? OR to_agent = ?'),
  insertConnection: db.prepare('INSERT OR IGNORE INTO connections (id, from_agent, to_agent, created_at) VALUES (?, ?, ?, ?)'),
  deleteConnection: db.prepare('DELETE FROM connections WHERE (from_agent = ? AND to_agent = ?) OR (from_agent = ? AND to_agent = ?)'),
  
  // Canvas statements
  getAllCanvases: db.prepare('SELECT * FROM canvases ORDER BY created_at DESC'),
  getActiveCanvases: db.prepare("SELECT * FROM canvases WHERE status = 'active' ORDER BY created_at"),
  getCanvas: db.prepare('SELECT * FROM canvases WHERE id = ?'),
  insertCanvas: db.prepare(`
    INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, created_at)
    VALUES (@id, @theme, @subthemes, @spatial_guide, @week_of, @status, @created_at)
  `),
  updateCanvasStatus: db.prepare('UPDATE canvases SET status = ?, frozen_at = ? WHERE id = ?'),
  updateCanvasUrls: db.prepare('UPDATE canvases SET snapshot_url = ?, timelapse_url = ? WHERE id = ?'),
  getCanvasAgents: db.prepare('SELECT * FROM agents WHERE canvas_id = ?'),
  countCanvasAgents: db.prepare('SELECT COUNT(*) as count FROM agents WHERE canvas_id = ?'),
  assignAgentToCanvas: db.prepare('UPDATE agents SET canvas_id = ?, subtheme = ? WHERE id = ?'),
  
  // Users & contributions
  getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
  getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insertUser: db.prepare(`
    INSERT INTO users (id, email, created_at, credits, stripe_customer_id)
    VALUES (?, ?, ?, ?, ?)
  `),
  updateUserCredits: db.prepare('UPDATE users SET credits = ? WHERE id = ?'),
  updateUserStripeCustomer: db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?'),
  insertContribution: db.prepare(`
    INSERT INTO contributions (id, canvas_id, user_id, seed_word, primitives_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getContributionsByCanvas: db.prepare('SELECT * FROM contributions WHERE canvas_id = ? ORDER BY created_at DESC'),
  getContributionsByUser: db.prepare('SELECT * FROM contributions WHERE user_id = ? ORDER BY created_at DESC'),
  countContributionsByUserCanvas: db.prepare(`
    SELECT COUNT(*) as count FROM contributions 
    WHERE user_id = ? AND canvas_id = ? AND created_at > ?
  `),
  insertPurchase: db.prepare(`
    INSERT INTO purchases (id, user_id, type, amount_cents, credits_granted, stripe_payment_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getPurchasesByUser: db.prepare('SELECT * FROM purchases WHERE user_id = ? ORDER BY created_at DESC'),
};

// API key statements (separate for clarity)
const apiKeyStmts = {
  getKey: db.prepare('SELECT * FROM api_keys WHERE key = ? AND revoked = 0'),
  getKeysByAgent: db.prepare('SELECT key, name, created_at, last_used_at FROM api_keys WHERE agent_id = ? AND revoked = 0'),
  insertKey: db.prepare('INSERT INTO api_keys (key, agent_id, name, created_at) VALUES (?, ?, ?, ?)'),
  touchKey: db.prepare('UPDATE api_keys SET last_used_at = ? WHERE key = ?'),
  revokeKey: db.prepare('UPDATE api_keys SET revoked = 1 WHERE key = ? AND agent_id = ?'),
  revokeAllKeys: db.prepare('UPDATE api_keys SET revoked = 1 WHERE agent_id = ?'),
};

// Initialize on load
initSchema();
runMigrations();

module.exports = { db, stmts, apiKeyStmts };
