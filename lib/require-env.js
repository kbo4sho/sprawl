'use strict';

/**
 * Read a required environment variable, or exit immediately.
 * @param {string} name
 * @returns {string}
 */
function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || String(value).trim() === '') {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

module.exports = { requireEnv };
