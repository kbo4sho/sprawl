const crypto = require('crypto');
const { apiKeyStmts } = require('./db');

/**
 * Generate a new API key
 */
function generateApiKey() {
  return 'sprl_' + crypto.randomBytes(24).toString('base64url');
}

/**
 * Middleware: extract API key from header, attach agent info to req
 * Supports both Bearer token and X-API-Key header
 */
function apiKeyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];
  
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (apiKeyHeader) {
    token = apiKeyHeader;
  }
  
  if (!token) {
    // No key provided — proceed without auth (backward compat for web UI)
    req.apiAgent = null;
    return next();
  }
  
  const keyRow = apiKeyStmts.getKey.get(token);
  if (!keyRow) {
    return res.status(401).json({ error: 'Invalid or revoked API key' });
  }
  
  // Touch last_used_at (throttled — only update every 60s to reduce writes)
  const now = Date.now();
  if (!keyRow.last_used_at || now - keyRow.last_used_at > 60000) {
    apiKeyStmts.touchKey.run(now, token);
  }
  
  req.apiAgent = { id: keyRow.agent_id, keyName: keyRow.name };
  next();
}

/**
 * Middleware: require API key auth (for external agent endpoints)
 */
function requireApiKey(req, res, next) {
  if (!req.apiAgent) {
    return res.status(401).json({ 
      error: 'API key required. Include Authorization: Bearer <key> or X-API-Key header.' 
    });
  }
  next();
}

/**
 * Middleware: verify the authenticated agent matches the target agent
 * @param {string} agentIdParam - name of route param or body field to check
 */
function requireOwnAgent(agentIdParam = 'agentId') {
  return (req, res, next) => {
    if (!req.apiAgent) return next(); // No key = web UI, use existing auth
    
    const targetId = req.params[agentIdParam] || req.body?.agentId || req.params.id;
    if (targetId && targetId !== req.apiAgent.id) {
      return res.status(403).json({ 
        error: `API key is scoped to agent "${req.apiAgent.id}", cannot act on "${targetId}"` 
      });
    }
    next();
  };
}

module.exports = {
  generateApiKey,
  apiKeyAuth,
  requireApiKey,
  requireOwnAgent,
};
