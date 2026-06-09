const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const hubRoot = path.resolve(projectRoot, '..');

module.exports = {
  projectRoot,
  hubRoot,
  serverDir: path.join(hubRoot, 'server'),

  minecraft: {
    host: 'localhost',
    port: 25565,
    version: '1.18.1',
    auth: 'offline'
  },

  rcon: {
    host: 'localhost',
    port: 25575,
    password: 'mypassword',
    retries: 90,
    retryMs: 1000,
    timeoutMs: 10000,
    commandRetries: 3,
    commandRetryMs: 500
  },

  run: {
    name: 'game-completion-rl',
    startServer: false,
    serverStartupMs: 5000,
    generations: 3,
    agentCount: 2,
    episodeMs: 60000,
    tickMs: 250,
    saveObservationEveryTicks: 20,
    connectTimeoutMs: 30000,
    agentSpawnRetries: 3,
    agentRetryBaseMs: 1000,
    spawnStaggerMs: 500,
    generationCooldownMs: 2000,
    resetBetweenGenerations: true,
    resetWorldOnTaskStart: true,
    resetWorldEveryGeneration: false,
    phaseTimeoutMs: 300000,
    shutdownGraceMs: 30000,
    serverStopTimeoutMs: 15000,
    outputDir: path.join(projectRoot, 'runs'),
    checkpointDir: path.join(projectRoot, 'checkpoints')
  },

  agents: {
    usernamePrefix: 'QuestAgent',
    teamName: 'gameCompletionAgents',
    rconTag: 'gameCompletionAgent'
  },

  environment: {
    spawn: { x: 0, y: 4, z: 0 },
    difficulty: 'normal',
    gamemode: 'survival',
    observerGamemode: 'spectator',
    trainingArea: {
      radius: 192,
      floorY: 3,
      clearMinY: 4,
      clearMaxY: 32,
      floor: 'grass_block',
      airChunkSize: 64,
      airChunkHeight: 8
    },
    weather: 'clear',
    time: 'day',
    gamerules: {
      spawnRadius: 0,
      keepInventory: true,
      naturalRegeneration: true,
      doDaylightCycle: true,
      doWeatherCycle: false,
      doMobSpawning: true,
      doImmediateRespawn: true
    }
  },

  task: {
    name: 'complete-game'
  },

  learning: {
    populationSize: null,
    elitismRatio: 0.15,
    survivalRate: 0.5,
    mutationRate: 0.6,
    threshold: 0.5,
    saveEveryGeneration: true,
    neat: {
      allowRecurrentConnections: true,
      recurrentConnectionRate: 0.2
    },
    look: {
      maxYawDelta: 0.45,
      maxPitchDelta: 0.25
    }
  }
};
