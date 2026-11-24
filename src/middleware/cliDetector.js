// src/middleware/cliDetector.js
// CLI client detector for curl / Wget / plain-text workflows (Task P5.2).

function cliDetector(req, res, next) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const accept = (req.headers['accept'] || '').toLowerCase();

  const isCurl = ua.startsWith('curl/');
  const isWget = ua.startsWith('wget/');
  const isPlainAccept = accept.includes('text/plain') && !accept.includes('text/html');

  req.isCli = Boolean(isCurl || isWget || isPlainAccept);
  next();
}

module.exports = {
  cliDetector
};
