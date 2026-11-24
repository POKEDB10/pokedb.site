#!/usr/bin/env node
// scripts/validate-projects.js
// Task P7.1: Build-time validation for data/projects.json
// Enforces schema, required fields, status constraints, and TODO(owner) rules for published cards.

const fs = require('node:fs');
const path = require('node:path');

const PROJECTS_PATH = path.join(__dirname, '..', 'data', 'projects.json');

function validateProjects() {
  if (!fs.existsSync(PROJECTS_PATH)) {
    console.error(`[FAIL] data/projects.json not found at ${PROJECTS_PATH}`);
    process.exit(1);
  }

  let projects;
  try {
    projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8'));
  } catch (err) {
    console.error(`[FAIL] data/projects.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(projects)) {
    console.error(`[FAIL] data/projects.json must be a JSON array of project objects`);
    process.exit(1);
  }

  const validStatuses = new Set(['open', 'private', 'draft']);
  const errors = [];
  const slugs = new Set();

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const prefix = `Project [${i}] (${p.slug || 'unnamed'}):`;

    if (!p.slug || typeof p.slug !== 'string' || !/^[a-z0-9-]+$/.test(p.slug)) {
      errors.push(`${prefix} missing or invalid slug (must be lowercase alphanumeric + hyphens)`);
    } else if (slugs.has(p.slug)) {
      errors.push(`${prefix} duplicate slug "${p.slug}"`);
    } else {
      slugs.add(p.slug);
    }

    if (!p.title || typeof p.title !== 'string') {
      errors.push(`${prefix} missing or empty title`);
    }

    if (!validStatuses.has(p.status)) {
      errors.push(`${prefix} status must be one of: open, private, draft`);
    }

    if (!p.summary || typeof p.summary !== 'string') {
      errors.push(`${prefix} missing or empty summary`);
    }

    if (!p.metric || typeof p.metric !== 'string') {
      errors.push(`${prefix} missing or empty metric`);
    }

    if (!Array.isArray(p.stack) || p.stack.length === 0) {
      errors.push(`${prefix} stack must be a non-empty array of strings`);
    }

    if (!p.links || typeof p.links !== 'object') {
      errors.push(`${prefix} links object is required`);
    } else {
      const linkValues = Object.values(p.links).filter(Boolean);
      // Published cards (status === 'open' || status === 'private') require at least one real link
      if (p.status !== 'draft' && linkValues.length === 0) {
        errors.push(`${prefix} published card (${p.status}) must have at least one valid link`);
      }
    }

    // Published cards cannot contain unresolved TODO(owner)
    if (p.status !== 'draft') {
      const serialized = JSON.stringify(p);
      if (serialized.includes('TODO(owner)')) {
        errors.push(`${prefix} published card (${p.status}) contains unresolved TODO(owner) marker`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[FAIL] Project validation failed with ${errors.length} error(s):`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const publishedCount = projects.filter(p => p.status !== 'draft').length;
  const draftCount = projects.filter(p => p.status === 'draft').length;
  console.log(`[PASS] data/projects.json is valid (${projects.length} total: ${publishedCount} published, ${draftCount} draft skeletons)`);
}

validateProjects();
