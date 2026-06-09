const fs=require('fs');
const path=require('path');
const { ChartJSNodeCanvas }=require('chartjs-node-canvas');
const cfg=require('./config');
const { sleep, seedRandom }=require('./utils');
const Individual=require('./individual');
const { spawnBot }=require('./botController');
const { killAllBots, serverCmd, teleportTo, clearPlayer, healPlayer, freezePlayer, equipIronPvpKit, ensureScoreboardObjective, ensureScoreboardObjectiveCriteria, resetScoreboardObjective, setScore, getScore, sendTitle, setGamemode, clearDroppedItems, clearWorldEntities, closeRcon }=require('./rcon');
const { createNeat, evolve, assignNetworksToIndividuals, writeFitnessToNetworks, savePopulation, loadPopulation }=require('./gaNeat');

seedRandom(cfg.seed);

const population=[];
let neat=null;
let arenaCache=null;
let currentLeader=null;
let lastArenaSpec=null;
let rewardHistory=null;

function historyPaths(){
  const dir = path.resolve(__dirname, '..', 'graphs');
  return {
    dir,
    json: path.join(dir, 'reward_history.json'),
    img: path.join(dir, 'reward_trends.png')
  };
}

function loadRewardHistory(){
  const { json } = historyPaths();
  if (!fs.existsSync(json)) return [];
  try{
    const raw = fs.readFileSync(json, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  }catch{
    return [];
  }
}

function saveRewardHistory(history){
  const { dir, json } = historyPaths();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(json, JSON.stringify(history, null, 2));
}

async function renderRewardChart(history){
  const { dir, img } = historyPaths();
  if (!history.length) return;
  fs.mkdirSync(dir, { recursive: true });
  const labels = history.map(h => `G${h.g}`);
  const series = (key)=> history.map(h => h[key] ?? 0);
  const datasets = [
    { label: 'win', data: series('win'), color: '#1b9e77' },
    { label: 'loss', data: series('loss'), color: '#d95f02' },
    { label: 'kill', data: series('kill'), color: '#7570b3' },
    { label: 'tie', data: series('tie'), color: '#e7298a' },
    { label: 'time', data: series('time'), color: '#66a61e' },
    { label: 'fov', data: series('fov'), color: '#e6ab02' },
    { label: 'facing', data: series('facing'), color: '#a6761d' },
    { label: 'arrows', data: series('arrows'), color: '#4daf4a' },
    { label: 'shield', data: series('shield'), color: '#1f78b4' },
    { label: 'dmg+', data: series('dmgDealt'), color: '#b2df8a' },
    { label: 'dmg-', data: series('dmgTaken'), color: '#e31a1c' },
    { label: 'block', data: series('block'), color: '#6a3d9a' }
  ].map(d => ({
    label: d.label,
    data: d.data,
    borderColor: d.color,
    backgroundColor: d.color + '55',
    fill: true,
    tension: 0.25,
    pointRadius: 0
  }));

  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width: 1200,
    height: 600,
    backgroundColour: 'white'
  });

  const config = {
    type: 'bar',
    data: { labels, datasets: datasets.map(d => ({ ...d, borderWidth: 0 })) },
    options: {
      responsive: false,
      animation: false,
      scales: {
        x: { stacked: true },
        y: { stacked: true }
      },
      plugins: {
        legend: { position: 'top' },
        title: { display: true, text: 'Top-10 Avg Reward Contributions Per Generation' }
      }
    }
  };

  const image = await chartJSNodeCanvas.renderToBuffer(config);
  fs.writeFileSync(img, image);
}

async function waitReady({ timeoutMs = 30000, respawn = true } = {}){
  let nextWarnAt = Date.now() + timeoutMs;
  while (true){
    const notReady = population.filter(i=>!i.ready || !i.bot);
    if (notReady.length === 0) return true;

    if (Date.now() >= nextWarnAt){
      const names = notReady.map(i=>i.username).join(', ');
      console.warn(`⚠️ waitReady timeout after ${timeoutMs}ms. Missing/idle: ${names}`);
      if (respawn){
        for (const ind of notReady){
          if (!ind.bot){
            await spawnBot(ind, cfg.spawn);
            await sleep(cfg.staggerSpawnMs);
          }
        }
      }
      nextWarnAt = Date.now() + timeoutMs;
    }

    await sleep(500);
  }
}
async function setStartMoving(flag){ population.forEach(i=>{ i.startMoving=flag; }); }
async function startMoving(){ await setStartMoving(false); await sleep(cfg.startDelayMs); population.forEach(i=>{ i.startMoving=true; }); }

