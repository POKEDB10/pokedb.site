// src/utils/template.js
// Safe HTML escaping and simple template rendering (Task P3.3, P3.5).

const fs = require('node:fs');
const path = require('node:path');

const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', 'templates');

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function renderTemplate(templateName, values) {
  const templatePath = path.join(TEMPLATES_DIR, templateName);
  if (!fs.existsSync(templatePath)) {
    return `<!DOCTYPE html><html><body><h1>Error</h1><p>${htmlEscape(values?.message || 'Page not found')}</p></body></html>`;
  }
  const template = fs.readFileSync(templatePath, 'utf8');
  return template.replace(/{{{?(\w+)}}}?/g, (match, key) => values[key] ?? '');
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/<\/script/gi, '<\\/script')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

module.exports = {
  htmlEscape,
  renderTemplate,
  serializeForInlineScript
};
