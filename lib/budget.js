const { stmts } = require('./db');
const { AGENT_CONFIG, CURATOR_AGENTS, CURATOR_MARKS_LIMIT } = require('./constants');

/**
 * Check and reset daily evolve counter if needed
 * Resets at midnight local time
 */
function checkAndResetDailyEvolves(agentId) {
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return { used: 0, resetAt: Date.now() };
  
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const midnightToday = today.getTime();
  const midnightTomorrow = midnightToday + 86400000;
  
  // Reset if we're past the reset time
  if (!agent.daily_evolves_reset_at || agent.daily_evolves_reset_at < midnightToday) {
    const { db } = require('./db');
    db.prepare('UPDATE agents SET daily_evolves_used = 0, daily_evolves_reset_at = ? WHERE id = ?')
      .run(midnightTomorrow, agentId);
    return { used: 0, resetAt: midnightTomorrow };
  }
  
  return { 
    used: agent.daily_evolves_used || 0, 
    resetAt: agent.daily_evolves_reset_at 
  };
}

/**
 * Check if agent is a curator for a given canvas
 */
function isCurator(agentId, canvasIdOrMarkAgentId) {
  const agent = stmts.getAgent.get(agentId);
  if (!agent || agent.canvas_role !== 'curator') return false;
  
  // If we have a canvas_id on the mark, compare directly
  if (canvasIdOrMarkAgentId && agent.canvas_id === canvasIdOrMarkAgentId) return true;
  
  // If mark has no canvas_id (null), check if the mark's owner is on the same canvas
  if (!canvasIdOrMarkAgentId || canvasIdOrMarkAgentId === null) return true;
  
  // Also check if the target is actually an agent_id on the same canvas
  const markOwner = stmts.getAgent.get(canvasIdOrMarkAgentId);
  if (markOwner && markOwner.canvas_id === agent.canvas_id) return true;
  
  return false;
}

/**
 * Get agent budget/limits
 */
function getBudget(agentId) {
  const isCuratorAgent = CURATOR_AGENTS.has(agentId);
  const maxMarks = isCuratorAgent ? CURATOR_MARKS_LIMIT : AGENT_CONFIG.marksPerCanvas;
  
  const agent = stmts.getAgent.get(agentId);
  if (!agent) {
    return {
      totalMarks: 0,
      maxMarks,
      marksRemaining: maxMarks,
      dailyEvolvesUsed: 0,
      dailyEvolvesMax: AGENT_CONFIG.dailyEvolves,
      dailyEvolvesLeft: AGENT_CONFIG.dailyEvolves,
      nextResetIn: 0,
      memberDays: 0,
      frozen: false,
    };
  }
  
  const totalMarks = stmts.countAgentMarks.get(agentId).count;
  const dailyEvolves = checkAndResetDailyEvolves(agentId);
  const days = Math.floor((Date.now() - agent.joined_at) / 86400000);
  
  const dailyEvolvesLeft = Math.max(0, AGENT_CONFIG.dailyEvolves - dailyEvolves.used);
  const nextResetIn = dailyEvolves.resetAt - Date.now();
  
  return {
    totalMarks,
    maxMarks,
    marksRemaining: Math.max(0, maxMarks - totalMarks),
    dailyEvolvesUsed: dailyEvolves.used,
    dailyEvolvesMax: AGENT_CONFIG.dailyEvolves,
    dailyEvolvesLeft,
    nextResetIn: Math.max(0, nextResetIn),
    memberDays: days,
    canvasRole: agent.canvas_role || 'contributor',
    frozen: !!agent.frozen,
  };
}

/**
 * Get decay multiplier based on agent last_seen
 * 0-7 days: 1.0, 30+ days: 0.0, linear decay in between
 */
function getDecayMultiplier(agentId) {
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return 1.0;
  
  const days = (Date.now() - agent.last_seen) / 86400000;
  if (days <= 7) return 1.0;
  if (days >= 30) return 0.0;
  return Math.max(0.1, 1.0 - ((days - 7) / 23) * 0.9);
}

/**
 * Assign home coordinates to a new agent
 * Radial placement - founding agents near center, others on expanding frontier
 */
function assignHomeCoordinates(agentId) {
  const existing = stmts.getAgent.get(agentId);
  if (existing && (existing.home_x !== 0 || existing.home_y !== 0)) {
    // Agent already has home coords
    return { home_x: existing.home_x, home_y: existing.home_y };
  }
  
  const agentCount = stmts.countAgents.get().count;
  let radius, angle;
  
  if (agentCount < 5) {
    // Founding agents near center
    radius = Math.random() * 50;
    angle = Math.random() * Math.PI * 2;
  } else {
    // Radial frontier placement
    radius = Math.sqrt(agentCount) * 80;
    angle = Math.random() * Math.PI * 2;
  }
  
  return {
    home_x: Math.cos(angle) * radius,
    home_y: Math.sin(angle) * radius
  };
}

module.exports = {
  checkAndResetDailyEvolves,
  isCurator,
  getBudget,
  getDecayMultiplier,
  assignHomeCoordinates,
};
