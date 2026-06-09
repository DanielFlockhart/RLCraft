const { BaseTrainingTask } = require('../_base/baseTrainingTask');
const { buildCageGrid, buildOakTree, insetPoint, maybeResetTrainingArea } = require('../_base/worldBuilder');

const config = {
  name: 'wood_collection',
  label: 'Wood Collection',
  targetItems: { oak_log: 8 },
  targetBlockNames: ['oak_log'],
  targetBlockSearchDistance: 18,
  lookDistance: 6,
  cage: {
    size: 32,
    spacing: 8,
    wallHeight: 9,
    floor: 'grass_block',
    wall: 'glass',
    roof: true,
    origin: { x: 0, y: 4, z: 0 }
  },
  reward: {
    living: 0.001,
    item: 0.25,
    progress: 0.5,
    completion: 3,
    milestone: 0.25,
    death: -1
  }
};

class WoodCollectionTask extends BaseTrainingTask {
  async prepareEnvironment({ rcon, config, generation, agentCount }) {
    const reset = await maybeResetTrainingArea({ rcon, task: this, config, generation, agentCount });
    if (reset) console.log(`[task:${this.id}] reset training area ${reset.minX},${reset.minZ} -> ${reset.maxX},${reset.maxZ} using ${reset.commands} commands`);
    else await rcon.send('kill @e[type=item]', { allowFail: true });
    const specs = await buildCageGrid({
      rcon,
      taskConfig: this.config,
      agentCount,
      decorateCage: async spec => {
        const offsets = [
          [-8, -7],
          [7, -5],
          [-5, 8],
          [9, 7]
        ];
        for (const [dx, dz] of offsets) {
          const pos = insetPoint(spec, dx, dz);
          await buildOakTree(rcon, pos.x, spec.baseY, pos.z, 5);
        }
      }
    });
    this.agentCages = specs;
    this.agentSpawns = specs.map(spec => ({ ...spec.spawn }));
  }
}

module.exports = {
  config,
  Task: WoodCollectionTask
};
