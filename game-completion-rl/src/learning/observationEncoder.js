const INPUT_SIZE = 72;

function encodeObservation(observation) {
  const obs = observation || {};
  const task = obs.task || {};
  const progress = task.progress || {};
  const position = obs.position || {};
  const spawn = task.spawn || {};
  const velocity = obs.velocity || {};
  const targetBlock = obs.targetBlock || {};
  const targetRel = targetBlock.relative || {};
  const lookingBlock = obs.lookingBlock || {};
  const goal = progress.goal || {};
  const inventory = obs.inventory || {};
  const targetItems = task.targetItems || {};

  const vector = [
    norm(obs.health ?? 20, 0, 20),
    norm(obs.food ?? 20, 0, 20),
    norm(obs.oxygen ?? 20, 0, 20),
    norm((position.x ?? 0) - (spawn.x ?? 0), -32, 32),
    norm((position.y ?? 0) - (spawn.y ?? 0), -16, 16),
    norm((position.z ?? 0) - (spawn.z ?? 0), -32, 32),
    norm(velocity.x ?? 0, -1.5, 1.5),
    norm(velocity.y ?? 0, -1.5, 1.5),
    norm(velocity.z ?? 0, -1.5, 1.5),
    Math.sin(obs.yaw || 0),
    Math.cos(obs.yaw || 0),
    Math.sin(obs.pitch || 0),
    Math.cos(obs.pitch || 0),
    bool01(obs.onGround),
    bool01(obs.isInWater),
    bool01(obs.isInLava),
    clamp01(progress.ratio || 0),
    norm(progress.count || 0, 0, Math.max(1, progress.targetCount || 32)),
    bool01(progress.done),
    norm(progress.distance ?? 16, 0, progress.startDistance || 32),
    norm((goal.x ?? position.x ?? 0) - (position.x ?? 0), -32, 32),
    norm((goal.z ?? position.z ?? 0) - (position.z ?? 0), -32, 32),
    bool01(targetBlock.name),
    norm(targetRel.x || 0, -16, 16),
    norm(targetRel.y || 0, -8, 8),
    norm(targetRel.z || 0, -16, 16),
    norm(targetBlock.distance ?? 16, 0, 16),
    bool01(targetBlock.diggable),
    bool01(lookingBlock.name),
    norm(lookingBlock.relative?.x || 0, -6, 6),
    norm(lookingBlock.relative?.y || 0, -6, 6),
    norm(lookingBlock.relative?.z || 0, -6, 6),
    norm(lookingBlock.distance ?? 6, 0, 6),
    bool01(lookingBlock.diggable),
    ...blockCategoryFeatures(targetBlock.name),
    ...blockCategoryFeatures(lookingBlock.name),
    ...heldItemFeatures(obs.heldItem),
    norm(countMatching(inventory, name => name.endsWith('_log') || name.endsWith('_stem')), 0, 16),
    norm(countMatching(inventory, name => ['dirt', 'sand', 'gravel', 'cobblestone'].includes(name)), 0, 32),
    norm(countTargetItems(inventory, targetItems), 0, Math.max(1, sumObject(targetItems) || 32)),
    norm(obs.nearby?.players || 0, 0, 8),
    norm(obs.nearby?.mobs || 0, 0, 8),
    norm(obs.nearby?.items || 0, 0, 16),
    Math.random() * 2 - 1
  ];

  while (vector.length < INPUT_SIZE) vector.push(0);
  if (vector.length > INPUT_SIZE) vector.length = INPUT_SIZE;
  return vector.map(value => Number.isFinite(value) ? value : 0);
}

function blockCategoryFeatures(name) {
  const value = String(name || '');
  return [
    bool01(!value || value === 'air'),
    bool01(value.endsWith('_log') || value.endsWith('_stem')),
    bool01(value.includes('dirt') || value === 'grass_block'),
    bool01(value === 'sand'),
    bool01(value === 'gravel'),
    bool01(value.includes('stone')),
    bool01(value.includes('leaves')),
    bool01(value === 'gold_block' || value === 'sea_lantern'),
    bool01(value && !value.endsWith('_log') && !value.includes('dirt') && value !== 'grass_block' && value !== 'sand' && value !== 'gravel' && !value.includes('stone') && !value.includes('leaves') && value !== 'gold_block' && value !== 'sea_lantern')
  ];
}

function heldItemFeatures(name) {
  const value = String(name || '');
  return [
    bool01(!value),
    bool01(value.endsWith('_log') || value.endsWith('_stem')),
    bool01(['dirt', 'sand', 'gravel', 'cobblestone'].includes(value)),
    bool01(value.includes('axe')),
    bool01(value.includes('pickaxe')),
    bool01(value.includes('shovel')),
    bool01(value.includes('sword'))
  ];
}

function countMatching(inventory, predicate) {
  return Object.entries(inventory || {}).reduce((sum, [name, count]) => {
    return predicate(name) ? sum + count : sum;
  }, 0);
}

function countTargetItems(inventory, targetItems) {
  return Object.keys(targetItems || {}).reduce((sum, name) => sum + (inventory[name] || 0), 0);
}

function sumObject(object) {
  return Object.values(object || {}).reduce((sum, value) => sum + value, 0);
}

function norm(value, min, max) {
  if (max === min) return 0;
  return clamp(((value - min) / (max - min)) * 2 - 1, -1, 1);
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

function bool01(value) {
  return value ? 1 : 0;
}

module.exports = {
  INPUT_SIZE,
  encodeObservation
};
