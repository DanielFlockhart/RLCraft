// Rich sensors with vocab + looking-at, robust guards
const { Vec3 } = require('vec3');
const cfg = require('./config');

function norm(val, min, max){ if (max===min) return 0; const x=(val-min)/(max-min); return x*2-1; }
function bool01(b){ return b?1:0; }
function clamp(v, lo, hi){ return v<lo?lo:(v>hi?hi:v); }
function sincos(a){ return [Math.sin(a), Math.cos(a)]; }
function asVec3(p){ return (p instanceof Vec3) ? p : new Vec3(p?.x||0, p?.y||0, p?.z||0); }
function off(pos, dx,dy,dz){ const v = asVec3(pos); return new Vec3(v.x+dx, v.y+dy, v.z+dz); }

const BLOCK_VOCAB = [
  'air','stone','dirt','grass_block','sand','gravel',
  'oak_log','birch_log','spruce_log','oak_planks',
  'cobblestone','iron_ore','coal_ore','copper_ore',
  'deepslate','water','lava','leaves','glass','snow'
];
const VOCAB_INDEX = new Map(BLOCK_VOCAB.map((n,i)=>[n,i]));

function encodeBlockVocab(block){
  const out = new Array(BLOCK_VOCAB.length + 1).fill(0);
  if (!block) { out[0] = 1; return out; }
  const name = block.name || 'air';
  const idx = VOCAB_INDEX.has(name) ? VOCAB_INDEX.get(name) : BLOCK_VOCAB.length;
  out[idx] = 1;
  return out;
}
function encodeBlockBasic(block){
  if (!block) return [0,0,0,0, 0,0];
  const name = block.name || '';
  const liquid = Number(name.includes('water') || name.includes('lava'));
  const diggable = Number(!!block.diggable);
  const walkable = Number(block.boundingBox === 'block' && !liquid);
  const hardness = block.hardness ?? 0;
  const light = block.light ?? 0;
  const sky = block.skyLight ?? 0;
  return [ norm(hardness, 0, 50), liquid, diggable, walkable, norm(light,0,15), norm(sky,0,15) ];
}

function blockFeature(block){
  if(!block) return [0,0,0,0];
  const name = block.name || '';
  const solid = Number(block.boundingBox === 'block');
  const water = Number(name.includes('water'));
  const lava  = Number(name.includes('lava'));
  const walkable = solid && !water && !lava ? 1 : 0;
  return [solid, water, lava, walkable];
}

function raycastSolid(bot, dir, max=4){
  if(!bot || !bot.entity) return 0;
  const p = asVec3(bot.entity.position);
  for(let i=1;i<=max;i++){
    const b = bot.blockAt && bot.blockAt(off(p, dir.x*i, dir.y*i, dir.z*i));
    if (b && b.boundingBox === 'block') return i;
  }
  return 0;
}
function neighborSolid(bot, dx, dy, dz){
  const b = bot.blockAt && bot.blockAt(off(bot?.entity?.position||new Vec3(0,0,0), dx, dy, dz));
  return b && b.boundingBox === 'block' ? 1 : 0;
}

function getLookingBlock(bot, maxDist = 5){
  if (!bot) return null;
  if (typeof bot.blockAtCursor === 'function') { try { return bot.blockAtCursor(maxDist) || null; } catch { return null; } }
  const e = bot.entity; if(!e) return null;
  const pos = asVec3(e.position);
  const yaw = e.yaw || 0, pitch = e.pitch || 0;
  const dir = { x: Math.cos(yaw)*Math.cos(pitch), y: Math.sin(-pitch), z: Math.sin(yaw)*Math.cos(pitch) };
  for (let i=1; i<=maxDist*4; i++) {
    const p = off(pos, dir.x*i*0.25, dir.y*i*0.25, dir.z*i*0.25);
    const b = bot.blockAt && bot.blockAt(p);
    if (b && b.boundingBox === 'block') return b;
  }
  return null;
}

