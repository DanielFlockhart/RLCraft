const { Rcon } = require('rcon-client');
const { sleep, isTransientNetworkError } = require('../utils');

class MinecraftRcon {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.connecting = null;
  }

  async connect() {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = this.connectWithRetry();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async connectWithRetry() {
    let lastError = null;
    for (let attempt = 1; attempt <= this.config.retries; attempt++) {
      try {
        this.client = new Rcon({
          host: this.config.host,
          port: this.config.port,
          password: this.config.password,
          timeout: this.config.timeoutMs || 10000
        });
        await this.client.connect();
        this.client.on('error', err => console.warn('[RCON] error', err?.message || err));
        this.client.on('end', () => {
          this.client = null;
        });
        return this.client;
      } catch (err) {
        lastError = err;
        try {
          if (this.client) await this.client.end();
        } catch {}
        this.client = null;
        if (attempt === 1 || attempt % 10 === 0) {
          console.warn(`[RCON] waiting for ${this.config.host}:${this.config.port} (${attempt}/${this.config.retries})`);
        }
        await sleep(this.config.retryMs);
      }
    }
    throw lastError || new Error('RCON connection failed');
  }

  async send(command, { allowFail = false } = {}) {
    const attempts = Math.max(1, (this.config.commandRetries || 0) + 1);
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const client = await this.connect();
        return await client.send(command);
      } catch (err) {
        lastError = err;
        await this.resetClient();
        const retryable = isTransientNetworkError(err) || /not connected|socket|closed|timeout/i.test(err?.message || '');
        if (!retryable || attempt >= attempts) break;
        await sleep(this.config.commandRetryMs || 500);
      }
    }

    if (allowFail) {
      console.warn(`[RCON] ignored failed command "${command}": ${lastError?.code || lastError?.message || lastError}`);
      return null;
    }
    throw lastError;
  }

  async resetClient() {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.end();
    } catch {}
  }

  async close() {
    if (!this.client) return;
    try {
      await this.client.end();
    } finally {
      this.client = null;
    }
  }

  isConnected() {
    return !!this.client;
  }

  async prepareEnvironment(config) {
    const env = config.environment;
    await this.send(`difficulty ${env.difficulty}`, { allowFail: true });
    await this.send(`weather ${env.weather}`, { allowFail: true });
    await this.send(`time set ${env.time}`, { allowFail: true });
    for (const [name, value] of Object.entries(env.gamerules || {})) {
      await this.send(`gamerule ${name} ${value}`, { allowFail: true });
    }
    const spawn = env.spawn;
    await this.send(`setworldspawn ${spawn.x} ${spawn.y} ${spawn.z}`, { allowFail: true });
    await this.send(`team add ${config.agents.teamName}`, { allowFail: true });
    await this.send(`team modify ${config.agents.teamName} collisionRule never`, { allowFail: true });
    await this.send(`team modify ${config.agents.teamName} friendlyFire false`, { allowFail: true });
    await this.prepareHumanObservers(config);
  }

  async prepareHumanObservers(config) {
    const mode = config.environment.observerGamemode || 'spectator';
    await this.send(`defaultgamemode ${mode}`, { allowFail: true });
    await this.send('whitelist off', { allowFail: true });
    await this.send('gamerule spectatorsGenerateChunks false', { allowFail: true });
    await this.send(`team leave @a[tag=!${config.agents.rconTag}]`, { allowFail: true });
    await this.send(`gamemode ${mode} @a[tag=!${config.agents.rconTag}]`, { allowFail: true });
  }

  async resetPlayer(username, config, spawnOverride = null) {
    const spawn = spawnOverride || config.environment.spawn;
    const gamemode = config.task.gamemode || config.environment.gamemode;
    await this.send(`gamemode ${gamemode} ${username}`, { allowFail: true });
    await this.send(`effect clear ${username}`, { allowFail: true });
    await this.send(`clear ${username}`, { allowFail: true });
    await this.send(`spawnpoint ${username} ${spawn.x} ${spawn.y} ${spawn.z}`, { allowFail: true });
    await this.send(`tp ${username} ${spawn.x} ${spawn.y} ${spawn.z}`, { allowFail: true });
    await this.send(`team join ${config.agents.teamName} ${username}`, { allowFail: true });
    await this.send(`tag ${username} add ${config.agents.rconTag}`, { allowFail: true });
  }

  async cleanupAgents(config) {
    for (let i = 0; i < config.run.agentCount; i++) {
      const username = `${config.agents.usernamePrefix}${i + 1}`;
      await this.send(`kill ${username}`, { allowFail: true });
    }
  }

  async stopServer() {
    await this.send('stop', { allowFail: true });
  }
}

module.exports = { MinecraftRcon };
