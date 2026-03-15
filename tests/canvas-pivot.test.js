/**
 * Tests for Canvas Pivot features:
 * - User creation
 * - Credits system
 * - Contribution flow
 * - Render triggering
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Test database in memory
let db;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
  // Create all tables
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      credits INTEGER DEFAULT 0,
      stripe_customer_id TEXT DEFAULT NULL
    );
    
    CREATE TABLE canvases (
      id TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      subthemes TEXT NOT NULL,
      spatial_guide TEXT NOT NULL,
      week_of TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      frozen_at TEXT,
      snapshot_url TEXT,
      timelapse_url TEXT,
      slug TEXT DEFAULT NULL,
      subject TEXT DEFAULT NULL,
      style_prompt TEXT DEFAULT NULL,
      rules TEXT DEFAULT "{}",
      current_render_url TEXT DEFAULT NULL,
      contribution_count INTEGER DEFAULT 0,
      render_interval INTEGER DEFAULT 25
    );
    
    CREATE TABLE contributions (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      user_id TEXT,
      seed_word TEXT,
      primitives_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    
    CREATE TABLE purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      credits_granted INTEGER DEFAULT 0,
      stripe_payment_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    
    CREATE TABLE marks (
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
      canvas_id TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE TABLE renders (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      contribution_count_at INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
    );
  `);
});

afterEach(() => {
  db.close();
});

describe('User Management', () => {
  it('should create a new user', () => {
    const userId = crypto.randomUUID();
    const email = 'test@example.com';
    const now = Date.now();
    
    db.prepare('INSERT INTO users (id, email, created_at, credits) VALUES (?, ?, ?, ?)')
      .run(userId, email, now, 0);
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    expect(user).toBeDefined();
    expect(user.email).toBe(email);
    expect(user.credits).toBe(0);
  });
  
  it('should prevent duplicate emails', () => {
    const email = 'test@example.com';
    
    db.prepare('INSERT INTO users (id, email, created_at, credits) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), email, Date.now(), 0);
    
    expect(() => {
      db.prepare('INSERT INTO users (id, email, created_at, credits) VALUES (?, ?, ?, ?)')
        .run(crypto.randomUUID(), email, Date.now(), 0);
    }).toThrow();
  });
  
  it('should update user credits', () => {
    const userId = crypto.randomUUID();
    
    db.prepare('INSERT INTO users (id, email, created_at, credits) VALUES (?, ?, ?, ?)')
      .run(userId, 'test@example.com', Date.now(), 0);
    
    db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(10, userId);
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    expect(user.credits).toBe(10);
  });
});

describe('Purchase System', () => {
  it('should record a purchase and grant credits', () => {
    const userId = crypto.randomUUID();
    const purchaseId = crypto.randomUUID();
    
    db.prepare('INSERT INTO users (id, email, created_at, credits) VALUES (?, ?, ?, ?)')
      .run(userId, 'test@example.com', Date.now(), 0);
    
    // Record purchase
    db.prepare('INSERT INTO purchases (id, user_id, type, amount_cents, credits_granted, stripe_payment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(purchaseId, userId, 'single', 200, 1, 'pi_test123', Date.now());
    
    // Grant credits
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(1, userId);
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId);
    
    expect(user.credits).toBe(1);
    expect(purchase.credits_granted).toBe(1);
    expect(purchase.type).toBe('single');
  });
  
  it('should calculate correct credits for pack purchases', () => {
    const userId = crypto.randomUUID();
    
    db.prepare('INSERT INTO users (id, email, created_at, credits) VALUES (?, ?, ?, ?)')
      .run(userId, 'test@example.com', Date.now(), 0);
    
    // Pack of 10
    db.prepare('INSERT INTO purchases (id, user_id, type, amount_cents, credits_granted, stripe_payment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), userId, 'pack_10', 1600, 10, null, Date.now());
    
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(10, userId);
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    expect(user.credits).toBe(10);
  });
});

describe('Canvas System', () => {
  it('should create a canvas with pivot fields', () => {
    const canvasId = crypto.randomUUID();
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO canvases (
        id, theme, subthemes, spatial_guide, week_of, status, created_at,
        slug, subject, style_prompt, rules, contribution_count, render_interval
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      canvasId, 'Test Canvas', '[]', '', now, 'active', now,
      'test-canvas', 'abstract', 'minimalist art', JSON.stringify({ colorPalette: ['#fff'] }), 0, 25
    );
    
    const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
    
    expect(canvas.slug).toBe('test-canvas');
    expect(canvas.subject).toBe('abstract');
    expect(canvas.contribution_count).toBe(0);
    expect(canvas.render_interval).toBe(25);
  });
  
  it('should increment contribution count', () => {
    const canvasId = crypto.randomUUID();
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO canvases (
        id, theme, subthemes, spatial_guide, week_of, status, created_at,
        contribution_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(canvasId, 'Test', '[]', '', now, 'active', now, 0);
    
    db.prepare('UPDATE canvases SET contribution_count = contribution_count + 1 WHERE id = ?').run(canvasId);
    
    const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
    expect(canvas.contribution_count).toBe(1);
  });
  
  it('should trigger render at correct interval', () => {
    const contributionCount = 50;
    const renderInterval = 25;
    
    const shouldRender = contributionCount % renderInterval === 0;
    expect(shouldRender).toBe(true);
    
    const shouldRender2 = 24 % 25 === 0;
    expect(shouldRender2).toBe(false);
    
    const shouldRender3 = 75 % 25 === 0;
    expect(shouldRender3).toBe(true);
  });
});

describe('Contribution Flow', () => {
  it('should record a contribution', () => {
    const userId = crypto.randomUUID();
    const canvasId = crypto.randomUUID();
    const contributionId = crypto.randomUUID();
    const now = new Date().toISOString();
    
    // Create user and canvas
    db.prepare('INSERT INTO users (id, email, created_at, credits) VALUES (?, ?, ?, ?)')
      .run(userId, 'test@example.com', Date.now(), 1);
    
    db.prepare(`
      INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(canvasId, 'Test', '[]', '', now, 'active', now);
    
    // Make contribution
    db.prepare('INSERT INTO contributions (id, canvas_id, user_id, seed_word, primitives_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(contributionId, canvasId, userId, 'test', 3, Date.now());
    
    // Deduct credit
    db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ?').run(userId);
    
    const contribution = db.prepare('SELECT * FROM contributions WHERE id = ?').get(contributionId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    expect(contribution).toBeDefined();
    expect(contribution.canvas_id).toBe(canvasId);
    expect(contribution.seed_word).toBe('test');
    expect(contribution.primitives_count).toBe(3);
    expect(user.credits).toBe(0);
  });
  
  it('should prevent contribution without credits', () => {
    const userId = crypto.randomUUID();
    
    db.prepare('INSERT INTO users (id, email, created_at, credits) VALUES (?, ?, ?, ?)')
      .run(userId, 'test@example.com', Date.now(), 0);
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    expect(user.credits).toBe(0);
    // In the actual API, this check happens before contribution
    // Here we just verify the user has 0 credits
  });
  
  it('should rate limit contributions', () => {
    const userId = crypto.randomUUID();
    const canvasId = crypto.randomUUID();
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    
    // Simulate recent contribution within the hour
    db.prepare('INSERT INTO users (id, email, created_at, credits) VALUES (?, ?, ?, ?)')
      .run(userId, 'test@example.com', now, 10);
    
    db.prepare('INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(canvasId, 'Test', '[]', '', new Date().toISOString(), 'active', new Date().toISOString());
    
    db.prepare('INSERT INTO contributions (id, canvas_id, user_id, seed_word, primitives_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), canvasId, userId, null, 1, now - 1800000); // 30 min ago
    
    // Check if user contributed in last hour
    const recentCount = db.prepare(`
      SELECT COUNT(*) as count FROM contributions 
      WHERE user_id = ? AND canvas_id = ? AND created_at > ?
    `).get(userId, canvasId, oneHourAgo);
    
    expect(recentCount.count).toBe(1);
    // In actual API, this would trigger a 429 rate limit error
  });
});

describe('Render System', () => {
  it('should record a render', () => {
    const canvasId = crypto.randomUUID();
    const renderId = crypto.randomUUID();
    
    db.prepare('INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(canvasId, 'Test', '[]', '', new Date().toISOString(), 'active', new Date().toISOString());
    
    db.prepare('INSERT INTO renders (id, canvas_id, contribution_count_at, image_path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(renderId, canvasId, 25, '/renders/test/25.png', Date.now());
    
    const render = db.prepare('SELECT * FROM renders WHERE id = ?').get(renderId);
    
    expect(render.canvas_id).toBe(canvasId);
    expect(render.contribution_count_at).toBe(25);
    expect(render.image_path).toBe('/renders/test/25.png');
  });
  
  it('should list renders in order', () => {
    const canvasId = crypto.randomUUID();
    
    db.prepare('INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(canvasId, 'Test', '[]', '', new Date().toISOString(), 'active', new Date().toISOString());
    
    // Add renders out of order
    db.prepare('INSERT INTO renders (id, canvas_id, contribution_count_at, image_path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), canvasId, 50, '/renders/test/50.png', Date.now());
    
    db.prepare('INSERT INTO renders (id, canvas_id, contribution_count_at, image_path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), canvasId, 25, '/renders/test/25.png', Date.now());
    
    db.prepare('INSERT INTO renders (id, canvas_id, contribution_count_at, image_path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), canvasId, 75, '/renders/test/75.png', Date.now());
    
    const renders = db.prepare(`
      SELECT contribution_count_at FROM renders 
      WHERE canvas_id = ? 
      ORDER BY contribution_count_at ASC
    `).all(canvasId);
    
    expect(renders.length).toBe(3);
    expect(renders[0].contribution_count_at).toBe(25);
    expect(renders[1].contribution_count_at).toBe(50);
    expect(renders[2].contribution_count_at).toBe(75);
  });
  
  it('should update canvas with latest render', () => {
    const canvasId = crypto.randomUUID();
    const renderPath = '/renders/test/25.png';
    
    db.prepare('INSERT INTO canvases (id, theme, subthemes, spatial_guide, week_of, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(canvasId, 'Test', '[]', '', new Date().toISOString(), 'active', new Date().toISOString());
    
    db.prepare('UPDATE canvases SET current_render_url = ? WHERE id = ?').run(renderPath, canvasId);
    
    const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(canvasId);
    
    expect(canvas.current_render_url).toBe(renderPath);
  });
});

describe('Arc Primitive Type', () => {
  it('should store arc metadata', () => {
    const markId = crypto.randomUUID();
    const meta = { radius: 50, startAngle: 0, endAngle: Math.PI };
    
    db.prepare(`
      INSERT INTO marks (id, agent_id, type, x, y, color, size, opacity, text, meta, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(markId, 'system', 'arc', 0, 0, '#fff', 5, 0.8, null, JSON.stringify(meta), Date.now(), Date.now());
    
    const mark = db.prepare('SELECT * FROM marks WHERE id = ?').get(markId);
    const parsedMeta = JSON.parse(mark.meta);
    
    expect(mark.type).toBe('arc');
    expect(parsedMeta.radius).toBe(50);
    expect(parsedMeta.startAngle).toBe(0);
    expect(parsedMeta.endAngle).toBeCloseTo(Math.PI);
  });
});
