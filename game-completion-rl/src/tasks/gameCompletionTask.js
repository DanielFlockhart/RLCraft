class GameCompletionTask {
  constructor(config) {
    this.config = config;
    this.milestoneDefinitions = [
      ['has_logs', inv => hasAny(inv, name => name.endsWith('_log') || name.endsWith('_stem'))],
      ['has_planks', inv => hasAny(inv, name => name.endsWith('_planks'))],
      ['has_crafting_table', inv => has(inv, 'crafting_table')],
      ['has_wooden_pickaxe', inv => has(inv, 'wooden_pickaxe')],
      ['has_stone_pickaxe', inv => has(inv, 'stone_pickaxe')],
      ['has_iron_ingot', inv => has(inv, 'iron_ingot')],
      ['has_iron_pickaxe', inv => has(inv, 'iron_pickaxe')],
      ['has_diamond', inv => has(inv, 'diamond')],
      ['has_obsidian', inv => has(inv, 'obsidian')],
      ['has_blaze_rod', inv => has(inv, 'blaze_rod')],
      ['has_ender_pearl', inv => has(inv, 'ender_pearl')],
      ['has_ender_eye', inv => has(inv, 'ender_eye')]
    ];
  }

  get id() {
    return this.config.name || 'complete-game';
  }

  observe(bot, context) {
    const inventory = summarizeInventory(bot);
    const milestones = this.evaluateMilestones(inventory, bot);
    const entity = bot.entity;
    const position = entity?.position
      ? {
          x: round(entity.position.x),
          y: round(entity.position.y),
          z: round(entity.position.z)
        }
      : null;

    return {
      tick: context.tick,
      username: bot.username,
      health: numberOr(bot.health, 0),
      food: numberOr(bot.food, 0),
      oxygen: numberOr(bot.oxygenLevel, 0),
      xp: bot.experience ? { level: bot.experience.level || 0, points: bot.experience.points || 0 } : { level: 0, points: 0 },
      position,
      dimension: bot.game?.dimension || 'unknown',
      onGround: !!entity?.onGround,
      isInWater: !!entity?.isInWater,
      isInLava: !!entity?.isInLava,
      heldItem: bot.heldItem?.name || null,
      inventory,
      milestones,
      nearby: summarizeNearby(bot)
    };
  }

  reward(previousObservation, observation, agent) {
    let reward = this.config.livingReward || 0;
    const breakdown = { living: reward, milestones: 0, death: 0 };

    for (const milestone of observation.milestones) {
      if (!agent.milestones.has(milestone)) {
        agent.milestones.add(milestone);
        breakdown.milestones += this.config.milestoneReward || 0;
      } else {
        breakdown.milestones += this.config.repeatedMilestoneReward || 0;
      }
    }

    if (observation.health <= 0) {
      breakdown.death += this.config.deathPenalty || 0;
    }

    reward += breakdown.milestones + breakdown.death;
    return { reward, breakdown };
  }

  isTerminal(observation) {
    return observation.milestones.includes(this.config.terminalMilestone);
  }

  evaluateMilestones(inventory, bot) {
    const milestones = [];
    for (const [name, predicate] of this.milestoneDefinitions) {
      if (predicate(inventory, bot)) milestones.push(name);
    }
    if (bot.game?.dimension === 'minecraft:the_end' || bot.game?.dimension === 'the_end') {
      milestones.push('reached_end');
    }
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

function has(inventory, name) {
  return (inventory[name] || 0) > 0;
}

function hasAny(inventory, predicate) {
  return Object.keys(inventory).some(predicate);
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

module.exports = { GameCompletionTask };
