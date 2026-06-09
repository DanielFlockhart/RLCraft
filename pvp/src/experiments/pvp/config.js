module.exports = {
  experiment: 'pvp',
  populationSize: 48,
  controlHz: 10,
  staggerSpawnMs: 400,
  stateHistory: 3,
  actionHistory: 3,
  pvp: {
    matchMs: 20_000,
    preMatchMs: 1_500,
    arenaSize: 20,
    wallHeight: 5,
    arenaSpacing: 16,
    arenaOrigin: { x: 0, y: 4, z: 0 },
    reward: {
      winBonus: 0.5,
      lossPenalty: -0.5,
      tieBonus: -1.0,
      killBonus: 0.5,
      timeBonus: 1,
      timeExponent: 1.5,
      fovBonus: 0.2,
      facingBonus: 0.1,
      damageDealt: 0.6,
      damageTaken: 0.1,
      damageBlocked: 0.5,
      shieldUse: 0.01,
      arrowShot: 0.01,
      arrowShotCap: 0.05,
      arrowShotK: 3
    },
    sensors: {
      useAbsolutePos: false,
      useTime: false,
      useBiome: false
    },
    opponentsPerAgent: 8,
    restartEveryGenerations: 5
  },
  look: {
    maxYawPerTick: 3.14,
    maxPitchPerTick: 3.14,
    pitchBias: 0,
    pitchCenterRate: 0,
    maxPitchAbs: 1.57,
    pitchLerp: 0.6,
    yawLerp: 0.6
  },
  neat: {
    compatibilityThreshold: 3.0,
    allowRecurrentConnections: true,
    recurrentConnectionRate: 0.4,
    survivalRate: 0.5,
  },
  elitismRatio: 0.15,
  allowDropItem: false
};
