// src/middleware/hostRouter.js
// Subdomain and path-based host routing (Task P3.3, P3.4, ARCH-002, DX-001).
// Maps subdomain in production (e.g. drop.pokedb.site) and subpath on localhost (/tools/drop/).

const path = require('node:path');
const express = require('express');
const { resolveHost, normalizeHost, resolveApiHost, resolveBrowserOriginHost } = require('./proxyTrust');

function createHostRouter(options = {}) {
  const registry = options.registry || [];
  const rootDir = options.rootDir || path.resolve(__dirname, '..', '..');

  const toolMap = new Map();
  for (const tool of registry) {
    toolMap.set(tool.id, tool);
    if (tool.subdomain) {
      toolMap.set(tool.subdomain, tool);
    }
  }

  return function hostRouter(req, res, next) {
    const host = resolveHost(req) || '';

    // Check subdomain matching first (e.g. drop.pokedb.site)
    for (const tool of registry) {
      const fullSubdomain = `${tool.subdomain}.pokedb.site`;
      if (host === fullSubdomain || host.startsWith(`${tool.subdomain}.`)) {
        req.currentTool = tool;
        return next();
      }
    }

    // Check if path is /tools/:toolId
    const toolsPrefixMatch = req.path.match(/^\/tools\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/);
    if (toolsPrefixMatch) {
      const toolId = toolsPrefixMatch[1];
      const tool = toolMap.get(toolId);
      if (tool) {
        req.currentTool = tool;
        req.toolSubpath = toolsPrefixMatch[2] || '';
        return next();
      }
    }

    // Hub or apex host
    if (
      host === 'tools.pokedb.site' ||
      host.startsWith('tools.') ||
      host === 'pokedb.site' ||
      host === 'www.pokedb.site' ||
      host.includes('localhost') ||
      host.includes('127.0.0.1')
    ) {
      req.isHubHost = true;
    }

    next();
  };
}

const checkApiHost = (allowedHosts) => {
  return (req, res, next) => {
    const hosts = [resolveApiHost(req), resolveBrowserOriginHost(req)];

    if (hosts.some((host) => ['localhost', '127.0.0.1', '::1'].includes(host))) {
      return next();
    }
    if (hosts.some((host) => allowedHosts.includes(host))) {
      return next();
    }
    return res.status(404).json({ error: 'API endpoint not available on this subdomain' });
  };
};

module.exports = {
  createHostRouter,
  normalizeHost,
  resolveApiHost,
  resolveBrowserOriginHost,
  checkApiHost
};
