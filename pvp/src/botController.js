const mineflayer=require('mineflayer');
const { Vec3 }=require('vec3');
const cfg=require('./config');
const sensors=require('./sensors');
const { applyTeamAndTag, teleportToSpawn, kickPlayer }=require('./rcon');
const { sleep, backoff } = require('./utils');

function socketWritable(bot){
  try{
    const s = bot?._client?._socket || bot?._client?.socket || bot?._client;
    return s && !s.destroyed && s.writable !== false;
  }catch{ return false; }
}

function nearestAttackable(bot, radius=3){
  if(!bot || !bot.entity) return null;
  const pos=bot.entity.position; let best=null, bestD=Infinity;
  for(const id in bot.entities){
    const ent=bot.entities[id]; if(!ent||ent===bot.entity) continue;
    const isTarget=(ent.type==='mob'||ent.type==='player'); if(!isTarget) continue;
    const d=ent.position.distanceTo(pos); if(d<radius && d<bestD){ best=ent; bestD=d; }
  }
  return best;
}

function isFacingTarget(bot, ent, minDot=0.6){
  if(!bot || !bot.entity || !ent) return false;
  const yaw = bot.entity.yaw || 0;
  const pitch = bot.entity.pitch || 0;
  const fwd = new Vec3(
    -Math.sin(yaw) * Math.cos(pitch),
    -Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch)
  );
  const dx = ent.position.x - bot.entity.position.x;
  const dy = ent.position.y - bot.entity.position.y;
  const dz = ent.position.z - bot.entity.position.z;
  const mag = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / mag;
  const ny = dy / mag;
  const nz = dz / mag;
  const dot = (fwd.x * nx) + (fwd.y * ny) + (fwd.z * nz);
  return dot >= minDot;
}

function maybeJitter(x){
  if (Math.abs(x - cfg.threshold) < 0.05 && Math.random() < cfg.indecisionJitter) return 1 - x;
  return x;
}

