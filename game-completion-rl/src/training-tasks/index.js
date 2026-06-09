const { GameCompletionTask } = require('../tasks/gameCompletionTask');

const definitions = {
  'complete-game': {
    config: {
      name: 'complete-game',
      label: 'Complete Game',
      terminalMilestone: 'dragon_killed',
      livingReward: 0.001,
      deathPenalty: -1,
      milestoneReward: 1,
      repeatedMilestoneReward: 0
    },
    Task: GameCompletionTask
  },
  wood_collection: require('./wood_collection'),
  block_collection: require('./block_collection'),
  movement: require('./movement')
};

const aliases = {
  complete_game: 'complete-game',
  complete: 'complete-game',
  wood: 'wood_collection',
  logs: 'wood_collection',
  block: 'block_collection',
  blocks: 'block_collection',
  move: 'movement'
};

function normalizeTaskName(name) {
  const raw = String(name || 'complete-game').trim();
  return aliases[raw] || raw;
}

function getTaskDefinition(name) {
  const normalized = normalizeTaskName(name);
  const definition = definitions[normalized];
  if (!definition) {
    throw new Error(`Unknown training task "${name}". Available tasks: ${listTrainingTasks().join(', ')}`);
  }
  return definition;
}

function createTrainingTask(taskConfig) {
  const definition = getTaskDefinition(taskConfig.name);
  const Task = definition.Task;
  return new Task(taskConfig);
}

function getTaskDefaultConfig(name) {
  return clone(getTaskDefinition(name).config);
}

function listTrainingTasks() {
  return Object.keys(definitions);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  createTrainingTask,
  getTaskDefaultConfig,
  getTaskDefinition,
  listTrainingTasks,
  normalizeTaskName
};
