const mineflayer = require('mineflayer');
const { sleep, errorSummary } = require('../utils');
const { VALID_CONTROLS, normalizeAction } = require('./actions');

class AgentRuntime {
  constructor({ id, username, config, rcon, task, policy }) {
    this.id = id;
    this.username = username;
    this.config = config;
    this.rcon = rcon;
    this.task = task;
    this.policy = policy;
    this.bot = null;
    this.ready = false;
    this.dead = false;
    this.episodeDone = false;
    this.endedReason = null;
    this.lastError = null;
    this.lastObservation = null;
    this.milestones = new Set();
    this.ticks = 0;
    this.digging = false;
  }

  async connect() {
    if (this.bot && this.ready) return;

    let lastError = null;
    const attempts = Math.max(1, this.config.run.agentSpawnRetries || 1);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.disconnect();
        await this.createBotAndWaitForSpawn();
        return;
      } catch (err) {
        lastError = err;
        console.warn(`[${this.username}] spawn attempt ${attempt}/${attempts} failed: ${err?.message || err}`);
        await this.disconnect();
        if (attempt < attempts) {
          await sleep((this.config.run.agentRetryBaseMs || 1000) * attempt);
        }
      }
    }
    throw lastError || new Error(`${this.username} failed to connect`);
  }

  async createBotAndWaitForSpawn() {
    this.ready = false;
    this.dead = false;
    this.episodeDone = false;
    this.endedReason = null;
    this.lastError = null;

    const bot = mineflayer.createBot({
      host: this.config.minecraft.host,
      port: this.config.minecraft.port,
      username: this.username,
      version: this.config.minecraft.version,
      auth: this.config.minecraft.auth,
      checkTimeoutInterval: 60000
    });
    this.bot = bot;
    this.attachPersistentHandlers(bot);
    await this.waitForSpawn(bot, this.config.run.connectTimeoutMs);
  }

  attachPersistentHandlers(bot) {
    bot.on('death', () => {
      this.dead = true;
      this.endedReason = 'death';
    });
    bot.on('end', () => {
      if (this.bot === bot) {
        this.ready = false;
        this.bot = null;
      }
      if (!this.episodeDone && !this.endedReason) this.endedReason = 'end';
    });
    bot.on('kicked', reason => {
      this.endedReason = 'kicked';
      console.warn(`[${this.username}] kicked: ${reason}`);
    });
    bot.on('error', err => {
      this.lastError = err;
      console.warn(`[${this.username}] error: ${err?.code || err?.message || err}`);
    });
  }

  waitForSpawn(bot, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timeout = setTimeout(() => {
        finish(new Error(`${this.username} did not spawn within ${timeoutMs}ms`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        bot.removeListener('spawn', onSpawn);
        bot.removeListener('end', onEnd);
        bot.removeListener('kicked', onKicked);
        bot.removeListener('error', onError);
      };

      const finish = err => {
        if (done) return;
        done = true;
        cleanup();
        if (err) reject(err);
        else resolve();
      };

      const onSpawn = () => {
        if (this.bot === bot) this.ready = true;
        finish();
      };
      const onEnd = () => finish(new Error(`${this.username} disconnected before spawn`));
      const onKicked = reason => finish(new Error(`${this.username} kicked before spawn: ${reason}`));
      const onError = err => finish(err);

      bot.once('spawn', onSpawn);
      bot.once('end', onEnd);
      bot.once('kicked', onKicked);
      bot.once('error', onError);
    });
  }

  async resetForEpisode(generation) {
    this.dead = false;
    this.episodeDone = false;
    this.endedReason = null;
    this.lastError = null;
    this.ticks = 0;
    this.lastObservation = null;
    this.milestones = new Set();
    if (this.policy && typeof this.policy.reset === 'function') {
      await this.policy.reset({ agent: this, generation });
    }
    const spawn = typeof this.task.getSpawnForAgent === 'function'
      ? this.task.getSpawnForAgent(this)
      : null;
    await this.rcon.resetPlayer(this.username, this.config, spawn);
    await sleep(250);
  }

  async tick(context) {
    if (this.episodeDone) {
      return this.doneTransition(context, 'already_done');
    }

    if (!this.bot || !this.ready) {
      this.episodeDone = true;
      return this.doneTransition(context, this.endedReason || 'not_ready');
    }

    try {
      this.ticks += 1;
      const observation = this.task.observe(this.bot, {
        agent: this,
        generation: context.generation,
        tick: this.ticks
      });
      const rewardInfo = this.task.reward(this.lastObservation, observation, this);
      const action = normalizeAction(await this.policy.act(observation, {
        agent: this,
        generation: context.generation,
        tick: this.ticks
      }));
      await this.applyAction(action);

      this.lastObservation = observation;
      const done = this.dead || this.task.isTerminal(observation);
      if (done) {
        this.episodeDone = true;
        await this.stopControls();
      }
      return {
        username: this.username,
        generation: context.generation,
        tick: this.ticks,
        observation,
        action,
        reward: rewardInfo.reward,
        rewardBreakdown: rewardInfo.breakdown,
        done,
        reason: done ? (this.endedReason || 'terminal') : null,
        milestones: Array.from(this.milestones)
      };
    } catch (err) {
      this.lastError = err;
      this.episodeDone = true;
      await this.stopControls();
      return this.doneTransition(context, 'tick_error', err);
    }
  }

  async applyAction(action) {
    for (const control of VALID_CONTROLS) {
      this.bot.setControlState(control, !!action.controls[control]);
    }

    if (typeof action.hotbarSlot === 'number') {
      const slot = Math.max(0, Math.min(8, Math.floor(action.hotbarSlot)));
      this.bot.setQuickBarSlot(slot);
    }

    if (action.look && typeof action.look.yawDelta === 'number') {
      const yaw = (this.bot.entity?.yaw || 0) + action.look.yawDelta;
      const pitch = (this.bot.entity?.pitch || 0) + (action.look.pitchDelta || 0);
      await this.bot.look(yaw, Math.max(-1.57, Math.min(1.57, pitch)), true).catch(() => {});
    }

    if (action.useItem) {
      try {
        this.bot.activateItem();
      } catch {}
    } else {
      try {
        this.bot.deactivateItem();
      } catch {}
    }

    if (action.attack) {
      const target = this.bot.nearestEntity(entity => entity.type === 'mob');
      if (target) {
        try {
          this.bot.attack(target);
        } catch {}
      }
    }

    if (action.dig) {
      this.tryDigTarget();
    }
  }

  tryDigTarget() {
    const bot = this.bot;
    if (!bot || this.digging) return;
    let block = null;
    try {
      block = typeof bot.blockAtCursor === 'function' ? bot.blockAtCursor(this.config.task.lookDistance || 5) : null;
    } catch {
      block = null;
    }
    if (!block || !block.diggable || block.name === 'air') return;
    this.digging = true;
    try {
      const digging = bot.dig(block);
      Promise.resolve(digging).catch(() => {}).finally(() => {
        this.digging = false;
      });
    } catch {
      this.digging = false;
    }
  }

  async stopControls() {
    const bot = this.bot;
    if (!bot) return;
    for (const control of VALID_CONTROLS) {
      try {
        bot.setControlState(control, false);
      } catch {}
    }
    try {
      bot.deactivateItem();
    } catch {}
    try {
      if (this.digging && typeof bot.stopDigging === 'function') bot.stopDigging();
    } catch {}
    this.digging = false;
  }

  doneTransition(context, reason, err = null) {
    return {
      username: this.username,
      generation: context.generation,
      tick: this.ticks,
      observation: this.lastObservation,
      action: null,
      reward: 0,
      rewardBreakdown: { living: 0, milestones: 0, death: 0 },
      done: true,
      reason,
      error: errorSummary(err || this.lastError),
      milestones: Array.from(this.milestones)
    };
  }

  isDone() {
    return this.episodeDone;
  }

  async disconnect() {
    if (!this.bot) return;
    await this.stopControls();
    await new Promise(resolve => {
      const bot = this.bot;
      const timeout = setTimeout(resolve, 1000);
      bot.once('end', () => {
        clearTimeout(timeout);
        resolve();
      });
      try {
        bot.end();
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });
    this.bot = null;
    this.ready = false;
  }
}

module.exports = { AgentRuntime };