async function runGeneration(g, durationMs, spawn){
  console.log(`\n⏳ Generation ${g} begins (duration ${(durationMs/1000).toFixed(0)} s)`);
  await waitReady();
  console.log(`▶️ All bots ready, starting in ${cfg.startDelayMs}ms`);
  await startMoving();
  await sleep(durationMs);

  // Log fitness summary
  const avg = population.reduce((s,i)=>s + (i.maxDist||0), 0) / population.length;
  const top = [...population].sort((a,b)=> (b.maxDist||0) - (a.maxDist||0)).slice(0,5).map(x=>`${x.username}:${(x.maxDist||0).toFixed(2)}`).join('  ');
  console.log(`Average fitness (maxDist) = ${avg.toFixed(2)}`);
  console.log(`🏁 Top 5: ${top}`);

  population.forEach(i=>{ i.fitness = i.maxDist || 0; });
  await ensureScoreboardObjective('fitness', `"Gen ${g}"`);
  for (const ind of population){ await setScore(ind.username, 'fitness', ind.fitness); }
  writeFitnessToNetworks(neat, population);
  evolve(neat);
  if (cfg.saveEveryGeneration && cfg.populationSavePath){ savePopulation(neat, cfg.populationSavePath); }

  console.log(`🧹 Generation ${g} ends — tearing down bots`);
  await killAllBots();
  await sleep(500);

  await Promise.all(population.map(ind=> new Promise(res=>{
    if(!ind.bot) return res();
    ind.bot.once('end', res);
    try{
      ind.shutdown = true;
      ind.bot.end(true);
    }catch{ res(); }
  })));

  population.forEach(i=>{ i.maxDist=0; i.startPos=null; i.ready=false; i.startMoving=false; i.stateHistory=null; i.actionHistory=null; i.lastDamageDealt=0; i.lastDamageTaken=0; i.lastCloseDist=0; i.lastResult=0; i.pvpBreakdown=null; });
  assignNetworksToIndividuals(neat, population);

  await sleep(cfg.preRespawnCooldownMs);
  console.log(`♻️ Respawning bots for generation ${g+1}`);
  for(const ind of population){ await spawnBot(ind, spawn); await sleep(cfg.staggerSpawnMs); }
  await waitReady();
  console.log(`✅ Bots ready for generation ${g+1}`);
}

function roundRobinPairs(list){
  const players = list.slice();
  if (players.length % 2 === 1) players.push(null);
  const n = players.length;
  const rounds = [];
  for (let r=0; r<n-1; r++){
    const pairs = [];
    for (let i=0; i<n/2; i++){
      const a = players[i];
      const b = players[n-1-i];
      if (a && b) pairs.push([a,b]);
    }
    rounds.push(pairs);
    const last = players.pop();
    players.splice(1, 0, last);
  }
  return rounds;
}

function buildRounds(pop, roundsCount){
  const n = pop.length;
  const rounds = [];
  const seen = new Set();
  const key = (a,b)=> (a.username < b.username) ? `${a.username}|${b.username}` : `${b.username}|${a.username}`;

  for (let r=0; r<roundsCount; r++){
    let round = null;
    let attempts = 0;
    while (!round && attempts < 200){
      attempts++;
      const order = pop.slice().sort(()=>Math.random()-0.5);
      const pairs = [];
      let ok = true;
      for (let i=0; i<order.length; i+=2){
        const a = order[i];
        const b = order[i+1];
        if (!b){ ok = false; break; }
        if (seen.has(key(a,b))){ ok = false; break; }
        pairs.push([a,b]);
      }
      if (ok){
        for (const [a,b] of pairs) seen.add(key(a,b));
        round = pairs;
      }
    }
    if (!round){
      // Fallback: allow repeats for this round if uniqueness is impossible
      const order = pop.slice().sort(()=>Math.random()-0.5);
      const pairs = [];
      for (let i=0; i<order.length; i+=2){
        const a = order[i];
        const b = order[i+1];
        if (!b) continue;
        pairs.push([a,b]);
      }
      round = pairs;
    }
    rounds.push(round);
  }
  return rounds;
}

