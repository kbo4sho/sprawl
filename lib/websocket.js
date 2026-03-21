const { WebSocketServer } = require('ws');
const { stmts } = require('./db');
const { getDecayMultiplier } = require('./budget');

let wss = null;

/**
 * Initialize WebSocket server
 */
function initWebSocket(server, port) {
  wss = new WebSocketServer({ server });
  
  wss.on('connection', (ws, req) => {
    // Track which canvas this client is viewing (via ?canvas=id query param)
    const url = new URL(req.url, `http://localhost:${port}`);
    ws._canvasId = url.searchParams.get('canvas') || null;
    
    // Send initial state
    const marks = stmts.getAllMarks.all().map(markToJson);
    const connections = stmts.getConnections.all().map(connToJson);
    ws.send(JSON.stringify({ type: 'init', marks, connections }));
    
    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'subscribe_canvas') {
          ws._canvasId = data.canvasId;
        }
      } catch {}
    });
  });
  
  return wss;
}

/**
 * Broadcast message to all connected clients
 */
function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => { 
    if (c.readyState === 1) c.send(data); 
  });
}

/**
 * Broadcast to clients viewing a specific canvas
 */
function broadcastToCanvas(canvasId, data) {
  if (!wss) return;
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client._canvasId === canvasId) {
      client.send(msg);
    }
  });
}

/**
 * Convert mark row to JSON with decay
 */
function markToJson(row) {
  const decay = getDecayMultiplier(row.agent_id);
  const agent = stmts.getAgent.get(row.agent_id);
  
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: agent?.name || row.agent_id,
    type: row.type,
    x: row.x, 
    y: row.y,
    color: row.color,
    size: row.size,
    opacity: row.opacity,
    effectiveOpacity: Math.round(row.opacity * decay * 1000) / 1000,
    text: row.text || undefined,
    meta: row.meta ? JSON.parse(row.meta) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Convert connection row to JSON
 */
function connToJson(c) {
  return { 
    id: c.id, 
    from: c.from_agent, 
    to: c.to_agent, 
    createdAt: c.created_at 
  };
}

module.exports = {
  initWebSocket,
  broadcast,
  broadcastToCanvas,
  markToJson,
  connToJson,
};
