const path = require('path');
const { MinecraftRcon } = require('./rcon');
const { startManagedServer } = require('./serverProcess');
const { GenerationRunner } = require('./generationRunner');
const { RunStore } = require('../storage/runStore');
const { sleep } = require('../utils');

class Orchestrator {
  constructor(config) {
    this.config = config;
    this.store = new RunStore(config);
    this.rcon = new MinecraftRcon(config.rcon);
    this.server = null;
    this.runner = null;
  }

  async run() {
    await this.store.startRun();
    if (this.config.run.startServer) {
      const logPath = path.join(this.store.runDir, 'server.log');
      this.server = startManagedServer(this.config, logPath);
      console.log(`Started managed server pid=${this.server.pid}`);
      await sleep(this.config.run.serverStartupMs);
    }

    await this.rcon.connect();
    this.runner = new GenerationRunner({
      config: this.config,
      rcon: this.rcon,
      store: this.store
    });
    await this.runner.run();
  }

  async close({ skipAgentCleanup = false } = {}) {
    if (this.runner) {
      try {
        await this.runner.close();
      } catch {}
    }
    if (!skipAgentCleanup && this.rcon.isConnected()) {
      try {
        await this.rcon.cleanupAgents(this.config);
      } catch {}
    }
    if (this.server && this.rcon.isConnected()) {
      try {
        await this.rcon.stopServer();
      } catch {}
    }
    await this.rcon.close();
    if (this.server) {
      await this.server.stop(this.config.run.serverStopTimeoutMs);
      this.server = null;
    }
  }

  forceClose() {
    if (this.server && typeof this.server.forceStop === 'function') {
      this.server.forceStop();
    }
    try {
      this.rcon.resetClient();
    } catch {}
  }
}

module.exports = { Orchestrator };
