const { BaseTrainingTask } = require('../_base/baseTrainingTask');
const { buildCageGrid, maybeResetTrainingArea } = require('../_base/worldBuilder');

const config = {
  name: 'block_collection',
  label: 'Block Collection',
  targetItems: { dirt: 16, sand: 8, gravel: 8 },
  targetBlockNames: ['dirt', 'grass_block', 'sand', 'gravel'],
  targetBlockSearchDistance: 16,
  lookDistance: 5,
  cage: {
    size: 32,
    spacing: 8,
    wallHeight: 8,
    floor: 'grass_block',
    wall: 'glass',
    roof: true,
    origin: { x: 0, y: 4, z: 0 }
  },
  reward: {
    living: 0.001,
    item: 0.15,
    progress: 0.5,
    completion: 3,
    milestone: 0.2,
    death: -1
  }
};

class BlockCollectionTask extends BaseTrainingTask {
  async prepareEnvironment({ rcon, config, generation, agentCount }) {
    const reset = await maybeResetTrainingArea({ rcon, task: this, config, generation, agentCount });
    if (reset) console.log(`[task:${this.id}] reset training area ${reset.minX},${reset.minZ} -> ${reset.maxX},${reset.maxZ} using ${reset.commands} commands`);
    else await rcon.send('kill @e[type=item]', { allowFail: true });
    const specs = await buildCageGrid({
      rcon,
      taskConfig: this.config,
      agentCount,
      decorateCage: async spec => {
        await rcon.send(`fill ${spec.minX + 3} ${spec.floorY} ${spec.minZ + 3} ${spec.center.x - 2} ${spec.floorY} ${spec.center.z - 2} dirt`, { allowFail: true });
        await rcon.send(`fill ${spec.center.x + 2} ${spec.floorY} ${spec.minZ + 4} ${spec.maxX - 3} ${spec.floorY} ${spec.center.z - 1} sand`, { allowFail: true });
        await rcon.send(`fill ${spec.minX + 4} ${spec.floorY} ${spec.center.z + 2} ${spec.center.x - 1} ${spec.floorY} ${spec.maxZ - 3} gravel`, { allowFail: true });
        await rcon.send(`fill ${spec.center.x + 3} ${spec.baseY} ${spec.center.z + 3} ${spec.center.x + 7} ${spec.baseY + 2} ${spec.center.z + 7} dirt`, { allowFail: true });
      }
    });
    this.agentCages = specs;
    this.agentSpawns = specs.map(spec => ({ ...spec.spawn }));
  }
}

module.exports = {
  config,
  Task: BlockCollectionTask
};
