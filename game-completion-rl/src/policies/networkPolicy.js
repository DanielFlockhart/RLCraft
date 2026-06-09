const { VALID_CONTROLS, emptyAction } = require('../runtime/actions');
const { encodeObservation } = require('../learning/observationEncoder');

const ACTION_OUTPUTS = ['attack', 'useItem', 'dig'];
const LOOK_OUTPUTS = 2;

class NetworkPolicy {
  constructor({ genome, config }) {
    this.genome = genome;
    this.config = config;
  }

  async reset() {}

  async act(observation) {
    if (!this.genome) return emptyAction();
    const state = encodeObservation(observation);
    const output = activate(this.genome, state);
    const threshold = this.config.learning.threshold ?? 0.5;
    const action = emptyAction();
    let index = 0;

    for (const control of VALID_CONTROLS) {
      action.controls[control] = (output[index++] || 0) > threshold;
    }

    action.attack = (output[index++] || 0) > threshold;
    action.useItem = (output[index++] || 0) > threshold;
    action.dig = (output[index++] || 0) > threshold;

    const look = this.config.learning.look || {};
    const yaw = centered(output[index++] || 0) * (look.maxYawDelta ?? 0.45);
    const pitch = centered(output[index++] || 0) * (look.maxPitchDelta ?? 0.25);
    action.look = { yawDelta: yaw, pitchDelta: pitch };

    return action;
  }
}

function activate(genome, state) {
  if (typeof genome.propagate === 'function') return genome.propagate(state);
  if (typeof genome.activate === 'function') return genome.activate(state);
  return [];
}

function centered(value) {
  if (value >= 0 && value <= 1) return (value * 2) - 1;
  return Math.max(-1, Math.min(1, value));
}

function outputSize() {
  return VALID_CONTROLS.length + ACTION_OUTPUTS.length + LOOK_OUTPUTS;
}

module.exports = {
  NetworkPolicy,
  outputSize
};
