const { RATE_LIMIT } = require('./constants');

// In-memory rate limit tracking
const rateLimits = {};

/**
 * Rate limit middleware - max X requests per minute per IP
 */
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimits[ip] || rateLimits[ip].resetAt < now) {
    rateLimits[ip] = { count: 0, resetAt: now + 60000 };
  }
  
  rateLimits[ip].count++;
  
  if (rateLimits[ip].count > RATE_LIMIT) {
    return res.status(429).json({ error: 'Rate limited. Try again in a minute.' });
  }
  
  res.setHeader('X-RateLimit-Remaining', RATE_LIMIT - rateLimits[ip].count);
  next();
}

/**
 * Clean up expired rate limit entries every 5 minutes
 */
function startRateLimitCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const ip in rateLimits) {
      if (rateLimits[ip].resetAt < now) {
        delete rateLimits[ip];
      }
    }
  }, 300000);
}

module.exports = { rateLimit, startRateLimitCleanup };
