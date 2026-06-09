class BaseTrainingTask {
  constructor(config) {
    this.config = config;
    this.agentSpawns = [];
    this.agentCages = [];
  }

  get id() {
    return this.config.name;
  }

  async prepareEnvironment() {}

  getSpawnForAgent(agent) {
    return this.agentSpawns[agent.id] || this.config.spawn || null;
  }

  observe(bot, context) {
    const inventory = summarizeInventory(bot);
    const entity = bot.entity;
    const position = entity?.position
      ? {
          x: round(entity.position.x),
          y: round(entity.position.y),
          z: round(entity.position.z)
        }
      : null;
    const velocity = entity?.velocity
      ? {
          x: round(entity.velocity.x || 0),
          y: round(entity.velocity.y || 0),
          z: round(entity.velocity.z || 0)
        }
      : { x: 0, y: 0, z: 0 };
    const targetBlock = findNearestBlock(bot, this.config.targetBlockNames || [], this.config.targetBlockSearchDistance || 16);
    const lookingBlock = summarizeLookingBlock(bot, this.config.lookDistance || 5);
    const spawn = context.agent ? this.getSpawnForAgent(context.agent) : null;
    const cage = context.agent ? this.agentCages[context.agent.id] : null;
    const progress = this.progress({ bot, inventory, position, spawn, cage, context });

    const observation = {
      tick: context.tick,
      username: bot.username,
      task: {
        name: this.id,
        label: this.config.label || this.id,
        progress,
        targetItems: this.config.targetItems || {},
        spawn,
        cage: compactCage(cage)
      },
      health: numberOr(bot.health, 0),
      food: numberOr(bot.food, 0),
      oxygen: numberOr(bot.oxygenLevel, 0),
      position,
      velocity,
      yaw: numberOr(entity?.yaw, 0),
      pitch: numberOr(entity?.pitch, 0),
      dimension: bot.game?.dimension || 'unknown',
      onGround: !!entity?.onGround,
      isInWater: !!entity?.isInWater,
      isInLava: !!entity?.isInLava,
      heldItem: bot.heldItem?.name || null,
      inventory,
      lookingBlock,
      targetBlock,
      nearby: summarizeNearby(bot)
    };
    observation.milestones = this.evaluateMilestones(observation);
    return observation;
  }

  progress({ inventory }) {
    const targetItems = this.config.targetItems || {};
    const count = countItems(inventory, Object.keys(targetItems));
    const targetCount = Object.values(targetItems).reduce((sum, value) => sum + value, 0);
    return {
      count,
      targetCount,
      ratio: targetCount > 0 ? clamp01(count / targetCount) : 0,
      done: targetCount > 0 && count >= targetCount
    };
  }

  reward(previousObservation, observation, agent) {
    const rewardCfg = this.config.reward || {};
    const previousProgress = previousObservation?.task?.progress || {};
    const progress = observation.task.progress || {};
    let reward = rewardCfg.living ?? 0;
    const previousCount = previousProgress.count || 0;
    const currentCount = progress.count || 0;
    const itemDelta = Math.max(0, currentCount - previousCount);
    const ratioDelta = Math.max(0, (progress.ratio || 0) - (previousProgress.ratio || 0));
    const breakdown = {
      living: reward,
      item: itemDelta * (rewardCfg.item || 0),
      progress: ratioDelta * (rewardCfg.progress || 0),
      completion: 0,
      death: 0,
      milestones: 0
    };

    for (const milestone of observation.milestones || []) {
      if (!agent.milestones.has(milestone)) {
        agent.milestones.add(milestone);
        breakdown.milestones += rewardCfg.milestone || 0;
      }
    }

    if (progress.done && !previousProgress.done) {
      breakdown.completion += rewardCfg.completion || 0;
    }
    if (observation.health <= 0) {
      breakdown.death += rewardCfg.death || 0;
    }

    reward += breakdown.item + breakdown.progress + breakdown.completion + breakdown.death + breakdown.milestones;
    return { reward, breakdown };
  }

  isTerminal(observation) {
    return !!observation?.task?.progress?.done;
  }

  evaluateMilestones(observation) {
    const milestones = [];
    const progress = observation.task?.progress || {};
    if ((progress.count || 0) > 0) milestones.push('started');
    if ((progress.ratio || 0) >= 0.5) milestones.push('half_complete');
    if (progress.done) milestones.push('completed');
    return milestones;
  }
}

function summarizeInventory(bot) {
  const out = {};
  const slots = bot.inventory?.slots || [];
  for (const item of slots) {
    if (!item || !item.name) continue;
    out[item.name] = (out[item.name] || 0) + item.count;
  }
  return out;
}

function summarizeNearby(bot) {
  const entities = { players: 0, mobs: 0, items: 0 };
  for (const entity of Object.values(bot.entities || {})) {
    if (!entity || entity === bot.entity) continue;
    if (entity.type === 'mob') entities.mobs += 1;
    if (isDroppedItemEntity(entity)) entities.items += 1;
  }
  return entities;
}

function isDroppedItemEntity(entity) {
  return entity.name === 'item' || entity.displayName === 'Item';
}

function summarizeLookingBlock(bot, maxDistance) {
  let block = null;
  try {
    block = typeof bot.blockAtCursor === 'function' ? bot.blockAtCursor(maxDistance) : null;
  } catch {
    block = null;
  }
  return summarizeBlock(bot, block);
}

function findNearestBlock(bot, names, maxDistance) {
  if (!bot || !Array.isArray(names) || names.length === 0 || typeof bot.findBlock !== 'function') {
    return null;
  }
  const wanted = new Set(names);
  try {
    const block = bot.findBlock({
      matching: candidate => candidate && wanted.has(candidate.name),
      maxDistance,
      count: 1
    });
    return summarizeBlock(bot, block);
  } catch {
    return null;
  }
}

function summarizeBlock(bot, block) {
  if (!block) return null;
  const pos = block.position;
  const self = bot.entity?.position;
  const dx = self && pos ? pos.x - self.x : 0;
  const dy = self && pos ? pos.y - self.y : 0;
  const dz = self && pos ? pos.z - self.z : 0;
  return {
    name: block.name || 'unknown',
    diggable: !!block.diggable,
    position: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
    relative: { x: round(dx), y: round(dy), z: round(dz) },
    distance: round(Math.sqrt((dx * dx) + (dy * dy) + (dz * dz)))
  };
}

function compactCage(cage) {
  if (!cage) return null;
  return {
    index: cage.index,
    size: cage.size,
    center: cage.center,
    minX: cage.minX,
    maxX: cage.maxX,
    minZ: cage.minZ,
    maxZ: cage.maxZ
  };
}

function countItems(inventory, names) {
  return names.reduce((sum, name) => sum + (inventory[name] || 0), 0);
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

module.exports = {
  BaseTrainingTask,
  countItems,
  clamp01
};
