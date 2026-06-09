const path = require('path');
const { nowStamp, pad, ensureDir, writeJson, appendJsonl } = require('../utils');

class RunStore {
  constructor(config) {
    this.config = config;
    this.runDir = null;
  }

  async startRun() {
    this.runDir = path.join(this.config.run.outputDir, `${nowStamp()}-${this.config.run.name}`);
    ensureDir(this.runDir);
    ensureDir(path.join(this.runDir, 'generations'));
    ensureDir(path.join(this.runDir, 'transitions'));
    writeJson(path.join(this.runDir, 'run.json'), {
      name: this.config.run.name,
      startedAt: new Date().toISOString(),
      minecraft: this.config.minecraft,
      run: this.config.run,
      agents: this.config.agents,
      task: this.config.task,
      learning: this.config.learning
    });
    console.log(`Run directory: ${this.runDir}`);
  }

  beginGeneration(generation) {
    const dir = path.join(this.runDir, 'generations', `generation-${pad(generation)}`);
    ensureDir(dir);
    const record = {
      generation,
      dir,
      startedAt: new Date().toISOString()
    };
    writeJson(path.join(dir, 'start.json'), record);
    return record;
  }

  appendTransition(generation, username, transition) {
    const filePath = path.join(
      this.runDir,
      'transitions',
      `generation-${pad(generation)}-${username}.jsonl`
    );
    appendJsonl(filePath, transition);
  }

  endGeneration(record, summary) {
    writeJson(path.join(record.dir, 'summary.json'), summary);
  }

  writeTrainerState(state) {
    writeJson(path.join(this.runDir, 'trainer.json'), state);
  }

  writeCheckpointManifest(generation, taskName, value) {
    const dir = path.join(this.config.run.checkpointDir, taskName, `generation-${pad(generation)}`);
    ensureDir(dir);
    writeJson(path.join(dir, 'manifest.json'), value);
  }
}

module.exports = { RunStore };