async function buildArenas(count){
  const pvp = cfg.pvp || {};
  const size = pvp.arenaSize || 9;
  const wallHeight = pvp.wallHeight || 3;
  const spacing = pvp.arenaSpacing || 14;
  const origin = pvp.arenaOrigin || { x: cfg.spawn.x, y: cfg.spawn.y, z: cfg.spawn.z };
  if (arenaCache && arenaCache.length >= count){
    const spec = lastArenaSpec || {};
    if (spec.size === size && spec.wallHeight === wallHeight && spec.spacing === spacing){
      return arenaCache.slice(0, count);
    }
  }
  const half = Math.floor(size/2);
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const arenas = [];

  const maxClear = Math.max(arenaCache?.length || 0, count, Math.ceil(cfg.populationSize / 2));
  const prev = lastArenaSpec || { size: 0, wallHeight: 0, spacing: 0, origin };
  const clearSpec = {
    size: Math.max(size, prev.size || 0),
    wallHeight: Math.max(wallHeight, prev.wallHeight || 0),
    spacing: Math.max(spacing, prev.spacing || 0),
    origin
  };
  await clearArenaGrid(maxClear, clearSpec);

  for (let idx=0; idx<count; idx++){
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const cx = origin.x + col * (size + spacing);
    const cz = origin.z + row * (size + spacing);
    const cy = origin.y;
    const minX = cx - half - 1;
    const maxX = cx + half + 1;
    const minZ = cz - half - 1;
    const maxZ = cz + half + 1;
    const y0 = cy - 1;
    const y1 = cy + wallHeight;

    // Clear space and build a small glass-walled arena.
    await serverCmd(`fill ${minX} ${y0} ${minZ} ${maxX} ${y1} ${maxZ} air`);
    await serverCmd(`fill ${minX} ${y0} ${minZ} ${maxX} ${y0} ${maxZ} smooth_stone`);
    await serverCmd(`fill ${minX} ${cy} ${minZ} ${maxX} ${cy + wallHeight - 1} ${minZ} glass`);
    await serverCmd(`fill ${minX} ${cy} ${maxZ} ${maxX} ${cy + wallHeight - 1} ${maxZ} glass`);
    await serverCmd(`fill ${minX} ${cy} ${minZ} ${minX} ${cy + wallHeight - 1} ${maxZ} glass`);
    await serverCmd(`fill ${maxX} ${cy} ${minZ} ${maxX} ${cy + wallHeight - 1} ${maxZ} glass`);
    await serverCmd(`fill ${minX} ${cy + wallHeight} ${minZ} ${maxX} ${cy + wallHeight} ${maxZ} glass`);

    const posA = { x: cx - half + 1, y: cy, z: cz };
    const posB = { x: cx + half - 1, y: cy, z: cz };
    arenas.push({ center: {x: cx, y: cy, z: cz}, posA, posB });
  }
  lastArenaSpec = { size, wallHeight, spacing, origin };
  return arenas;
}

async function clearArenaGrid(count, { size, wallHeight, spacing, origin }){
  const half = Math.floor(size/2);
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cy = origin.y;
  const y0 = cy - 1;
  const y1 = cy + wallHeight + 2;

  const minX = origin.x - half - 1;
  const minZ = origin.z - half - 1;
  const maxX = origin.x + (cols - 1) * (size + spacing) + half + 1;
  const maxZ = origin.z + (rows - 1) * (size + spacing) + half + 1;

  // One big clear to remove any leftover cages.
  await serverCmd(`fill ${minX} ${y0} ${minZ} ${maxX} ${y1} ${maxZ} air`);
}

async function prepForMatch(ind, pos, face){
  ind.startMoving = false;
  await setGamemode(ind.username, 'survival');
  await clearPlayer(ind.username);
  await freezePlayer(ind.username);
  await healPlayer(ind.username);
  await equipIronPvpKit(ind.username);
  for (let i=0; i<3; i++){
    await teleportTo(ind.username, pos, face);
    await sleep(80);
  }
}

function atPos(ind, pos, eps=1.2){
  const p = ind?.bot?.entity?.position;
  if (!p) return false;
  const dx = p.x - pos.x;
  const dy = p.y - pos.y;
  const dz = p.z - pos.z;
  return (dx*dx + dy*dy + dz*dz) <= (eps*eps);
}

function getMissingPairs(pairs, arenas){
  const missing = [];
  for (let i=0; i<pairs.length; i++){
    const [a,b] = pairs[i];
    const arena = arenas[i % arenas.length];
    const aOk = !!(a?.ready && a?.bot && atPos(a, arena.posA));
    const bOk = !!(b?.ready && b?.bot && atPos(b, arena.posB));
    if (!aOk || !bOk){
      missing.push({ a, b, arena, aOk, bOk });
    }
  }
  return missing;
}

async function waitForPositions(pairs, arenas, timeoutMs=5000){
  const start = Date.now();
  while (Date.now() - start < timeoutMs){
    const missing = getMissingPairs(pairs, arenas);
    if (missing.length === 0) return { ok: true, missing: [] };
    await sleep(100);
  }
  return { ok: false, missing: getMissingPairs(pairs, arenas) };
}

async function ensurePositions(pairs, arenas, { timeoutMs = 8000, attempts = 3 } = {}){
  for (let attempt = 1; attempt <= attempts; attempt++){
    const res = await waitForPositions(pairs, arenas, timeoutMs);
    if (res.ok) return true;
    const missing = res.missing || [];
    console.warn(`⚠️  Missing ${missing.length * 2} slots before round (attempt ${attempt}/${attempts})`);
    for (const m of missing){
      const { a, b, arena, aOk, bOk } = m;
      try{
        if (a && !a.bot) await spawnBot(a, cfg.spawn);
        if (b && !b.bot) await spawnBot(b, cfg.spawn);
        if (a && b && (!aOk || !bOk)) await prepMatch(a, b, arena);
      }catch(e){
        console.warn(`[${a?.username} vs ${b?.username}] reposition failed`, e?.message||e);
      }
      await sleep(120);
    }
  }
  return false;
}

function getHealth(ind){
  const h = ind?.bot?.health;
  return (typeof h === 'number' && !Number.isNaN(h)) ? h : 0;
}

function getHealthRaw(ind){
  const h = ind?.bot?.health;
  return (typeof h === 'number' && !Number.isNaN(h)) ? h : null;
}

