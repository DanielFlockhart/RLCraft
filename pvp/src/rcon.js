const { Rcon } = require('rcon-client');
const cfg = require('./config');
const { sleep, backoff } = require('./utils');

let rcon=null;
let connecting=false;
let worldSpawnSet=false;

async function initRcon(){
  if (rcon && rcon.socket && !rcon.socket.destroyed) return rcon;
  if (connecting) { // wait until existing connect finishes
    while (connecting) await sleep(50);
    return rcon;
  }
  connecting = true;
  try{
    rcon = new Rcon({ host: cfg.rcon.host, port: cfg.rcon.port, password: cfg.rcon.password });
    await rcon.connect();
    rcon.on('error', err => console.warn('[RCON] error', err?.code||err?.message||err));
    rcon.on('end',   ()  => console.warn('[RCON] end'));
    if (!worldSpawnSet){
      try{
        await serverCmd(`setworldspawn ${cfg.spawn.x} ${cfg.spawn.y} ${cfg.spawn.z}`);
        await serverCmd('gamerule spawnRadius 0');
        await serverCmd('gamerule naturalRegeneration false');
        await serverCmd('gamerule doWeatherCycle false');
        await serverCmd('weather clear');
        const sx = cfg.spawn.x, sy = cfg.spawn.y, sz = cfg.spawn.z;
        const half = 16;
        const y0 = sy - 1;
        await serverCmd(`fill ${sx-half} ${y0} ${sz-half} ${sx+half} ${y0} ${sz+half} smooth_stone`);
        await serverCmd(`fill ${sx-half} ${sy} ${sz-half} ${sx+half} ${sy+5} ${sz+half} air`);
        worldSpawnSet = true;
      }catch(e){
        console.warn('[RCON] setworldspawn failed', e?.code||e?.message||e);
      }
    }
    return rcon;
  } finally {
    connecting = false;
  }
}

async function serverCmd(cmd, retries = cfg.rconRetry, attempt = 0){
  try{
    const c = await initRcon();
    return await c.send(cmd);
  } catch (err){
    const transient = ['EPIPE','ECONNRESET','ECONNREFUSED','ETIMEDOUT'].includes(err?.code);
    if (retries > 0 && transient){
      const wait = backoff(attempt, cfg.rconRetryBaseMs, cfg.reconnectMaxMs);
      console.warn(`[RCON] ${err.code} on "${cmd}", retrying in ${wait}ms (left ${retries-1})`);
      await sleep(wait);
      try{ if (rcon) await rcon.end(); } catch {}
      rcon = null;
      return serverCmd(cmd, retries-1, attempt+1);
    }
    console.error('[RCON] command failed:', cmd, err);
    throw err;
  }
}

