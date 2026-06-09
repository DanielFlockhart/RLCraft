function cageGridSpecs(taskConfig, agentCount) {
  const cage = taskConfig.cage || {};
  const origin = cage.origin || { x: 0, y: 4, z: 0 };
  const size = cage.size || 32;
  const spacing = cage.spacing ?? 8;
  const wallHeight = cage.wallHeight || 8;
  const cols = Math.ceil(Math.sqrt(agentCount));
  const half = Math.floor(size / 2);
  const specs = [];

  for (let i = 0; i < agentCount; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const cx = origin.x + col * (size + spacing);
    const cz = origin.z + row * (size + spacing);
    const minX = cx - half;
    const maxX = minX + size - 1;
    const minZ = cz - half;
    const maxZ = minZ + size - 1;
    const baseY = origin.y;
    specs.push({
      index: i,
      size,
      wallHeight,
      center: { x: cx, y: baseY, z: cz },
      spawn: { x: cx, y: baseY, z: cz },
      minX,
      maxX,
      minZ,
      maxZ,
      baseY,
      floorY: baseY - 1,
      topY: baseY + wallHeight
    });
  }

  return specs;
}

async function buildCageGrid({ rcon, taskConfig, agentCount, decorateCage }) {
  const specs = cageGridSpecs(taskConfig, agentCount);
  const cage = taskConfig.cage || {};
  const floor = cage.floor || 'grass_block';
  const wall = cage.wall || 'glass';
  const roof = cage.roof !== false;

  for (const spec of specs) {
    await clearCage(rcon, spec);
    await rcon.send(`fill ${spec.minX - 1} ${spec.floorY} ${spec.minZ - 1} ${spec.maxX + 1} ${spec.floorY} ${spec.maxZ + 1} ${floor}`, { allowFail: true });
    await rcon.send(`fill ${spec.minX - 1} ${spec.baseY} ${spec.minZ - 1} ${spec.maxX + 1} ${spec.topY} ${spec.minZ - 1} ${wall}`, { allowFail: true });
    await rcon.send(`fill ${spec.minX - 1} ${spec.baseY} ${spec.maxZ + 1} ${spec.maxX + 1} ${spec.topY} ${spec.maxZ + 1} ${wall}`, { allowFail: true });
    await rcon.send(`fill ${spec.minX - 1} ${spec.baseY} ${spec.minZ - 1} ${spec.minX - 1} ${spec.topY} ${spec.maxZ + 1} ${wall}`, { allowFail: true });
    await rcon.send(`fill ${spec.maxX + 1} ${spec.baseY} ${spec.minZ - 1} ${spec.maxX + 1} ${spec.topY} ${spec.maxZ + 1} ${wall}`, { allowFail: true });
    if (roof) {
      await rcon.send(`fill ${spec.minX - 1} ${spec.topY} ${spec.minZ - 1} ${spec.maxX + 1} ${spec.topY} ${spec.maxZ + 1} ${wall}`, { allowFail: true });
    }
    if (decorateCage) await decorateCage(spec);
  }

  return specs;
}

async function maybeResetTrainingArea({ rcon, task, config, generation, agentCount }) {
  if (!config.run.resetWorldEveryGeneration && !(config.run.resetWorldOnTaskStart && generation === 1)) {
    return null;
  }
  return resetTrainingArea({
    rcon,
    taskConfig: task.config,
    config,
    agentCount
  });
}

async function resetTrainingArea({ rcon, taskConfig, config, agentCount }) {
  const bounds = trainingAreaBounds(taskConfig, config, agentCount);
  const area = config.environment.trainingArea || {};
  const floor = area.floor || 'grass_block';
  const airChunkSize = area.airChunkSize || 64;
  const airChunkHeight = area.airChunkHeight || 8;
  let commands = 0;

  await rcon.send('kill @e[type=!player]', { allowFail: true });
  commands += 1;

  for (const [x0, x1] of ranges(bounds.minX, bounds.maxX, airChunkSize)) {
    for (const [z0, z1] of ranges(bounds.minZ, bounds.maxZ, airChunkSize)) {
      for (const [y0, y1] of ranges(bounds.clearMinY, bounds.clearMaxY, airChunkHeight)) {
        await rcon.send(`fill ${x0} ${y0} ${z0} ${x1} ${y1} ${z1} air`, { allowFail: true });
        commands += 1;
      }
      await rcon.send(`fill ${x0} ${bounds.floorY} ${z0} ${x1} ${bounds.floorY} ${z1} ${floor}`, { allowFail: true });
      commands += 1;
    }
  }

  return { ...bounds, commands };
}

function trainingAreaBounds(taskConfig, config, agentCount) {
  const area = config.environment.trainingArea || {};
  const cage = taskConfig.cage || {};
  const origin = cage.origin || config.environment.spawn || { x: 0, y: 4, z: 0 };
  const radius = area.radius || 192;
  const specs = cage.size ? cageGridSpecs(taskConfig, agentCount) : [];
  const pad = Math.max(16, cage.spacing || 0);
  const floorY = Number.isInteger(area.floorY) ? area.floorY : ((origin.y || 4) - 1);
  const clearMinY = Number.isInteger(area.clearMinY) ? area.clearMinY : floorY + 1;
  const clearMaxY = Number.isInteger(area.clearMaxY)
    ? area.clearMaxY
    : Math.max(floorY + 32, ...specs.map(spec => spec.topY + 4));

  let minX = Math.floor(origin.x - radius);
  let maxX = Math.ceil(origin.x + radius);
  let minZ = Math.floor(origin.z - radius);
  let maxZ = Math.ceil(origin.z + radius);
  for (const spec of specs) {
    minX = Math.min(minX, spec.minX - pad);
    maxX = Math.max(maxX, spec.maxX + pad);
    minZ = Math.min(minZ, spec.minZ - pad);
    maxZ = Math.max(maxZ, spec.maxZ + pad);
  }

  return { minX, maxX, minZ, maxZ, floorY, clearMinY, clearMaxY };
}

function ranges(min, max, size) {
  const out = [];
  for (let start = min; start <= max; start += size) {
    out.push([start, Math.min(max, start + size - 1)]);
  }
  return out;
}

async function clearCage(rcon, spec) {
  await rcon.send(`fill ${spec.minX - 2} ${spec.floorY} ${spec.minZ - 2} ${spec.maxX + 2} ${spec.topY + 2} ${spec.maxZ + 2} air`, { allowFail: true });
}

async function buildOakTree(rcon, x, y, z, height = 5) {
  const top = y + height - 1;
  await rcon.send(`fill ${x - 2} ${top - 2} ${z - 2} ${x + 2} ${top} ${z + 2} oak_leaves[persistent=true]`, { allowFail: true });
  await rcon.send(`fill ${x - 1} ${top + 1} ${z - 1} ${x + 1} ${top + 1} ${z + 1} oak_leaves[persistent=true]`, { allowFail: true });
  await rcon.send(`fill ${x} ${y} ${z} ${x} ${top} ${z} oak_log`, { allowFail: true });
}

function insetPoint(spec, dx, dz) {
  return {
    x: clamp(Math.round(spec.center.x + dx), spec.minX + 2, spec.maxX - 2),
    y: spec.baseY,
    z: clamp(Math.round(spec.center.z + dz), spec.minZ + 2, spec.maxZ - 2)
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  buildCageGrid,
  buildOakTree,
  cageGridSpecs,
  maybeResetTrainingArea,
  resetTrainingArea,
  trainingAreaBounds,
  insetPoint
};
