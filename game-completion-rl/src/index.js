const { loadConfig } = require('./config/loadConfig');
const { Orchestrator } = require('./runtime/orchestrator');
const { withTimeout } = require('./utils');

const config = loadConfig();
const orchestrator = new Orchestrator(config);

let shuttingDown = false;
let forcedShutdown = false;

async function shutdown(code = 0, { signal = null } = {}) {
  if (shuttingDown) {
    forceShutdown(signal || 'second signal');
    return;
  }
  shuttingDown = true;
  const graceMs = config.run.shutdownGraceMs || 30000;
  const skipAgentCleanup = signal === 'SIGINT' || signal === 'SIGTERM';
  await withTimeout(
    orchestrator.close({ skipAgentCleanup }),
    graceMs,
    `Shutdown did not finish within ${graceMs}ms`
  ).catch(err => {
    console.warn(err?.message || err);
    forceShutdown('shutdown timeout');
  });
  process.exit(code);
}

process.on('SIGINT', () => {
  console.log('SIGINT received, closing agents and server. Press Ctrl-C again to force exit.');
  shutdown(130, { signal: 'SIGINT' }).catch(err => {
    console.error(err);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown(143, { signal: 'SIGTERM' }).catch(err => {
    console.error(err);
    process.exit(1);
  });
});

process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err);
  shutdown(1).catch(closeErr => {
    console.error(closeErr);
    process.exit(1);
  });
});

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  shutdown(1).catch(closeErr => {
    console.error(closeErr);
    process.exit(1);
  });
});

(async () => {
  try {
    await orchestrator.run();
    await shutdown(0);
  } catch (err) {
    console.error('Run failed:', err);
    await shutdown(1);
  }
})();

function forceShutdown(reason) {
  if (forcedShutdown) return;
  forcedShutdown = true;
  console.warn(`Forcing shutdown (${reason}).`);
  try {
    orchestrator.forceClose();
  } catch {}
  process.exit(130);
}