function hasLineOfSight(bot, from, to, maxDist = 16){
  if (!bot || !from || !to) return 0;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (!dist || dist > maxDist) return 0;
  const steps = Math.max(1, Math.floor(dist / 0.5));
  const sx = dx / steps;
  const sy = dy / steps;
  const sz = dz / steps;
  for (let i = 1; i <= steps; i++){
    const p = new Vec3(from.x + sx * i, from.y + sy * i, from.z + sz * i);
    const b = bot.blockAt && bot.blockAt(p);
    if (b && b.boundingBox === 'block') return 0;
  }
  return 1;
}

function getEntHeldItemName(bot, ent){
  if (!ent) return '';
  const direct = ent.heldItem?.name || ent?.heldItem?.type;
  if (direct) return String(direct);
  if (ent.type === 'player' && ent.username){
    const p = bot?.players?.[ent.username];
    return p?.heldItem?.name || '';
  }
  return '';
}

function getEntOffhandName(bot, ent){
  if (!ent) return '';
  const eq = ent?.equipment || (ent.type === 'player' && ent.username ? bot?.players?.[ent.username]?.entity?.equipment : null);
  const off = Array.isArray(eq) ? (eq[1] || eq[5]) : null;
  return off?.name || '';
}

function getAttackCooldown(bot){
  if (!bot) return 0;
  let v = null;
  if (typeof bot.attackCooldown === 'function'){
    try{ v = bot.attackCooldown(); }catch{}
  }
  if (v === null || v === undefined) v = bot.entity?.attackCooldown;
  if (v === null || v === undefined) v = bot.entity?.attackCooldownProgress;
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return clamp(v, 0, 1);
}