function startControlLoop(ind, spawn){
  const period=Math.max(1, Math.floor(1000/cfg.controlHz));
  ind.controlInterval=setInterval(()=>{
    try{
      const bot = ind.bot;
      if(!bot || !bot.entity || !ind.net) return;
      ind._tick = (ind._tick || 0) + 1;
      if(!ind.startMoving){
        if (typeof bot.clearControlStates === 'function') bot.clearControlStates();
        for (const c of cfg.movementControls){ try{ bot.setControlState(c, false); }catch{} }
        return;
      }
      if(!socketWritable(bot)) return;
      if(!ind.stateHistory) ind.stateHistory = [];
      if(!ind.actionHistory) ind.actionHistory = [];
      const state=sensors.buildState(bot, spawn, ind.stateHistory, ind.actionHistory, ind);
      const out=typeof ind.net.propagate === 'function' ? ind.net.propagate(state) : ind.net.activate(state);
      const base = sensors.buildBaseState(bot, spawn, ind);
      ind.stateHistory.unshift(base);
      const maxHist = cfg.stateHistory || 0;
      if (ind.stateHistory.length > maxHist) ind.stateHistory.length = maxHist;
      const actionVec = new Array(cfg.movementControls.length + cfg.actions.length).fill(0);
      for(let i=0;i<cfg.movementControls.length;i++){
        const c = cfg.movementControls[i];
        const v = maybeJitter(out[i] || 0);
        const on = v > cfg.threshold;
        actionVec[i] = on ? 1 : 0;
        bot.setControlState(c, on);
      }
      const off=cfg.movementControls.length;
      const o0 = maybeJitter(out[off+0] || 0);
      const o1 = maybeJitter(out[off+1] || 0);
      const o2 = maybeJitter(out[off+2] || 0);
      const o3 = maybeJitter(out[off+3] || 0);
      const o4 = maybeJitter(out[off+4] || 0);
      const o5 = maybeJitter(out[off+5] || 0);
      const o6 = maybeJitter(out[off+6] || 0);
      const a0 = o0>cfg.threshold;
      const a1 = o1>cfg.threshold;
      const a2 = o2>cfg.threshold;
      const a3 = o3>cfg.threshold;
      const a4 = o4>cfg.threshold;
      const a5 = o5>cfg.threshold;
      const a6 = o6>cfg.threshold;
      actionVec[off+0] = a0 ? 1 : 0;
      actionVec[off+1] = a1 ? 1 : 0;
      actionVec[off+2] = a2 ? 1 : 0;
      actionVec[off+3] = a3 ? 1 : 0;
      actionVec[off+4] = a4 ? 1 : 0;
      actionVec[off+5] = a5 ? 1 : 0;
      actionVec[off+6] = a6 ? 1 : 0;

      if(a0){
        const tgt=nearestAttackable(bot,3);
        if(tgt && isFacingTarget(bot, tgt, 0.6)) bot.attack(tgt);
      }
      const wantOffhand = a6;
      const wantMainhand = !wantOffhand && a1;
      if (wantOffhand){
        if (!ind._usingOffhand) bot.activateItem(true);
        ind._usingOffhand = true;
        ind._usingMainhand = false;
      } else if (wantMainhand){
        if (ind._usingOffhand) bot.deactivateItem();
        ind._usingOffhand = false;
        if (!ind._usingMainhand) bot.activateItem();
        ind._usingMainhand = true;
      } else {
        if (ind._usingOffhand || ind._usingMainhand) bot.deactivateItem();
        if (ind._usingMainhand){
          const held = bot.heldItem?.name;
          if (held === 'bow' || held === 'crossbow'){
            ind.arrowShots = (ind.arrowShots || 0) + 1;
          }
        }
        ind._usingOffhand = false;
        ind._usingMainhand = false;
      }
      if(a2 && cfg.allowDropItem !== false){
        const slot=bot.quickBarSlot+36;
        const stack=bot.inventory.slots[slot];
        if(stack) bot.tossStack(stack).catch(()=>{});
      }
      if(a3){ const item=bot.heldItem; if(item&&item.name&&item.name.endsWith('_block')){ const ref=bot.blockAt(bot.entity.position.offset(0,-1,1)); if(ref) bot.placeBlock(ref,new Vec3(0,1,0)).catch(()=>{});} }
      if(a4){ bot.setQuickBarSlot((bot.quickBarSlot + 8) % 9); }
      if(a5){ bot.setQuickBarSlot((bot.quickBarSlot + 1) % 9); }
      const lookOff = off + cfg.actions.length;
      const lookRange = cfg.look?.outputRange ?? 'auto';
      const normLook = (v)=>{
        if (lookRange === 'zero_one') return (v * 2) - 1;
        if (lookRange === 'auto') return (v >= 0 && v <= 1) ? ((v * 2) - 1) : v;
        return v; // assume already centered around 0
      };
      const ly = maybeJitter(normLook(out[lookOff+0] || 0));
      const lp = maybeJitter(normLook(out[lookOff+1] || 0));
      if (cfg.lookControls && cfg.lookControls.length >= 2){
        const maxYaw = cfg.look?.maxYawPerTick ?? 0.25;
        const maxPitch = cfg.look?.maxPitchPerTick ?? 0.2;
        const yawTarget = (bot.entity.yaw || 0) + (ly * maxYaw);
        const yawLerp = cfg.look?.yawLerp ?? 1.0;
        const yaw = (bot.entity.yaw || 0) + ((yawTarget - (bot.entity.yaw || 0)) * yawLerp);
        const bias = cfg.look?.pitchBias ?? 0;
        const centerRate = cfg.look?.pitchCenterRate ?? 0;
        const maxPitchAbs = cfg.look?.maxPitchAbs ?? 1.0;
        const pitchLerp = cfg.look?.pitchLerp ?? 0.35;
        // In Minecraft/mineflayer, positive pitch is looking down.
        const targetPitch = (lp * maxPitchAbs) + bias;
        let pitch = (bot.entity.pitch || 0) + ((targetPitch - (bot.entity.pitch || 0)) * pitchLerp);
        // Softly pull target toward 0 (level) to avoid sky-lock.
        if (centerRate > 0){
          pitch = pitch + ((0 - pitch) * centerRate);
        }
        if (pitch > 1.57) pitch = 1.57;
        if (pitch < -1.57) pitch = -1.57;
        bot.look(yaw, pitch, true).catch(()=>{});
      }
      const maxActionHist = cfg.actionHistory || 0;
      if (maxActionHist > 0){
        ind.actionHistory.unshift(actionVec);
        if (ind.actionHistory.length > maxActionHist) ind.actionHistory.length = maxActionHist;
      }
      if(ind.startPos){ const d=bot.entity.position.distanceTo(ind.startPos); if(d>ind.maxDist) ind.maxDist=d; }
    }catch(err){ console.error(`❌ [${ind.username}] control error:`, err); }
  }, period);
}

