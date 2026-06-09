const path = require('path');

const projectRoot = path.resolve(__dirname, '../../..');

module.exports = {
  mc: { host: 'localhost', port: 25565, version: '1.18.1', auth: 'offline' },
  rcon: { host: 'localhost', port: 25575, password: 'mypassword' },
  // Superflat ground is around y=3, so spawn at y=4 to avoid fall damage.
  spawn: { x: 0, y: 4, z: 150 },

  // NEAT
  populationSize: 36,
  startGenerationMs: 30_000,
  maxGenerations: 1_000,
  maxGenerationMs: 3_600_000,
  elitismRatio: 0.1,
  mutationRate: 0.6,

  // Control loop
  controlHz: 12,
  threshold: 0.25,
  indecisionJitter: 0.1,
  startDelayMs: 4_000,      
                              
  // Controls
  movementControls: ['forward','back','left','right','jump','sprint','sneak'],
  actions: ['attack','useItem','dropItem','placeBlock','prevSlot','nextSlot','useOffhand'],
  lookControls: ['yaw','pitch'],
  look: { maxYawPerTick: 0.25, maxPitchPerTick: 0.2, pitchBias: 0.08, pitchCenterRate: 0.04 },
  stateHistory: 2,
  allowDropItem: true,

  // Robustness/backoff
  staggerSpawnMs: 250,
  preRespawnCooldownMs: 5_000,
  rconKillTag: 'gaBot',
  teamName: 'noCollision',
  reconnectBaseMs: 1000,
  reconnectMaxMs: 10000,
  rconRetry: 3,
  rconRetryBaseMs: 300,

  seed: null
  ,
  populationSavePath: path.join(projectRoot, 'artifacts', 'population.json'),
  saveEveryGeneration: true,

  neat: {
    allowRecurrentConnections: true,
    recurrentConnectionRate: 0.4
  }
};
