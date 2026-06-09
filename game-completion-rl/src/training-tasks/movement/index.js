const { BaseTrainingTask, clamp01 } = require('../_base/baseTrainingTask');
const { buildCageGrid, maybeResetTrainingArea } = require('../_base/worldBuilder');

const config = {
  name: 'movement',
  label: 'Movement',
  targetBlockNames: ['gold_block', 'sea_lantern'],
  targetBlockSearchDistance: 24,
  lookDistance: 6,
  cage: {
    size: 32,
    spacing: 8,
    wallHeight: 7,
    floor: 'smooth_stone',
    wall: 'glass',
    roof: true,
    origin: { x: 0, y: 4, z: 0 }
  },
  goalRadius: 2.5,
  reward: {
    living: 0,
    progress: 1.5,
    movement: 0.01,
    completion: 5,
    milestone: 0.25,
    death: -1
  }
};

class MovementTask extends BaseTrainingTask {
  constructor(taskConfig) {
    super(taskConfig);
    this.goals = [];
  }

  async prepareEnvironment({ rcon, config, generation, agentCount }) {
    const reset = await maybeResetTrainingArea({ rcon, task: this, config, generation, agentCount });
    if (reset) console.log(`[task:${this.id}] reset training area ${reset.minX},${reset.minZ} -> ${reset.maxX},${reset.maxZ} using ${reset.commands} commands`);
    else await rcon.send('kill @e[type=item]', { allowFail: true });
    const specs = await buildCageGrid({
      rcon,
      taskConfig: this.config,
      agentCount,
      decorateCage: async spec => {
        const goal = goalForSpec(spec);
        await rcon.send(`fill ${goal.x - 1} ${spec.floorY} ${goal.z - 1} ${goal.x + 1} ${spec.floorY} ${goal.z + 1} gold_block`, { allowFail: true });
        await rcon.send(`setblock ${goal.x} ${spec.baseY} ${goal.z} sea_lantern`, { allowFail: true });
        await rcon.send(`fill ${spec.center.x - 1} ${spec.baseY} ${spec.center.z - 5} ${spec.center.x + 1} ${spec.baseY + 1} ${spec.center.z - 3} stone_bricks`, { allowFail: true });
        await rcon.send(`fill ${spec.center.x - 1} ${spec.baseY} ${spec.center.z + 3} ${spec.center.x + 1} ${spec.baseY + 1} ${spec.center.z + 5} stone_bricks`, { allowFail: true });
      }
    });
    this.agentCages = specs;
    this.agentSpawns = specs.map(startForSpec);
    this.goals = specs.map(goalForSpec);
  }

  progress({ position, context }) {
    const id = context.agent?.id || 0;
    const spawn = this.agentSpawns[id];
    const goal = this.goals[id];
    if (!position || !spawn || !goal) {
      return { distance: null, startDistance: null, ratio: 0, done: false, goal };
    }
    const distance = horizontalDistance(position, goal);
    const startDistance = Math.max(1, horizontalDistance(spawn, goal));
    const ratio = clamp01(1 - (distance / startDistance));
    return {
      distance,
      startDistance,
      ratio,
      done: distance <= (this.config.goalRadius || 2.5),
      goal
    };
  }

  reward(previousObservation, observation, agent) {
    const rewardCfg = this.config.reward || {};
    const prev = previousObservation?.task?.progress || {};
    const cur = observation.task.progress || {};
    let reward = rewardCfg.living ?? 0;
    const progressDelta = Math.max(0, (cur.ratio || 0) - (prev.ratio || 0));
    const movement = distanceMoved(previousObservation?.position, observation.position);
    const breakdown = {
      living: reward,
      progress: progressDelta * (rewardCfg.progress || 0),
      movement: movement * (rewardCfg.movement || 0),
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
    if (cur.done && !prev.done) breakdown.completion += rewardCfg.completion || 0;
    if (observation.health <= 0) breakdown.death += rewardCfg.death || 0;
    reward += breakdown.progress + breakdown.movement + breakdown.completion + breakdown.death + breakdown.milestones;
    return { reward, breakdown };
  }

  evaluateMilestones(observation) {
    const progress = observation.task?.progress || {};
    const milestones = [];
    if ((progress.ratio || 0) >= 0.25) milestones.push('quarter_distance');
    if ((progress.ratio || 0) >= 0.5) milestones.push('half_distance');
    if ((progress.ratio || 0) >= 0.75) milestones.push('three_quarter_distance');
    if (progress.done) milestones.push('goal_reached');
    return milestones;
  }
}

function startForSpec(spec) {
  return { x: spec.minX + 3, y: spec.baseY, z: spec.center.z };
}

function goalForSpec(spec) {
  return { x: spec.maxX - 3, y: spec.baseY, z: spec.center.z };
}

function horizontalDistance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0));
}

function distanceMoved(a, b) {
  if (!a || !b) return 0;
  return Math.min(2, horizontalDistance(a, b));
}

module.exports = {
  config,
  Task: MovementTask
};