function buildBaseState(bot, spawn, memory){
  if(!bot || !bot.entity){
    const fake = {
      entity: { position: new Vec3(0,0,0), yaw: 0, pitch: 0, velocity: {x:0,y:0,z:0} },
      blockAt(){ return null; },
      time: { timeOfDay: 0 },
      isRaining: false,
      entities: {},
      health: 20,
      food: 20,
      inventory: { slots: [] },
      players: {}
    };
    return buildBaseState(fake, spawn || {x:0,y:0,z:0}, memory);
  }
  const e = bot.entity;
  const pos = asVec3(e.position);

  const rx = clamp(pos.x - spawn.x, -64, 64);
  const ry = clamp(pos.y - spawn.y, -64, 64);
  const rz = clamp(pos.z - spawn.z, -64, 64);

  const [sy, cy] = sincos(e.yaw || 0);
  const [sp, cp] = sincos(e.pitch || 0);

  const vx = clamp(e.velocity?.x || 0, -1.5, 1.5);
  const vy = clamp(e.velocity?.y || 0, -1.5, 1.5);
  const vz = clamp(e.velocity?.z || 0, -1.5, 1.5);

  const tod = ((bot.time && bot.time.timeOfDay) || 0) / 24000 * Math.PI * 2;
  const [st, ct] = sincos(tod);

  const below = bot.blockAt && bot.blockAt(off(pos, 0, -1, 0));
  const feet  = bot.blockAt && bot.blockAt(off(pos, 0,  0, 0));
  const head  = bot.blockAt && bot.blockAt(off(pos, 0,  1, 0));
  const looking = getLookingBlock(bot, 5);

  const bfBelow = blockFeature(below);
  const bfFeet  = blockFeature(feet);
  const bfHead  = blockFeature(head);
  const basicBelow = encodeBlockBasic(below);
  const basicFeet  = encodeBlockBasic(feet);
  const basicHead  = encodeBlockBasic(head);
  const vocabFeet  = encodeBlockVocab(feet);
  const vocabLook  = encodeBlockVocab(looking);

  const yaw = e.yaw || 0;
  const forward = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const right   = { x: Math.cos(yaw + Math.PI/2), y: 0, z: Math.sin(yaw + Math.PI/2) };
  const left    = { x: Math.cos(yaw - Math.PI/2), y: 0, z: Math.sin(yaw - Math.PI/2) };
  const rayF = raycastSolid(bot, forward, 6);
  const rayR = raycastSolid(bot, right,   6);
  const rayL = raycastSolid(bot, left,    6);
  const rayFR = raycastSolid(bot, { x: (forward.x + right.x) * 0.7071, y: 0, z: (forward.z + right.z) * 0.7071 }, 6);
  const rayFL = raycastSolid(bot, { x: (forward.x + left.x) * 0.7071, y: 0, z: (forward.z + left.z) * 0.7071 }, 6);
  const rayBR = raycastSolid(bot, { x: (-forward.x + right.x) * 0.7071, y: 0, z: (-forward.z + right.z) * 0.7071 }, 6);
  const rayBL = raycastSolid(bot, { x: (-forward.x + left.x) * 0.7071, y: 0, z: (-forward.z + left.z) * 0.7071 }, 6);
  const rayU = raycastSolid(bot, {x:0,y:1,z:0}, 3);
  const rayD = raycastSolid(bot, {x:0,y:-1,z:0}, 3);

  const groundAhead = bot.blockAt && bot.blockAt(off(pos, forward.x*1.2, -1, forward.z*1.2));
  const belowY = below ? below.position.y : pos.y-1;
  const aheadY = groundAhead ? groundAhead.position.y : pos.y-1;
  const ledge = clamp(belowY - aheadY, -3, 3);

  // Nearest entities (top 2)
  const candidates = [];
  for (const id in bot.entities) {
    const ent = bot.entities[id];
    if (!ent || ent === e) continue;
    if (ent.type !== 'player' && ent.type !== 'mob') continue;
    const d = ent.position.distanceTo ? ent.position.distanceTo(pos) : Math.hypot(ent.position.x-pos.x, ent.position.z-pos.z);
    const dx = ent.position.x - pos.x;
    const dy = ent.position.y - pos.y;
    const dz = ent.position.z - pos.z;
    candidates.push({ ent, d, dx, dy, dz });
  }
  candidates.sort((a,b)=>a.d-b.d);

  const t1 = candidates[0] || null;

  let facingDot = 0, inMelee = 0, inFov = 0, fovDist = 16, ndx = 0, ndy = 0, ndz = 0, nearestBearing = 0;
  let lineOfSight = 0;
  let oppSword = 0, oppAxe = 0, oppBow = 0, oppShield = 0, oppOther = 0, oppOffhandShield = 0;
  let distB0 = 0, distB1 = 0, distB2 = 0, distB3 = 0;
  let ovx = 0, ovy = 0, ovz = 0;
  let oppSlotNorm = 0;
  const oppSlotOneHot = new Array(9).fill(0);
  if (t1){
    ndx = t1.dx; ndy = t1.dy; ndz = t1.dz;
    nearestBearing = Math.atan2(t1.dz, t1.dx) - yaw;
    const mag = Math.hypot(t1.dx, t1.dz) || 1;
    const nx = t1.dx / mag;
    const nz = t1.dz / mag;
    facingDot = (forward.x * nx) + (forward.z * nz);
    inMelee = t1.d <= 3 ? 1 : 0;
    inFov = (facingDot >= 0.6 && t1.d <= 16) ? 1 : 0;
    fovDist = t1.d;
    lineOfSight = hasLineOfSight(bot, pos, t1.ent?.position, 16);
    const oppHeld = getEntHeldItemName(bot, t1.ent);
    const oppOff = getEntOffhandName(bot, t1.ent);
    oppSword = Number(oppHeld.includes('sword'));
    oppAxe = Number(oppHeld.includes('axe'));
    oppBow = Number(oppHeld === 'bow');
    oppShield = Number(oppHeld === 'shield');
    oppOther = Number(!!oppHeld && !oppSword && !oppAxe && !oppBow && !oppShield);
    oppOffhandShield = Number(oppOff === 'shield');
    const vel = t1.ent?.velocity;
    if (vel){
      ovx = norm(clamp(vel.x || 0, -1.5, 1.5), -1.5, 1.5);
      ovy = norm(clamp(vel.y || 0, -1.5, 1.5), -1.5, 1.5);
      ovz = norm(clamp(vel.z || 0, -1.5, 1.5), -1.5, 1.5);
    }
    const slot = t1.ent?.heldItem?.slot;
    if (typeof slot === 'number'){
      const s = Math.max(0, Math.min(8, slot));
      oppSlotNorm = s / 8;
      oppSlotOneHot[s] = 1;
    }
    distB0 = Number(t1.d < 3);
    distB1 = Number(t1.d >= 3 && t1.d < 6);
    distB2 = Number(t1.d >= 6 && t1.d < 10);
    distB3 = Number(t1.d >= 10 && t1.d <= 16);
  }
  const [sb, cb] = sincos(nearestBearing);
  const nd = t1 ? clamp(t1.d, 0, 16) : 16;

  // No second-nearest entity features in PvP.

  const biome = feet?.biome;
  const biomeId = (typeof biome?.id === 'number') ? biome.id : 0;
  const biomeHash = Math.sin(((biome?.name || 'unknown').split('').reduce((h,ch)=>((h<<5)-h + ch.charCodeAt(0))|0, 0)) * 0.0001);
  const lightFeet = norm(feet?.light ?? 0, 0, 15);
  const skyFeet   = norm(feet?.skyLight ?? 0, 0, 15);

  const health = typeof bot.health === 'number' ? bot.health : 20;
  const food   = typeof bot.food   === 'number' ? bot.food   : 20;
  const held = bot.heldItem;
  const heldName = held?.name || '';
  const offhand = bot.inventory?.slots?.[45];
  const offName = offhand?.name || '';
  const heldSword = heldName.includes('sword') ? 1 : 0;
  const heldBow = heldName === 'bow' ? 1 : 0;
  const heldShield = heldName === 'shield' ? 1 : 0;
  const offhandShield = offName === 'shield' ? 1 : 0;
  const offhandSword = offName.includes('sword') ? 1 : 0;
  const offhandAxe = offName.includes('axe') ? 1 : 0;
  const offhandBow = offName === 'bow' ? 1 : 0;
  const offhandOther = Number(!!offName && !offhandShield && !offhandSword && !offhandAxe && !offhandBow);
  const offhandEmpty = Number(!offName);
  const heldHash = Math.sin(((heldName || 'none').split('').reduce((h,ch)=>((h<<5)-h + ch.charCodeAt(0))|0, 0)) * 0.0001);
  const hotbarSlot = typeof bot.quickBarSlot === 'number' ? bot.quickBarSlot : 0;
  const hotbarOneHot = new Array(9).fill(0);
  if (hotbarSlot >= 0 && hotbarSlot < 9) hotbarOneHot[hotbarSlot] = 1;
  const atkCooldown = getAttackCooldown(bot);
  const atkReady = atkCooldown >= 0.99 ? 1 : 0;
  const mem = memory || null;
  const tick = mem?._tick || 0;
  const sinceDealt = tick - (mem?.lastHitDealtTick ?? -9999);
  const sinceTaken = tick - (mem?.lastHitTakenTick ?? -9999);
  const sinceDealtNorm = norm(clamp(sinceDealt, 0, 200), 0, 200);
  const sinceTakenNorm = norm(clamp(sinceTaken, 0, 200), 0, 200);

  const arenaCenter = mem?.arenaCenter;
  const arenaSize = mem?.arenaSize || (cfg.pvp && cfg.pvp.arenaSize) || 9;
  const half = Math.floor(arenaSize / 2) + 1;
  let wallLeft = 0, wallRight = 0, wallFront = 0, wallBack = 0;
  if (arenaCenter && pos){
    const minX = arenaCenter.x - half;
    const maxX = arenaCenter.x + half;
    const minZ = arenaCenter.z - half;
    const maxZ = arenaCenter.z + half;
    wallLeft = norm(clamp(pos.x - minX, 0, arenaSize + 2), 0, arenaSize + 2);
    wallRight = norm(clamp(maxX - pos.x, 0, arenaSize + 2), 0, arenaSize + 2);
    wallFront = norm(clamp(pos.z - minZ, 0, arenaSize + 2), 0, arenaSize + 2);
    wallBack = norm(clamp(maxZ - pos.z, 0, arenaSize + 2), 0, arenaSize + 2);
  }

  const flags = [
    bool01(e.onGround), bool01(e.isSprinting), bool01(e.isSneaking),
    bool01(e.isSwimming), bool01(e.isInWater), bool01(e.isInLava), bool01(e.isOnFire)
  ];
  const neighbors = [
    neighborSolid(bot,  1, 0,  0),
    neighborSolid(bot, -1, 0,  0),
    neighborSolid(bot,  0, 0,  1),
    neighborSolid(bot,  0, 0, -1)
  ];
  const noise = (Math.random()*2 - 1);

  const pvpSensors = (cfg.experiment === 'pvp' && cfg.pvp && cfg.pvp.sensors) ? cfg.pvp.sensors : null;
  const useAbs = pvpSensors ? !!pvpSensors.useAbsolutePos : true;
  const useTime = pvpSensors ? !!pvpSensors.useTime : true;
  const useBiome = pvpSensors ? !!pvpSensors.useBiome : true;

  const inputs = [
    // Pos/ori/time
    useAbs ? norm(rx,-64,64) : 0,
    useAbs ? norm(ry,-64,64) : 0,
    useAbs ? norm(rz,-64,64) : 0,
    sy, cy, sp, cp,
    useTime ? st : 0,
    useTime ? ct : 0,
    // Vel
    norm(vx,-1.5,1.5), norm(vy,-1.5,1.5), norm(vz,-1.5,1.5),
    // Rays
    norm(rayF,0,6), norm(rayR,0,6), norm(rayL,0,6),
    norm(rayFR,0,6), norm(rayFL,0,6), norm(rayBR,0,6), norm(rayBL,0,6),
    norm(rayU,0,3), norm(rayD,0,3),
    // Block features
    ...bfBelow, ...bfFeet, ...bfHead,
    ...basicBelow, ...basicFeet, ...basicHead,
    ...vocabFeet, ...vocabLook,
    // Ledge & entity
    norm(ledge,-3,3), norm(nd,0,16), sb, cb,
    norm(ndx, -16, 16), norm(ndy, -8, 8), norm(ndz, -16, 16), facingDot, inMelee,
    inFov, norm(fovDist, 0, 16), lineOfSight,
    ovx, ovy, ovz,
    distB0, distB1, distB2, distB3,
    oppSword, oppAxe, oppBow, oppShield, oppOther, oppOffhandShield,
    oppSlotNorm, ...oppSlotOneHot,
    // Biome/light/stats
    useBiome ? norm(biomeId, 0, 200) : 0,
    useBiome ? biomeHash : 0,
    useBiome ? lightFeet : 0,
    useBiome ? skyFeet : 0,
    norm(health,0,20), norm(food,0,20),
    // Weapon context
    heldSword, heldBow, heldShield, offhandShield,
    offhandSword, offhandAxe, offhandBow, offhandOther, offhandEmpty,
    heldHash,
    ...hotbarOneHot,
    atkCooldown, atkReady, sinceDealtNorm, sinceTakenNorm,
    wallLeft, wallRight, wallFront, wallBack,
    // Flags & neighbors & weather & noise
    ...flags, ...neighbors, bool01(bot.isRaining), noise
  ];
  return inputs;
}