function hasLiveBot(ind){
  return !!(ind?.bot && ind?.bot?.entity && ind?.ready);
}

function getPos(ind){
  return ind?.bot?.entity?.position || null;
}

function offhandShield(ind){
  const off = ind?.bot?.inventory?.slots?.[45];
  return off?.name === 'shield';
}

function isUsingItemAction(ind){
  const hist = ind?.actionHistory;
  if (!hist || !hist.length) return false;
  const vec = hist[0];
  if (!Array.isArray(vec)) return false;
  const useIndex = (cfg.movementControls?.length || 0) + 1; // actions[1] === 'useItem'
  return vec[useIndex] === 1;
}

function distance(a, b){
  if (!a || !b) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

async function getScoreSafe(username, objective){
  try{ return await getScore(username, objective); }catch{ return 0; }
}

async function runTrackedMatch(a, b, matchMs){
  // Wait briefly for valid health values; fall back to 20 if still missing.
  let ha0 = getHealthRaw(a);
  let hb0 = getHealthRaw(b);
  const tHealth = Date.now();
  while ((ha0 === null || hb0 === null) && Date.now() - tHealth < 1500){
    await sleep(50);
    ha0 = getHealthRaw(a);
    hb0 = getHealthRaw(b);
  }
  if (ha0 === null) ha0 = 20;
  if (hb0 === null) hb0 = 20;
  const blockedObj = 'dmgBlocked';
  const blockedA0 = await getScoreSafe(a.username, blockedObj);
  const blockedB0 = await getScoreSafe(b.username, blockedObj);
  const shotsA0 = a?.arrowShots || 0;
  const shotsB0 = b?.arrowShots || 0;
  let minDist = null;
  let startDist = null;
  let moveDistA = 0, moveDistB = 0;
  let turnVarA = 0, turnVarB = 0;
  let lastPosA = null, lastPosB = null;
  let lastAngA = null, lastAngB = null;
  const t0 = Date.now();
  let fovTicksA = 0, fovTicksB = 0, facingSumA = 0, facingSumB = 0, samples = 0;
  let shieldUseTicksA = 0, shieldUseTicksB = 0;

  const sample = ()=>{
    const pa = getPos(a);
    const pb = getPos(b);
    const d = distance(pa, pb);
    if (typeof d === 'number'){
      if (startDist === null) startDist = d;
      if (minDist === null || d < minDist) minDist = d;
    }

    if (pa){
      if (lastPosA){
        const dx = pa.x - lastPosA.x;
        const dz = pa.z - lastPosA.z;
        const step = Math.hypot(dx, dz);
        moveDistA += step;
        if (step > 0.001){
          const ang = Math.atan2(dz, dx);
          if (lastAngA !== null){
            let da = Math.abs(ang - lastAngA);
            if (da > Math.PI) da = (Math.PI * 2) - da;
            turnVarA += da;
          }
          lastAngA = ang;
        }
      }
      lastPosA = pa;
    }
    if (pb){
      if (lastPosB){
        const dx = pb.x - lastPosB.x;
        const dz = pb.z - lastPosB.z;
        const step = Math.hypot(dx, dz);
        moveDistB += step;
        if (step > 0.001){
          const ang = Math.atan2(dz, dx);
          if (lastAngB !== null){
            let da = Math.abs(ang - lastAngB);
            if (da > Math.PI) da = (Math.PI * 2) - da;
            turnVarB += da;
          }
          lastAngB = ang;
        }
      }
      lastPosB = pb;
    }

    if (pa && pb){
      const yawA = a?.bot?.entity?.yaw || 0;
      const yawB = b?.bot?.entity?.yaw || 0;
      const dx = pb.x - pa.x;
      const dz = pb.z - pa.z;
      const mag = Math.hypot(dx, dz) || 1;
      const nx = dx / mag;
      const nz = dz / mag;
      const fa = (Math.cos(yawA) * nx) + (Math.sin(yawA) * nz);
      const fb = (Math.cos(yawB) * -nx) + (Math.sin(yawB) * -nz);
      facingSumA += fa;
      facingSumB += fb;
      if (fa >= 0.6 && d <= 16) fovTicksA += 1;
      if (fb >= 0.6 && d <= 16) fovTicksB += 1;
      samples += 1;
    }

    const heldA = a?.bot?.heldItem?.name || '';
    const heldB = b?.bot?.heldItem?.name || '';
    if (offhandShield(a) && heldA !== 'bow' && isUsingItemAction(a)) shieldUseTicksA += 1;
    if (offhandShield(b) && heldB !== 'bow' && isUsingItemAction(b)) shieldUseTicksB += 1;
  };
  sample();
  const interval = setInterval(sample, 200);

  const res = await waitForDeathOrTimeout(a, b, matchMs);

  clearInterval(interval);
  sample();
  const blockedA1 = await getScoreSafe(a.username, blockedObj);
  const blockedB1 = await getScoreSafe(b.username, blockedObj);
  const shotsA1 = a?.arrowShots || 0;
  const shotsB1 = b?.arrowShots || 0;
  const ha1 = getHealth(a);
  const hb1 = getHealth(b);
  const elapsedMs = Date.now() - t0;
  return { res, stats: { ha0, hb0, ha1, hb1, blockedA0, blockedB0, blockedA1, blockedB1, shotsA0, shotsB0, shotsA1, shotsB1, startDist, minDist, elapsedMs, moveDistA, moveDistB, turnVarA, turnVarB, fovTicksA, fovTicksB, facingSumA, facingSumB, shieldUseTicksA, shieldUseTicksB, samples } };
}

function waitForDeathOrTimeout(a, b, timeoutMs){
  return new Promise((resolve)=>{
    let done = false;
    const finish = (result)=>{
      if (done) return;
      done = true;
      a.onDeath = null;
      b.onDeath = null;
      a.startMoving = false;
      b.startMoving = false;
      resolve(result);
    };
    const t = setTimeout(()=>{
      const haRaw = getHealthRaw(a);
      const hbRaw = getHealthRaw(b);
      const liveA = hasLiveBot(a);
      const liveB = hasLiveBot(b);
      if (!liveA || !liveB || haRaw === null || hbRaw === null){
        return finish({ winner: null, loser: null, reason: 'timeout_invalid', ha: haRaw ?? 0, hb: hbRaw ?? 0 });
      }
      if (haRaw === hbRaw) return finish({ winner: null, loser: null, reason: 'timeout_tie', ha: haRaw, hb: hbRaw });
      return finish({ winner: haRaw > hbRaw ? a : b, loser: haRaw > hbRaw ? b : a, reason: 'timeout_health', ha: haRaw, hb: hbRaw });
    }, timeoutMs);
    a.onDeath = ()=>{ clearTimeout(t); finish({ winner: b, loser: a, reason: 'death' }); };
    b.onDeath = ()=>{ clearTimeout(t); finish({ winner: a, loser: b, reason: 'death' }); };
  });
}

async function prepMatch(a, b, arena){
  const faceA = arena.posB;
  const faceB = arena.posA;
  const size = (cfg.pvp && cfg.pvp.arenaSize) || 9;
  a.arenaCenter = arena.center;
  b.arenaCenter = arena.center;
  a.arenaSize = size;
  b.arenaSize = size;
  a.startMoving = false;
  b.startMoving = false;
  await prepForMatch(a, arena.posA, faceA);
  await prepForMatch(b, arena.posB, faceB);
}

async function runPvpGeneration(g){
  console.log(`\n⚔️  PVP Generation ${g} begins`);
  await waitReady();
  try{
    await ensureScoreboardObjectiveCriteria('dmgBlocked', 'minecraft.custom:minecraft.damage_blocked_by_shield', '"Blocked"');
  }catch(e){
    console.warn('⚠️  damage_blocked_by_shield objective unavailable; damageBlocked reward disabled', e?.code||e?.message||e);
  }
  await ensureScoreboardObjective('fitness', `"Gen ${g}"`);

  population.forEach(i=>{
    i.pvpWins = 0;
    i.pvpLosses = 0;
    i.pvpTies = 0;
    i.fitness = 0;
    i.pvpBreakdown = {
      win: 0,
      loss: 0,
      kill: 0,
      tie: 0,
      time: 0,
      fov: 0,
      facing: 0,
      damageDealt: 0,
      damageTaken: 0,
      damageBlocked: 0,
      arrows: 0,
      shieldUse: 0,
      shaping: 0
    };
  });

  const opponentsPerAgent = (cfg.pvp && cfg.pvp.opponentsPerAgent) || 5;
  const rounds = buildRounds(population, opponentsPerAgent);
  const arenaCount = Math.max(1, Math.floor(population.length / 2));
  const arenas = await buildArenas(arenaCount);
  arenaCache = arenas;

  for (let r=0; r<rounds.length; r++){
    console.log(`▶️  Round ${r+1}/${rounds.length} (${rounds[r].length} matches)`);
    const pairs = rounds[r];
    const active = new Set();
    for (const [a,b] of pairs){
      if (a?.bot && b?.bot) { active.add(a); active.add(b); }
    }
    for (const ind of population){
      if (!active.has(ind)){
        ind.startMoving = false;
        await teleportTo(ind.username, cfg.spawn);
        await freezePlayer(ind.username);
      }
    }
    for (let i=0; i<pairs.length; i++){
      const [a,b] = pairs[i];
      const arena = arenas[i % arenas.length];
      if (!a?.bot || !b?.bot) continue;
      await prepMatch(a, b, arena);
    }

    const pvp = cfg.pvp || {};
    const preMs = pvp.preMatchMs ?? 1500;
    const matchMs = pvp.matchMs ?? 20000;
    const ready = await ensurePositions(pairs.filter(([a,b])=>a && b), arenas, { timeoutMs: 8000, attempts: 4 });
    if (!ready) console.warn('⚠️  Still missing agents after reposition attempts');
    try{
      await sendTitle('ChilledVibe', `"Round ${r+1}/${rounds.length}"`, `"Matches: ${pairs.length}"`);
    }catch{}
    await sleep(preMs);

    for (const ind of population){ ind.startMoving = false; }
    for (const ind of active){
      await healPlayer(ind.username);
      ind.startMoving = true;
    }

    const matches = pairs.map(([a,b])=> runTrackedMatch(a, b, matchMs).then(({ res, stats })=>({ a, b, res, stats })));
    const results = await Promise.all(matches);

    for (const ind of active){ ind.startMoving = false; }
    const rewardCfg = (cfg.pvp && cfg.pvp.reward) || {};
    const winBonus = rewardCfg.winBonus ?? 1;
    const lossPenalty = rewardCfg.lossPenalty ?? 0;
    const tieBonus = rewardCfg.tieBonus ?? 0;
    const killBonus = rewardCfg.killBonus ?? 1;
    const timeBonus = rewardCfg.timeBonus ?? 0.5;
    const timeExp = rewardCfg.timeExponent ?? 1;
    const fovBonus = rewardCfg.fovBonus ?? 0.4;
    const facingBonus = rewardCfg.facingBonus ?? 0.2;
    const dmgDealtW = rewardCfg.damageDealt ?? 1.0;
    const dmgTakenW = rewardCfg.damageTaken ?? 0.5;
    const dmgBlockedW = rewardCfg.damageBlocked ?? 0.2;
    const shieldUseW = rewardCfg.shieldUse ?? 0.05;
    const arrowShotW = rewardCfg.arrowShot ?? 0.0;
    const arrowCap = rewardCfg.arrowShotCap ?? 0.4;
    const arrowK = rewardCfg.arrowShotK ?? 3;

    for (const {a,b,res,stats} of results){
      if (res.winner && res.loser){
        res.winner.pvpWins += 1;
        res.loser.pvpLosses += 1;
      } else {
        a.pvpTies += 1;
        b.pvpTies += 1;
      }

      const ha0 = stats?.ha0 ?? 0;
      const hb0 = stats?.hb0 ?? 0;
      const ha1 = stats?.ha1 ?? 0;
      const hb1 = stats?.hb1 ?? 0;
      const damageDealtA = Math.max(0, hb0 - hb1);
      const damageDealtB = Math.max(0, ha0 - ha1);
      const damageTakenA = Math.max(0, ha0 - ha1);
      const damageTakenB = Math.max(0, hb0 - hb1);
      const blockedA = Math.max(0, (stats?.blockedA1 ?? 0) - (stats?.blockedA0 ?? 0));
      const blockedB = Math.max(0, (stats?.blockedB1 ?? 0) - (stats?.blockedB0 ?? 0));
      const shotsA = Math.max(0, (stats?.shotsA1 ?? 0) - (stats?.shotsA0 ?? 0));
      const shotsB = Math.max(0, (stats?.shotsB1 ?? 0) - (stats?.shotsB0 ?? 0));
      if (blockedA > 0) console.log(`🛡️ ${a.username} blocked ${blockedA.toFixed(2)} damage`);
      if (blockedB > 0) console.log(`🛡️ ${b.username} blocked ${blockedB.toFixed(2)} damage`);
      const elapsedMs = stats?.elapsedMs ?? matchMs;
      const timeFrac = Math.max(0, Math.min(1, 1 - (elapsedMs / matchMs)));
      const timeScaled = Math.pow(timeFrac, Math.max(1, timeExp));
      const timeA = (res.winner === a) ? (timeBonus * timeScaled) : 0;
      const timeB = (res.winner === b) ? (timeBonus * timeScaled) : 0;
      const samples = stats?.samples || 1;
      const fovA = (stats?.fovTicksA || 0) / samples;
      const fovB = (stats?.fovTicksB || 0) / samples;
      const facingA = (stats?.facingSumA || 0) / samples;
      const facingB = (stats?.facingSumB || 0) / samples;
      const shieldUseA = (stats?.shieldUseTicksA || 0) / samples;
      const shieldUseB = (stats?.shieldUseTicksB || 0) / samples;
      const fovScoreA = fovA * fovBonus;
      const fovScoreB = fovB * fovBonus;
      const facingScoreA = Math.max(0, facingA) * facingBonus;
      const facingScoreB = Math.max(0, facingB) * facingBonus;
      const shieldUseScoreA = shieldUseA * shieldUseW;
      const shieldUseScoreB = shieldUseB * shieldUseW;

      const winA = (res.winner === a) ? winBonus : 0;
      const winB = (res.winner === b) ? winBonus : 0;
      const loseA = (res.loser === a) ? lossPenalty : 0;
      const loseB = (res.loser === b) ? lossPenalty : 0;
      const killA = (res.reason === 'death' && res.winner === a) ? killBonus : 0;
      const killB = (res.reason === 'death' && res.winner === b) ? killBonus : 0;
      const tieA = (!res.winner && !res.loser) ? tieBonus : 0;
      const tieB = (!res.winner && !res.loser) ? tieBonus : 0;

      a.lastDamageDealt = damageDealtA;
      a.lastDamageTaken = damageTakenA;
      a.lastResult = (res.winner === a) ? 1 : (res.loser === a ? -1 : 0);
      b.lastDamageDealt = damageDealtB;
      b.lastDamageTaken = damageTakenB;
      b.lastResult = (res.winner === b) ? 1 : (res.loser === b ? -1 : 0);

      const dmgDealtScoreA = (damageDealtA * dmgDealtW);
      const dmgDealtScoreB = (damageDealtB * dmgDealtW);
      const dmgTakenScoreA = -(damageTakenA * dmgTakenW);
      const dmgTakenScoreB = -(damageTakenB * dmgTakenW);
      const dmgBlockedScoreA = (blockedA * dmgBlockedW);
      const dmgBlockedScoreB = (blockedB * dmgBlockedW);
      const arrowRawA = arrowCap * (shotsA / (shotsA + arrowK));
      const arrowRawB = arrowCap * (shotsB / (shotsB + arrowK));
      const arrowScoreA = (arrowShotW > 0) ? (arrowRawA * arrowShotW) : 0;
      const arrowScoreB = (arrowShotW > 0) ? (arrowRawB * arrowShotW) : 0;
      const shapingA = fovScoreA + facingScoreA + shieldUseScoreA + dmgDealtScoreA + dmgTakenScoreA + dmgBlockedScoreA + arrowScoreA;
      const shapingB = fovScoreB + facingScoreB + shieldUseScoreB + dmgDealtScoreB + dmgTakenScoreB + dmgBlockedScoreB + arrowScoreB;
      a.fitness += winA + loseA + killA + tieA + timeA + shapingA;
      b.fitness += winB + loseB + killB + tieB + timeB + shapingB;

      if (a.pvpBreakdown){
        a.pvpBreakdown.win += winA;
        a.pvpBreakdown.loss += loseA;
        a.pvpBreakdown.kill += killA;
        a.pvpBreakdown.tie += tieA;
        a.pvpBreakdown.time += timeA;
        a.pvpBreakdown.fov += fovScoreA;
        a.pvpBreakdown.facing += facingScoreA;
        a.pvpBreakdown.damageDealt += dmgDealtScoreA;
        a.pvpBreakdown.damageTaken += dmgTakenScoreA;
        a.pvpBreakdown.damageBlocked += dmgBlockedScoreA;
        a.pvpBreakdown.shieldUse += shieldUseScoreA;
        a.pvpBreakdown.arrows += arrowScoreA;
        a.pvpBreakdown.shaping += shapingA;
      }
      if (b.pvpBreakdown){
        b.pvpBreakdown.win += winB;
        b.pvpBreakdown.loss += loseB;
        b.pvpBreakdown.kill += killB;
        b.pvpBreakdown.tie += tieB;
        b.pvpBreakdown.time += timeB;
        b.pvpBreakdown.fov += fovScoreB;
        b.pvpBreakdown.facing += facingScoreB;
        b.pvpBreakdown.damageDealt += dmgDealtScoreB;
        b.pvpBreakdown.damageTaken += dmgTakenScoreB;
        b.pvpBreakdown.damageBlocked += dmgBlockedScoreB;
        b.pvpBreakdown.shieldUse += shieldUseScoreB;
        b.pvpBreakdown.arrows += arrowScoreB;
        b.pvpBreakdown.shaping += shapingB;
      }
    }
    // Highlight current leader for this generation
    const leader = [...population].sort((x,y)=> (y.fitness||0) - (x.fitness||0))[0];
    const highlightSeconds = Math.max(5, Math.ceil((matchMs + preMs) / 1000) + 2);
    if (leader?.username && leader.username !== currentLeader){
      try{
        if (currentLeader) await serverCmd(`effect clear ${currentLeader} minecraft:glowing`);
        await serverCmd(`effect give ${leader.username} minecraft:glowing ${highlightSeconds} 1 true`);
        currentLeader = leader.username;
      }catch{}
    } else if (leader?.username){
      try{ await serverCmd(`effect give ${leader.username} minecraft:glowing ${highlightSeconds} 1 true`); }catch{}
    }
    // Cleanup between rounds to keep lag down
    try{ await clearWorldEntities(); }catch{}
    for (const ind of population){
      await setScore(ind.username, 'fitness', ind.pvpWins || 0);
    }
    await sleep(250);
  }

  for (const ind of population){ await setScore(ind.username, 'fitness', ind.pvpWins || 0); }

  const sorted = [...population].sort((a,b)=> (b.fitness||0) - (a.fitness||0));
  const top = sorted.slice(0,5)
    .map(x=>`${x.username}:${(x.fitness||0).toFixed(2)}`).join('  ');
  console.log(`🏁 Top 5 (wins+ties/2): ${top}`);
  const leader = sorted[0];
  if (leader?.pvpBreakdown){
    const b = leader.pvpBreakdown;
    const logReward = (cfg.pvp && cfg.pvp.reward) || {};
    const contrib = (v)=> v.toFixed(2);
    console.log(
      `📊 Top contributions ${leader.username}: ` +
      `win=${b.win.toFixed(2)} ` +
      `loss=${b.loss.toFixed(2)} ` +
      `kill=${b.kill.toFixed(2)} ` +
      `tie=${b.tie.toFixed(2)} ` +
      `time=${b.time.toFixed(2)} ` +
      `fov=${contrib(b.fov)} ` +
      `facing=${contrib(b.facing)} ` +
      `arrows=${contrib(b.arrows)} ` +
      `shield=${contrib(b.shieldUse)} ` +
      `dmg+${contrib(b.damageDealt)} ` +
      `dmg-${contrib(b.damageTaken)} ` +
      `block=${contrib(b.damageBlocked)}`
    );
  }

  if (rewardHistory === null) rewardHistory = loadRewardHistory();
  const topN = sorted.slice(0, Math.min(10, sorted.length)).filter(x=>x.pvpBreakdown);
  if (topN.length){
    const sum = (key)=> topN.reduce((acc, i)=> acc + (i.pvpBreakdown?.[key] || 0), 0);
    const n = topN.length;
    const avg = {
      g,
      win: sum('win') / n,
      loss: sum('loss') / n,
      kill: sum('kill') / n,
      tie: sum('tie') / n,
      time: sum('time') / n,
      fov: sum('fov') / n,
      facing: sum('facing') / n,
      shield: sum('shieldUse') / n,
      arrows: sum('arrows') / n,
      dmgDealt: sum('damageDealt') / n,
      dmgTaken: sum('damageTaken') / n,
      block: sum('damageBlocked') / n,
      arrows: sum('arrows') / n
    };
    rewardHistory.push(avg);
    saveRewardHistory(rewardHistory);
    try{ await renderRewardChart(rewardHistory); }catch(e){ console.warn('⚠️ reward chart failed', e?.message||e); }
  }

  writeFitnessToNetworks(neat, population);
  evolve(neat);
  if (cfg.saveEveryGeneration && cfg.populationSavePath){ savePopulation(neat, cfg.populationSavePath); }

  console.log(`🧹 Generation ${g} ends — tearing down bots`);
  if (currentLeader){
    try{ await serverCmd(`effect clear ${currentLeader} minecraft:glowing`); }catch{}
    currentLeader = null;
  }
  await killAllBots();
  await clearDroppedItems();
  try{ await clearWorldEntities(); }catch{}
  await resetScoreboardObjective('fitness', `"Gen ${g+1}"`);
  await sleep(500);

  await Promise.all(population.map(ind=> new Promise(res=>{
    if(!ind.bot) return res();
    ind.bot.once('end', res);
    try{ ind.bot.end(true); }catch{ res(); }
  })));

  population.forEach(i=>{ i.maxDist=0; i.startPos=null; i.ready=false; i.startMoving=false; i.stateHistory=null; i.actionHistory=null; i.lastDamageDealt=0; i.lastDamageTaken=0; i.lastCloseDist=0; i.lastResult=0; i.pvpBreakdown=null; });
  assignNetworksToIndividuals(neat, population);

  await sleep(cfg.preRespawnCooldownMs);
  console.log(`♻️ Respawning bots for generation ${g+1}`);
  for(const ind of population){ await spawnBot(ind, cfg.spawn); await sleep(cfg.staggerSpawnMs); }
  await waitReady();
  console.log(`✅ Bots ready for generation ${g+1}`);

  const restartEvery = cfg.pvp?.restartEveryGenerations || 0;
  if (restartEvery > 0 && (g % restartEvery === 0)){
    console.log(`🔄 Restarting server after generation ${g}`);
    try{ await serverCmd('stop'); }catch{}
    await closeRcon();
    process.exit(0);
  }
}

async function runEvolution(){
  neat=loadPopulation(cfg.populationSavePath) || createNeat(cfg.seed);
  for(let i=0;i<cfg.populationSize;i++){ population.push(new Individual(`Agent${i+1}`)); }
  assignNetworksToIndividuals(neat, population);

  const spawn = cfg.spawn;
  if (cfg.experiment === 'pvp'){
    await resetScoreboardObjective('fitness', `"Gen 0"`);
  } else {
    await ensureScoreboardObjective('fitness', `"Gen 0"`);
  }
  for(const ind of population){ await spawnBot(ind, spawn); await sleep(cfg.staggerSpawnMs); }
  await waitReady();
  console.log(`✅ All ${cfg.populationSize} bots have joined. Starting evolution.`);
  for (const ind of population){ await setScore(ind.username, 'fitness', 0); }

  if (cfg.experiment === 'pvp'){
    for(let g=1; g<=cfg.maxGenerations; g++){ await runPvpGeneration(g); }
    return;
  }

  let genTime=cfg.startGenerationMs;
  for(let g=1; g<=cfg.maxGenerations; g++){ await runGeneration(g, genTime, spawn); genTime=Math.min(genTime+1000, cfg.maxGenerationMs); }
}

module.exports={runEvolution};