async function respawnWithBackoff(ind, spawn){
  if (ind.respawning) return;
  ind.respawning = true;
  ind.reconnectAttempts = (ind.reconnectAttempts||0) + 1;
  const wait = backoff(ind.reconnectAttempts, cfg.reconnectBaseMs, cfg.reconnectMaxMs);
  console.warn(`[${ind.username}] reconnect in ${wait}ms (attempt ${ind.reconnectAttempts})`);
  await sleep(wait);
  if (ind.lastDuplicateLogin){
    try{ await kickPlayer(ind.username, 'reconnect'); }catch{}
    await sleep(500);
    ind.lastDuplicateLogin = 0;
  }
  try{ if(ind.bot){ ind.bot.end(); } }catch{}
  await spawnBot(ind, spawn);
  ind.respawning = false;
}

async function spawnBot(ind, spawn){
  // reset attempts for a fresh start
  ind.reconnectAttempts = 0;
  ind.shutdown = false;
  ind._tick = 0;
  ind.lastHitDealtTick = -9999;
  ind.lastHitTakenTick = -9999;
  ind._lastHealth = null;
  const bot=mineflayer.createBot({ host:cfg.mc.host, port:cfg.mc.port, username:ind.username, version:cfg.mc.version, auth:cfg.mc.auth, checkTimeoutInterval:3600000 });
  ind.bot=bot; let loopStarted=false;

  bot.on('spawn', async()=>{
    let inited = false;
    for (let i=0; i<6; i++){
      try{
        await teleportToSpawn(ind.username);
        await applyTeamAndTag(ind.username);
        inited = true;
        break;
      }catch(e){
        console.warn(`[${ind.username}] RCON init failed (try ${i+1})`, e?.code||e?.message||e);
        await sleep(500);
      }
    }
    if (!inited){
      console.warn(`[${ind.username}] RCON init never succeeded; bot may be at world spawn.`);
    }
    setTimeout(()=>{
      if(bot.entity){
        ind.startPos=bot.entity.position.clone();
        ind.maxDist=0;
        ind.ready=true;
        ind.startMoving=false;
        if(!loopStarted){ startControlLoop(ind, spawn); loopStarted=true; }
      }
    },1000);
  });

  bot.on('health', ()=>{
    if (typeof bot.health !== 'number') return;
    if (typeof ind._lastHealth === 'number' && bot.health < ind._lastHealth){
      ind.lastHitTakenTick = ind._tick || 0;
    }
    ind._lastHealth = bot.health;
  });

  bot.on('entityHurt', (ent)=>{
    if (!ent || ent === bot.entity) return;
    if (ent.type !== 'player' && ent.type !== 'mob') return;
    const bp = bot.entity?.position;
    const ep = ent.position;
    if (!bp || !ep) return;
    const d = ep.distanceTo ? ep.distanceTo(bp) : Math.hypot(ep.x - bp.x, ep.z - bp.z);
    if (d <= 4){
      ind.lastHitDealtTick = ind._tick || 0;
    }
  });

  bot.on('end', ()=>{
    if(ind.controlInterval){ clearInterval(ind.controlInterval); ind.controlInterval=null; }
    ind.bot=null; ind.ready=false; ind.startMoving=false;
    if (typeof ind.onDeath === 'function') {
      try { ind.onDeath('end'); } catch {}
    }
  });

  bot.on('kicked', (reason)=>{
    console.warn(`[${ind.username}] kicked: ${reason}`);
    if(ind.controlInterval){ clearInterval(ind.controlInterval); ind.controlInterval=null; }
    if (typeof ind.onDeath === 'function') {
      try { ind.onDeath('kicked'); } catch {}
    }
    if (ind.shutdown) return;
    // Duplicate login happens if a stale connection is still registered server-side.
    if (typeof reason === 'string' && reason.includes('duplicate_login')){
      ind.reconnectAttempts = Math.max(ind.reconnectAttempts || 0, 3);
      ind.lastDuplicateLogin = Date.now();
    }
    respawnWithBackoff(ind, spawn);
  });

  bot.on('error', (err)=>{
    const msg = err?.message || '';
    const isTimeout = /timed out/i.test(msg);
    if(err && (err.code==='EPIPE' || err.code==='ECONNRESET' || err.code==='ECONNABORTED' || isTimeout)){
      console.warn(`[${ind.username}] socket error ${err.code}`);
      if(ind.controlInterval){ clearInterval(ind.controlInterval); ind.controlInterval=null; }
      if (typeof ind.onDeath === 'function') {
        try { ind.onDeath('socket'); } catch {}
      }
      if (ind.shutdown) return;
      respawnWithBackoff(ind, spawn);
    } else {
      console.error(`[${ind.username}] error:`, err?.code||err?.message||err);
    }
  });

  bot.on('death', () => {
    if (typeof ind.onDeath === 'function') {
      try { ind.onDeath('death'); } catch {}
    }
  });
}

module.exports={spawnBot};
