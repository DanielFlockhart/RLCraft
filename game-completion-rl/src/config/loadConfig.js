const defaults = require('./default');
const { getTaskDefaultConfig, listTrainingTasks, normalizeTaskName } = require('../training-tasks');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function floatEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function strEnv(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

function loadConfig() {
  const cfg = clone(defaults);
  const configuredTask = normalizeTaskName(strEnv('TRAINING_TASK', strEnv('TASK', cfg.task.name)));
  const taskOverrides = configuredTask === normalizeTaskName(defaults.task.name) ? cfg.task : { name: configuredTask };
  cfg.task = deepMerge(getTaskDefaultConfig(configuredTask), taskOverrides, { name: configuredTask });

  cfg.minecraft.host = strEnv('MC_HOST', cfg.minecraft.host);
  cfg.minecraft.port = intEnv('MC_PORT', cfg.minecraft.port);
  cfg.minecraft.version = strEnv('MC_VERSION', cfg.minecraft.version);
  cfg.minecraft.auth = strEnv('MC_AUTH', cfg.minecraft.auth);

  cfg.rcon.host = strEnv('RCON_HOST', cfg.rcon.host);
  cfg.rcon.port = intEnv('RCON_PORT', cfg.rcon.port);
  cfg.rcon.password = strEnv('RCON_PASSWORD', cfg.rcon.password);
  cfg.rcon.retries = intEnv('RCON_RETRIES', cfg.rcon.retries);
  cfg.rcon.retryMs = intEnv('RCON_RETRY_MS', cfg.rcon.retryMs);
  cfg.rcon.timeoutMs = intEnv('RCON_TIMEOUT_MS', cfg.rcon.timeoutMs);
  cfg.rcon.commandRetries = intEnv('RCON_COMMAND_RETRIES', cfg.rcon.commandRetries);
  cfg.rcon.commandRetryMs = intEnv('RCON_COMMAND_RETRY_MS', cfg.rcon.commandRetryMs);

  cfg.run.name = strEnv('RUN_NAME', cfg.run.name);
  cfg.run.startServer = boolEnv('START_SERVER', cfg.run.startServer);
  cfg.run.generations = intEnv('GENERATIONS', cfg.run.generations);
  cfg.run.agentCount = intEnv('AGENTS', cfg.run.agentCount);
  cfg.run.episodeMs = intEnv('EPISODE_MS', cfg.run.episodeMs);
  cfg.run.tickMs = intEnv('TICK_MS', cfg.run.tickMs);
  cfg.run.saveObservationEveryTicks = intEnv('SAVE_OBSERVATION_EVERY_TICKS', cfg.run.saveObservationEveryTicks);
  cfg.run.serverStartupMs = intEnv('SERVER_STARTUP_MS', cfg.run.serverStartupMs);
  cfg.run.agentSpawnRetries = intEnv('AGENT_SPAWN_RETRIES', cfg.run.agentSpawnRetries);
  cfg.run.agentRetryBaseMs = intEnv('AGENT_RETRY_BASE_MS', cfg.run.agentRetryBaseMs);
  cfg.run.spawnStaggerMs = intEnv('SPAWN_STAGGER_MS', cfg.run.spawnStaggerMs);
  cfg.run.resetWorldOnTaskStart = boolEnv('RESET_WORLD_ON_TASK_START', cfg.run.resetWorldOnTaskStart);
  cfg.run.resetWorldEveryGeneration = boolEnv('RESET_WORLD_EVERY_GENERATION', cfg.run.resetWorldEveryGeneration);
  cfg.run.phaseTimeoutMs = intEnv('PHASE_TIMEOUT_MS', cfg.run.phaseTimeoutMs);
  cfg.run.shutdownGraceMs = intEnv('SHUTDOWN_GRACE_MS', cfg.run.shutdownGraceMs);
  cfg.run.serverStopTimeoutMs = intEnv('SERVER_STOP_TIMEOUT_MS', cfg.run.serverStopTimeoutMs);

  cfg.learning.populationSize = intEnv('POPULATION_SIZE', cfg.learning.populationSize || cfg.run.agentCount);
  if (process.env.POPULATION_SIZE && !process.env.AGENTS) {
    cfg.run.agentCount = cfg.learning.populationSize;
  }
  cfg.learning.elitismRatio = floatEnv('ELITISM_RATIO', cfg.learning.elitismRatio);
  cfg.learning.survivalRate = floatEnv('SURVIVAL_RATE', cfg.learning.survivalRate);
  cfg.learning.mutationRate = floatEnv('MUTATION_RATE', cfg.learning.mutationRate);
  cfg.learning.threshold = floatEnv('ACTION_THRESHOLD', cfg.learning.threshold);
  cfg.learning.look.maxYawDelta = floatEnv('MAX_YAW_DELTA', cfg.learning.look.maxYawDelta);
  cfg.learning.look.maxPitchDelta = floatEnv('MAX_PITCH_DELTA', cfg.learning.look.maxPitchDelta);

  cfg.agents.usernamePrefix = strEnv('AGENT_PREFIX', cfg.agents.usernamePrefix);
  cfg.environment.difficulty = strEnv('MC_DIFFICULTY', cfg.environment.difficulty);
  cfg.environment.gamemode = strEnv('MC_GAMEMODE', cfg.environment.gamemode);
  cfg.environment.observerGamemode = strEnv('OBSERVER_GAMEMODE', cfg.environment.observerGamemode);
  cfg.environment.trainingArea.radius = intEnv('TRAINING_AREA_RADIUS', cfg.environment.trainingArea.radius);
  cfg.environment.trainingArea.floorY = intEnv('TRAINING_AREA_FLOOR_Y', cfg.environment.trainingArea.floorY);
  cfg.environment.trainingArea.clearMinY = intEnv('TRAINING_AREA_CLEAR_MIN_Y', cfg.environment.trainingArea.clearMinY);
  cfg.environment.trainingArea.clearMaxY = intEnv('TRAINING_AREA_CLEAR_MAX_Y', cfg.environment.trainingArea.clearMaxY);
  cfg.environment.trainingArea.floor = strEnv('TRAINING_AREA_FLOOR', cfg.environment.trainingArea.floor);

  cfg.task.name = configuredTask;
  if (cfg.task.cage) {
    cfg.task.cage.size = intEnv('TASK_CAGE_SIZE', cfg.task.cage.size);
    cfg.task.cage.spacing = intEnv('TASK_CAGE_SPACING', cfg.task.cage.spacing);
    cfg.task.cage.wallHeight = intEnv('TASK_WALL_HEIGHT', cfg.task.cage.wallHeight);
  }
  if (cfg.task.targetItems && process.env.TASK_TARGET_COUNT) {
    const targetCount = intEnv('TASK_TARGET_COUNT', null);
    if (targetCount !== null) {
      const firstKey = Object.keys(cfg.task.targetItems)[0];
      if (firstKey) cfg.task.targetItems[firstKey] = targetCount;
    }
  }

  return validateConfig(cfg);
}

function validateConfig(cfg) {
  const errors = [];
  positiveInt(errors, cfg.minecraft.port, 'minecraft.port');
  positiveInt(errors, cfg.rcon.port, 'rcon.port');
  positiveInt(errors, cfg.rcon.retries, 'rcon.retries');
  positiveInt(errors, cfg.rcon.retryMs, 'rcon.retryMs');
  positiveInt(errors, cfg.rcon.timeoutMs, 'rcon.timeoutMs');
  nonNegativeInt(errors, cfg.rcon.commandRetries, 'rcon.commandRetries');
  positiveInt(errors, cfg.run.generations, 'run.generations');
  positiveInt(errors, cfg.run.agentCount, 'run.agentCount');
  positiveInt(errors, cfg.run.episodeMs, 'run.episodeMs');
  positiveInt(errors, cfg.run.tickMs, 'run.tickMs');
  positiveInt(errors, cfg.run.connectTimeoutMs, 'run.connectTimeoutMs');
  positiveInt(errors, cfg.run.agentSpawnRetries, 'run.agentSpawnRetries');
  positiveInt(errors, cfg.run.phaseTimeoutMs, 'run.phaseTimeoutMs');
  positiveInt(errors, cfg.run.shutdownGraceMs, 'run.shutdownGraceMs');
  positiveInt(errors, cfg.run.serverStopTimeoutMs, 'run.serverStopTimeoutMs');
  positiveInt(errors, cfg.learning.populationSize, 'learning.populationSize');
  positiveNumber(errors, cfg.learning.mutationRate, 'learning.mutationRate');
  positiveNumber(errors, cfg.learning.elitismRatio, 'learning.elitismRatio');
  positiveNumber(errors, cfg.learning.survivalRate, 'learning.survivalRate');

  if (!cfg.minecraft.host) errors.push('minecraft.host is required');
  if (!cfg.rcon.host) errors.push('rcon.host is required');
  if (!cfg.rcon.password) errors.push('rcon.password is required');
  if (!cfg.agents.usernamePrefix) errors.push('agents.usernamePrefix is required');
  if (cfg.run.agentCount !== cfg.learning.populationSize) {
    errors.push('run.agentCount must match learning.populationSize so every agent has one active network');
  }
  if (!listTrainingTasks().includes(cfg.task.name)) {
    errors.push(`task.name must be one of: ${listTrainingTasks().join(', ')}`);
  }

  const spawn = cfg.environment.spawn || {};
  for (const key of ['x', 'y', 'z']) {
    if (typeof spawn[key] !== 'number' || !Number.isFinite(spawn[key])) {
      errors.push(`environment.spawn.${key} must be a finite number`);
    }
  }

  if (cfg.task.cage) {
    positiveInt(errors, cfg.task.cage.size, 'task.cage.size');
    positiveInt(errors, cfg.task.cage.spacing, 'task.cage.spacing');
    positiveInt(errors, cfg.task.cage.wallHeight, 'task.cage.wallHeight');
  }
  const trainingArea = cfg.environment.trainingArea || {};
  positiveInt(errors, trainingArea.radius, 'environment.trainingArea.radius');
  positiveInt(errors, trainingArea.airChunkSize, 'environment.trainingArea.airChunkSize');
  positiveInt(errors, trainingArea.airChunkHeight, 'environment.trainingArea.airChunkHeight');
  if (!Number.isInteger(trainingArea.floorY)) errors.push('environment.trainingArea.floorY must be an integer');
  if (!Number.isInteger(trainingArea.clearMinY)) errors.push('environment.trainingArea.clearMinY must be an integer');
  if (!Number.isInteger(trainingArea.clearMaxY)) errors.push('environment.trainingArea.clearMaxY must be an integer');
  if (trainingArea.clearMaxY < trainingArea.clearMinY) {
    errors.push('environment.trainingArea.clearMaxY must be >= clearMinY');
  }

  if (errors.length) {
    throw new Error(`Invalid game-completion-rl config:\n- ${errors.join('\n- ')}`);
  }
  return cfg;
}

function positiveInt(errors, value, name) {
  if (!Number.isInteger(value) || value <= 0) errors.push(`${name} must be a positive integer`);
}

function nonNegativeInt(errors, value, name) {
  if (!Number.isInteger(value) || value < 0) errors.push(`${name} must be a non-negative integer`);
}

function positiveNumber(errors, value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    errors.push(`${name} must be a positive number`);
  }
}

function deepMerge(...objects) {
  const out = {};
  for (const object of objects) mergeInto(out, object || {});
  return out;
}

function mergeInto(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = mergeInto(target[key] && typeof target[key] === 'object' ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

module.exports = { loadConfig, validateConfig };
