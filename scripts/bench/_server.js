const { spawn } = require('child_process');
const http = require('http');

const PORT = process.env.PORT || 5050;
const BASE_URL = `http://localhost:${PORT}`;

function isServerHealthy(port = PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureServer(options = {}) {
  const port = options.port || PORT;
  const alreadyRunning = await isServerHealthy(port);
  if (alreadyRunning) {
    return {
      port,
      baseUrl: `http://localhost:${port}`,
      stop: async () => {}
    };
  }

  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: options.nodeEnv || process.env.NODE_ENV || 'test',
    ...options.env
  };

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (d) => {
    if (process.env.DEBUG_SERVER) process.stdout.write(d);
  });
  child.stderr.on('data', (d) => {
    if (process.env.DEBUG_SERVER) process.stderr.write(d);
  });

  const startTime = Date.now();
  let healthy = false;
  while (Date.now() - startTime < 10000) {
    healthy = await isServerHealthy(port);
    if (healthy) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  if (!healthy) {
    child.kill('SIGKILL');
    throw new Error(`Server failed to start and respond on port ${port} within 10s`);
  }

  return {
    child,
    port,
    baseUrl: `http://localhost:${port}`,
    stop: async () => {
      return new Promise((resolve) => {
        child.on('exit', resolve);
        child.kill('SIGTERM');
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch (_) {}
          resolve();
        }, 3000);
      });
    }
  };
}

function runAutocannon(args) {
  return new Promise((resolve, reject) => {
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(npxCmd, ['--yes', 'autocannon', ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32'
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`autocannon exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

module.exports = {
  PORT,
  BASE_URL,
  ensureServer,
  runAutocannon,
  isServerHealthy
};