async function ensureTeamSetup(){
  try{ await serverCmd(`team add ${cfg.teamName}`); }catch{}
  await serverCmd(`team modify ${cfg.teamName} collisionRule pushOtherTeams`);
  await serverCmd(`team modify ${cfg.teamName} friendlyFire true`);
}
async function applyTeamAndTag(username){
  await ensureTeamSetup();
  await serverCmd(`team join ${cfg.teamName} ${username}`);
  await serverCmd(`tag ${username} add ${cfg.rconKillTag}`);
}
async function teleportToSpawn(username){
  const {x,y,z} = cfg.spawn;
  await serverCmd(`tp ${username} ${x} ${y} ${z}`);
}
async function teleportTo(username, pos, facing){
  const {x,y,z} = pos;
  if (facing && typeof facing.x === 'number' && typeof facing.y === 'number' && typeof facing.z === 'number'){
    await serverCmd(`tp ${username} ${x} ${y} ${z} facing ${facing.x} ${facing.y} ${facing.z}`);
  } else {
    await serverCmd(`tp ${username} ${x} ${y} ${z}`);
  }
}
async function clearPlayer(username){ await serverCmd(`clear ${username}`); }
async function kickPlayer(username, reason){
  const msg = reason ? ` "${reason}"` : '';
  await serverCmd(`kick ${username}${msg}`);
}
async function healPlayer(username){
  await serverCmd(`effect clear ${username}`);
  await serverCmd(`effect give ${username} minecraft:instant_health 1 255 true`);
  await serverCmd(`effect give ${username} minecraft:saturation 1 255 true`);
}
async function freezePlayer(username){
  await serverCmd(`effect give ${username} minecraft:slowness 1 255 true`);
}
async function equipIronPvpKit(username){
  await serverCmd(`give ${username} minecraft:stone_sword 1`);
  await serverCmd(`give ${username} minecraft:stone_axe 1`);
  await serverCmd(`give ${username} minecraft:bow{Enchantments:[{id:"minecraft:power",lvl:2}]} 1`);
  await serverCmd(`give ${username} minecraft:arrow 64`);
  await serverCmd(`item replace entity ${username} weapon.offhand with minecraft:shield 1`);
  await serverCmd(`item replace entity ${username} armor.head with minecraft:diamond_helmet 1`);
  await serverCmd(`item replace entity ${username} armor.chest with minecraft:diamond_chestplate 1`);
  await serverCmd(`item replace entity ${username} armor.legs with minecraft:diamond_leggings 1`);
  await serverCmd(`item replace entity ${username} armor.feet with minecraft:diamond_boots 1`);
}
async function ensureScoreboardObjective(name, displayName){
  try{ await serverCmd(`scoreboard objectives add ${name} dummy`); }catch{}
  if (displayName) await serverCmd(`scoreboard objectives modify ${name} displayname ${displayName}`);
  await serverCmd(`scoreboard objectives setdisplay sidebar ${name}`);
}
async function ensureScoreboardObjectiveCriteria(name, criteria, displayName){
  try{ await serverCmd(`scoreboard objectives add ${name} ${criteria}`); }catch{}
  if (displayName) await serverCmd(`scoreboard objectives modify ${name} displayname ${displayName}`);
}
async function resetScoreboardObjective(name, displayName){
  try{ await serverCmd(`scoreboard objectives remove ${name}`); }catch{}
  await ensureScoreboardObjective(name, displayName);
}
async function setScore(username, objective, score){
  const val = Number.isFinite(score) ? Math.floor(score) : 0;
  await serverCmd(`scoreboard players set ${username} ${objective} ${val}`);
}
async function getScore(username, objective){
  const res = await serverCmd(`scoreboard players get ${username} ${objective}`);
  const m = (typeof res === 'string') ? res.match(/-?\d+/) : null;
  return m ? Number(m[0]) : 0;
}
async function sendTitle(username, title, subtitle){
  if (subtitle) await serverCmd(`title ${username} subtitle ${subtitle}`);
  await serverCmd(`title ${username} title ${title}`);
}
async function setGamemode(username, mode='survival'){ await serverCmd(`gamemode ${mode} ${username}`); }
async function killAllBots(){ await serverCmd(`kill @e[tag=${cfg.rconKillTag}]`); }
async function clearDroppedItems(){ await serverCmd('kill @e[type=item]'); }
async function clearWorldEntities(){
  // Remove non-player entities except our bots (tagged).
  await serverCmd(`kill @e[type=!player,tag=!${cfg.rconKillTag}]`);
}
async function closeRcon(){ if (rcon) try{ await rcon.end(); }catch{} }
module.exports={initRcon,serverCmd,ensureTeamSetup,applyTeamAndTag,teleportToSpawn,teleportTo,clearPlayer,kickPlayer,healPlayer,freezePlayer,equipIronPvpKit,ensureScoreboardObjective,ensureScoreboardObjectiveCriteria,resetScoreboardObjective,setScore,getScore,sendTitle,setGamemode,killAllBots,clearDroppedItems,clearWorldEntities,closeRcon};