function buildState(bot, spawn, history, actionHistory, memory){
  const base = buildBaseState(bot, spawn, memory);
  const histCount = cfg.stateHistory || 0;
  const out = base.slice();
  if (histCount > 0){
    for (let i=0; i<histCount; i++){
      const h = history && history[i] ? history[i] : new Array(base.length).fill(0);
      out.push(...h);
    }
  }
  const actionHistCount = cfg.actionHistory || 0;
  if (actionHistCount > 0){
    const actionSize = cfg.movementControls.length + cfg.actions.length;
    for (let i=0; i<actionHistCount; i++){
      const a = actionHistory && actionHistory[i] ? actionHistory[i] : new Array(actionSize).fill(0);
      out.push(...a);
    }
  }
  const mem = memory || {};
  out.push(
    clamp(mem.lastResult ?? 0, -1, 1),
    norm(mem.lastDamageDealt ?? 0, 0, 20),
    norm(mem.lastDamageTaken ?? 0, 0, 20),
    norm(mem.lastCloseDist ?? 0, 0, 16)
  );
  return out;
}

function stateSizeExample(){
  const fakeBot = {
    entity: { position: new Vec3(0,0,0), yaw: 0, pitch: 0, velocity: {x:0,y:0,z:0} },
    blockAt(){ return null; },
    time: { timeOfDay: 0 },
    isRaining: false,
    entities: {},
    health: 20, food: 20
  };
  return buildState(fakeBot, {x:0,y:0,z:0}, [], [], {}).length;
}

module.exports = { buildBaseState, buildState, stateSizeExample, BLOCK_VOCAB };
