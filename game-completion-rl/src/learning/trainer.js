const fs = require('fs');
const path = require('path');
const { Config, Population, GenomeBuilder } = require('neat-javascript');
const { ensureDir, writeJson } = require('../utils');
const { INPUT_SIZE } = require('./observationEncoder');
const { NetworkPolicy, outputSize } = require('../policies/networkPolicy');

class TrainerAdapter {
  constructor({ config, store, task }) {
    this.config = config;
    this.store = store;
    this.task = task;
    this.transitionCount = 0;
    this.population = null;
    this.populationPath = path.join(config.run.checkpointDir, task.id, 'population.json');
    this.agentOrder = [];
    this.generationRewards = new Map();
  }

  async beginRun() {
    ensureDir(path.dirname(this.populationPath));
    this.population = this.loadPopulation() || this.createPopulation();
    this.store.writeTrainerState({
      status: 'active',
      algorithm: 'neat-javascript',
      task: this.task.id,
      populationPath: this.populationPath,
      populationSize: this.config.learning.populationSize,
      inputSize: INPUT_SIZE,
      outputSize: outputSize()
    });
  }

  createPolicyForAgent(index, username) {
    if (!this.population) throw new Error('TrainerAdapter.beginRun() must run before policies are created');
    const genome = this.population.genomes[index];
    if (!genome) throw new Error(`No genome available for ${username} at index ${index}`);
    this.agentOrder[index] = username;
    return new NetworkPolicy({ genome, config: this.config });
  }

  async beginGeneration() {
    this.generationRewards = new Map();
  }

  async recordTransition(transition) {
    this.transitionCount += 1;
    if (!transition || !transition.username) return;
    const total = this.generationRewards.get(transition.username) || 0;
    this.generationRewards.set(transition.username, total + (transition.reward || 0));
  }

  async endGeneration(generation, summary) {
    const fitness = this.writeFitness(summary);
    const best = fitness.length ? fitness.reduce((a, b) => (b.fitness > a.fitness ? b : a), fitness[0]) : null;
    if (typeof this.population.evolve === 'function') this.population.evolve();
    if (this.config.learning.saveEveryGeneration !== false) this.savePopulation();
    this.store.writeCheckpointManifest(generation, this.task.id, {
      generation,
      task: this.task.id,
      transitionCount: this.transitionCount,
      totalReward: summary.totalReward,
      populationPath: this.populationPath,
      populationGeneration: this.population.generation || generation,
      inputSize: INPUT_SIZE,
      outputSize: outputSize(),
      best,
      fitness,
      implemented: true
    });
  }

  createPopulation() {
    return new Population(this.makeNeatConfig());
  }

  loadPopulation() {
    if (!fs.existsSync(this.populationPath)) return null;
    try {
      const raw = fs.readFileSync(this.populationPath, 'utf8');
      const data = JSON.parse(raw);
      if (data.task && data.task !== this.task.id) return null;
      if (data.inputSize && data.inputSize !== INPUT_SIZE) return null;
      if (data.outputSize && data.outputSize !== outputSize()) return null;
      if (!Array.isArray(data.genomes) || data.genomes.length !== this.config.learning.populationSize) return null;
      const config = this.makeNeatConfig();
      const population = new Population(config);
      population.genomes = data.genomes.map(genome => GenomeBuilder.loadGenome(genome, config));
      if (typeof data.generation === 'number') population.generation = data.generation;
      if (typeof population.speciate === 'function') population.speciate();
      return population;
    } catch (err) {
      console.warn(`[trainer] ignoring unreadable population ${this.populationPath}: ${err?.message || err}`);
      return null;
    }
  }

  savePopulation() {
    writeJson(this.populationPath, {
      task: this.task.id,
      generation: this.population.generation || 0,
      inputSize: INPUT_SIZE,
      outputSize: outputSize(),
      genomes: this.population.genomes.map(genome => genome.toJSON())
    });
  }

  makeNeatConfig() {
    const populationSize = this.config.learning.populationSize;
    return new Config({
      inputSize: INPUT_SIZE,
      outputSize: outputSize(),
      populationSize,
      numOfElite: Math.max(1, Math.floor(populationSize * this.config.learning.elitismRatio)),
      survivalRate: this.config.learning.survivalRate,
      mutationRate: this.config.learning.mutationRate,
      ...(this.config.learning.neat || {})
    });
  }

  writeFitness(summary) {
    const fitness = [];
    for (let i = 0; i < this.population.genomes.length; i++) {
      const username = this.agentOrder[i] || `${this.config.agents.usernamePrefix}${i + 1}`;
      const agentSummary = summary.agents?.[username] || {};
      const reward = numberOr(agentSummary.reward, this.generationRewards.get(username) || 0);
      this.population.genomes[i].fitness = reward;
      fitness.push({ username, index: i, fitness: reward });
    }
    return fitness.sort((a, b) => b.fitness - a.fitness);
  }
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

module.exports = { TrainerAdapter };
