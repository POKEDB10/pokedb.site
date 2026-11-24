// src/middleware/index.js
// Aggregated middleware exports (Task P3.3).

const proxyTrust = require('./proxyTrust');
const auth = require('./auth');
const rateLimit = require('./rateLimit');
const robotsPolicy = require('./robotsPolicy');
const securityHeaders = require('./securityHeaders');
const hostRouter = require('./hostRouter');
const errors = require('./errors');

module.exports = {
  ...proxyTrust,
  ...auth,
  ...rateLimit,
  ...robotsPolicy,
  ...securityHeaders,
  ...hostRouter,
  ...errors
};
