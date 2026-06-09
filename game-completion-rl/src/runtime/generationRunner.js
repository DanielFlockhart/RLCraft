const { AgentRuntime } = require('./agent');
const { createTrainingTask } = require('../training-tasks');
const { TrainerAdapter } = require('../learning/trainer');
const { sleep, pad, errorSummary, withTimeout } = require('../utils');

class GenerationRunner {
  constructor({ config, rcon, store }) {
    this.config = config;
    this.rcon = rcon;
    this.store = store;
    this.task = createTrainingTask(config.task);
    this.trainer = new TrainerAdapter({ config, store, task: this.task });
    this.agents = [];
  }

  async run() {
    await this.trainer.beginRun();
    try {
      for (let generation = 1; generation <= this.config.run.generations; generation++) {
        await this.runGeneration(generation);
        await sleep(this.config.run.generationCooldownMs);
      }
    } finally {
      await this.close();
    }
  }

  async runGeneration(generation) {
    console.log(`Generation ${generation}/${this.config.run.generations}`);
    const generationRecord = this.store.beginGeneration(generation);
    const startedAt = Date.now();
    const summary = {
      generation,
      agents: {},
      totalReward: 0,
      status: 'running',
      errors: [],
      startedAt: new Date(startedAt).toISOString(),
      episodeStartedAt: null,
      episodeEndedAt: null,
      episodeDurationMs: 0,
      endedAt: null,
      durationMs: 0
    };
    let trainerStarted = false;

    try {
      await this.runPhase(generation, 'server prep', () => this.rcon.prepareEnvironment(this.config));
      await this.runPhase(generation, 'task world prep', async () => {
        if (typeof this.task.prepareEnvironment === 'function') {
          await this.task.prepareEnvironment({
            rcon: this.rcon,
            config: this.config,
            generation,
            agentCount: this.config.run.agentCount
          });
        }
      });
      await this.runPhase(generation, 'trainer prep', () => this.trainer.beginGeneration(generation));
      trainerStarted = true;
      await this.runPhase(generation, 'spawn agents', () => this.spawnAgents(generation));

      for (const agent of this.agents) {
        summary.agents[agent.username] = {
          reward: 0,
          ticks: 0,
          milestones: [],
          done: false,
          reason: null
        };
      }

      const episodeStartedAt = Date.now();
      summary.episodeStartedAt = new Date(episodeStartedAt).toISOString();
      const deadline = episodeStartedAt + this.config.run.episodeMs;
      let step = 0;
      while (Date.now() < deadline) {
        step += 1;
        let active = 0;
        for (const agent of this.agents) {
          if (agent.isDone()) continue;
          const transition = await agent.tick({ generation, step });
          await this.recordTransition(summary, generation, step, transition);
          if (!transition.done) active += 1;
        }
        if (active === 0) break;
        await sleep(this.config.run.tickMs);
      }

      summary.episodeEndedAt = new Date().toISOString();
      summary.episodeDurationMs = Date.now() - episodeStartedAt;
      summary.status = 'completed';
    } catch (err) {
      summary.status = 'failed';
      summary.errors.push(errorSummary(err));
      throw err;
    } finally {
      summary.endedAt = new Date().toISOString();
      summary.durationMs = Date.now() - startedAt;
      if (trainerStarted) {
        try {
          await this.runPhase(generation, 'trainer finalize', () => this.trainer.endGeneration(generation, summary));
        } catch (err) {
          summary.errors.push(errorSummary(err));
          summary.status = 'failed';
        }
      }
      this.store.endGeneration(generationRecord, summary);
      await this.runPhase(generation, 'disconnect agents', () => this.disconnectAgents());
      console.log(`Generation ${pad(generation)} ${summary.status}: reward=${summary.totalReward.toFixed(3)}`);
    }
  }

  async spawnAgents(generation) {
    this.agents = [];
    for (let i = 0; i < this.config.run.agentCount; i++) {
      const username = `${this.config.agents.usernamePrefix}${i + 1}`;
      const policy = this.trainer.createPolicyForAgent(i, username);
      const agent = new AgentRuntime({
        id: i,
        username,
        config: this.config,
        rcon: this.rcon,
        task: this.task,
        policy
      });
      this.agents.push(agent);
      await agent.connect();
      await agent.resetForEpisode(generation);
      await sleep(this.config.run.spawnStaggerMs);
    }
  }

  async disconnectAgents() {
    await Promise.all(this.agents.map(agent => agent.disconnect()));
    this.agents = [];
  }

  async close() {
    await this.disconnectAgents();
  }

  async runPhase(generation, label, operation) {
    const startedAt = Date.now();
    const timeoutMs = this.config.run.phaseTimeoutMs || 300000;
    console.log(`[generation ${pad(generation)}] ${label}...`);
    try {
      const value = await withTimeout(
        Promise.resolve().then(operation),
        timeoutMs,
        `Generation ${pad(generation)} phase "${label}" timed out after ${timeoutMs}ms`
      );
      console.log(`[generation ${pad(generation)}] ${label} done (${Date.now() - startedAt}ms)`);
      return value;
    } catch (err) {
      console.warn(`[generation ${pad(generation)}] ${label} failed after ${Date.now() - startedAt}ms: ${err?.message || err}`);
      throw err;
    }
  }

  async recordTransition(summary, generation, step, transition) {
    const agentSummary = summary.agents[transition.username] || {
      reward: 0,
      ticks: 0,
      milestones: [],
      done: false,
      reason: null
    };
    summary.agents[transition.username] = agentSummary;
    agentSummary.reward += transition.reward || 0;
    agentSummary.ticks = transition.tick || agentSummary.ticks;
    agentSummary.milestones = transition.milestones || agentSummary.milestones;
    agentSummary.done = !!transition.done;
    agentSummary.reason = transition.reason || agentSummary.reason;
    if (transition.error) {
      agentSummary.error = transition.error;
      summary.errors.push({
        agent: transition.username,
        ...transition.error
      });
    }
    summary.totalReward += transition.reward || 0;
    await this.trainer.recordTransition(transition);

    if (this.shouldPersistTransition(step, transition)) {
      this.store.appendTransition(generation, transition.username, compactTransition(transition));
    }
  }

  shouldPersistTransition(step, transition) {
    if (transition.done) return true;
    if (transition.reward && transition.reward !== 0) return true;
    return step % this.config.run.saveObservationEveryTicks === 0;
  }
}

function compactTransition(transition) {
  const obs = transition.observation || {};
  return {
    username: transition.username,
    generation: transition.generation,
    tick: transition.tick,
    reward: transition.reward,
    rewardBreakdown: transition.rewardBreakdown,
    done: transition.done,
    reason: transition.reason,
    error: transition.error,
    action: transition.action,
    observation: {
      health: obs.health,
      food: obs.food,
      position: obs.position,
      dimension: obs.dimension,
      heldItem: obs.heldItem,
      inventory: obs.inventory,
      milestones: obs.milestones,
      task: obs.task,
      lookingBlock: obs.lookingBlock,
      targetBlock: obs.targetBlock
    }
  };
}

module.exports = { GenerationRunner };
