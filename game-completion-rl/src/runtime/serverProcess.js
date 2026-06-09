const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { withTimeout } = require('../utils');

function startManagedServer(config, logPath) {
  const script = path.join(config.serverDir, 'start_server.sh');
  const log = fs.openSync(logPath, 'a');
  let logClosed = false;

  const closeLog = () => {
    if (logClosed) return;
    logClosed = true;
    try {
      fs.closeSync(log);
    } catch {}
  };

  const child = spawn(script, {
    cwd: config.serverDir,
    stdio: ['ignore', log, log],
    env: process.env
  });

  let exitInfo = null;
  const exited = new Promise(resolve => {
    child.once('error', err => {
      exitInfo = { error: err };
      closeLog();
      resolve(exitInfo);
    });
    child.once('exit', (code, signal) => {
      exitInfo = { code, signal };
      closeLog();
      resolve(exitInfo);
    });
  });

  child.on('exit', code => {
    if (code !== 0 && code !== null) {
      console.warn(`[server] exited with code ${code}`);
    }
  });

  return {
    pid: child.pid,
    get exited() {
      return !!exitInfo;
    },
    async wait(timeoutMs) {
      if (exitInfo) return exitInfo;
      return withTimeout(exited, timeoutMs, `Server did not exit within ${timeoutMs}ms`);
    },
    async stop(timeoutMs = 15000) {
      if (exitInfo) return exitInfo;
      if (!child.killed) child.kill('SIGTERM');
      try {
        return await this.wait(timeoutMs);
      } catch (err) {
        if (!exitInfo) child.kill('SIGKILL');
        return this.wait(5000).catch(() => ({ error: err }));
      }
    },
    forceStop() {
      if (!exitInfo && !child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    }
  };
}

module.exports = { startManagedServer };
