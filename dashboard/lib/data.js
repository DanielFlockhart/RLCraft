import fs from 'fs';
import net from 'net';
import path from 'path';
import { paths, hubRoot } from './paths';

const GENERATION_RE = /generation-(\d+)/;

export async function buildSnapshot() {
  const serverProperties = readProperties(paths.serverProperties);
  const [minecraftPort, rconPort] = await Promise.all([
    probePort(serverProperties['server-ip'] || '127.0.0.1', numberFrom(serverProperties['server-port'], 25565)),
    probePort('127.0.0.1', numberFrom(serverProperties['rcon.port'], 25575))
  ]);

  const server = buildServerSnapshot({ serverProperties, minecraftPort, rconPort });
  const scenario = buildScenarioSnapshot();
  const pvp = buildPvpSnapshot();

  return {
    generatedAt: new Date().toISOString(),
    hubRoot,
    server,
    scenario,
    pvp
  };
}

export function getPvpRewardImage() {
  if (!fs.existsSync(paths.pvpRewardImage)) return null;
  const stat = fs.statSync(paths.pvpRewardImage);
  return {
    filePath: paths.pvpRewardImage,
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function buildServerSnapshot({ serverProperties, minecraftPort, rconPort }) {
  const logPath = fs.existsSync(paths.latestServerLog) ? paths.latestServerLog : paths.fallbackServerLog;
  const logStat = safeStat(logPath);
  const logLines = readLastLines(logPath, 120);
  const latestLine = logLines.at(-1) || null;
  const recentPlayers = extractRecentPlayers(logLines);
  const readiness = logLines.some(line => line.includes('Done ('));
  const stopping = logLines.some(line => line.includes('Stopping server'));

  return {
    status: minecraftPort.open ? 'online' : 'offline',
    ready: minecraftPort.open && readiness && !stopping,
    host: serverProperties['server-ip'] || '127.0.0.1',
    port: numberFrom(serverProperties['server-port'], 25565),
    rcon: {
      enabled: serverProperties['enable-rcon'] === 'true',
      port: numberFrom(serverProperties['rcon.port'], 25575),
      reachable: rconPort.open
    },
    config: pick(serverProperties, [
      'level-name',
      'level-type',
      'gamemode',
      'difficulty',
      'max-players',
      'view-distance',
      'simulation-distance',
      'pvp',
      'online-mode',
      'spawn-monsters',
      'spawn-animals'
    ]),
    log: {
      path: toDisplayPath(logPath),
      mtime: logStat ? new Date(logStat.mtimeMs).toISOString() : null,
      size: logStat?.size || 0,
      latestLine,
      lines: logLines
    },
    players: recentPlayers
  };
}

function buildScenarioSnapshot() {
  const runs = listRuns();
  const latest = runs[0] || null;
  const latestRun = latest ? readRun(latest) : null;
  const recentRuns = runs.slice(0, 8).map(readRunSummary).filter(Boolean);

  return {
    runsDir: toDisplayPath(paths.runsDir),
    latest: latestRun,
    recentRuns
  };
}

function readRun(runDir) {
  const runJson = readJson(path.join(runDir, 'run.json'));
  const trainer = readJson(path.join(runDir, 'trainer.json'));
  const generationDirs = listGenerationDirs(runDir);
  const generations = generationDirs.map(dir => readGeneration(runDir, dir)).filter(Boolean);
  const latestGeneration = generations.at(-1) || null;
  const taskName = runJson?.task?.name || trainer?.task || latestGeneration?.task?.name || null;
  const checkpoint = readLatestCheckpoint(taskName);

  return {
    id: path.basename(runDir),
    path: toDisplayPath(runDir),
    startedAt: runJson?.startedAt || parseRunStartedAt(runDir),
    status: inferRunStatus(generations),
    config: {
      name: runJson?.name || path.basename(runDir),
      generationsTarget: runJson?.run?.generations || null,
      agentCount: runJson?.run?.agentCount || null,
      episodeMs: runJson?.run?.episodeMs || null,
      tickMs: runJson?.run?.tickMs || null,
      startServer: runJson?.run?.startServer ?? null
    },
    minecraft: runJson?.minecraft || null,
    task: runJson?.task || (trainer?.task ? { name: trainer.task } : null),
    trainer,
    generationCount: generations.length,
    latestGeneration,
    rewardSeries: generations.map(generation => ({
      generation: generation.generation,
      totalReward: generation.totalReward,
      status: generation.status,
      startedAt: generation.startedAt,
      endedAt: generation.endedAt
    })),
    checkpoint
  };
}

function readRunSummary(runDir) {
  const run = readJson(path.join(runDir, 'run.json'));
  const generations = listGenerationDirs(runDir).map(dir => readGeneration(runDir, dir, { compact: true })).filter(Boolean);
  const latestGeneration = generations.at(-1) || null;

  return {
    id: path.basename(runDir),
    startedAt: run?.startedAt || parseRunStartedAt(runDir),
    task: run?.task?.name || latestGeneration?.task?.name || null,
    generationCount: generations.length,
    status: inferRunStatus(generations),
    totalReward: latestGeneration?.totalReward ?? null,
    latestGeneration: latestGeneration?.generation ?? null
  };
}

function readGeneration(runDir, generationDir, options = {}) {
  const summary = readJson(path.join(generationDir, 'summary.json'));
  const start = readJson(path.join(generationDir, 'start.json'));
  const generation = summary?.generation || start?.generation || parseGenerationNumber(generationDir);
  if (!generation) return null;

  if (summary) {
    return normalizeGeneration({
      generation,
      source: 'summary',
      ...summary
    }, options);
  }

  const live = buildLiveGenerationFromTransitions(runDir, generation);
  return normalizeGeneration({
    generation,
    source: 'transitions',
    agents: live.agents,
    totalReward: live.totalReward,
    status: 'open',
    startedAt: start?.startedAt || null,
    episodeStartedAt: null,
    episodeEndedAt: null,
    episodeDurationMs: null,
    endedAt: null,
    durationMs: start?.startedAt ? Date.now() - Date.parse(start.startedAt) : null,
    transitionFiles: live.files,
    latestTransitionAt: live.latestTransitionAt,
    errors: []
  }, options);
}

function normalizeGeneration(generation, options = {}) {
  const agents = generation.agents || {};
  const agentList = Object.entries(agents)
    .map(([username, value]) => ({
      username,
      reward: safeNumber(value.reward),
      ticks: value.ticks || value.tick || 0,
      done: !!value.done,
      reason: value.reason || null,
      error: value.error || null,
      milestones: value.milestones || [],
      health: value.health ?? value.observation?.health ?? null,
      food: value.food ?? value.observation?.food ?? null,
      position: value.position ?? value.observation?.position ?? null,
      heldItem: value.heldItem ?? value.observation?.heldItem ?? null,
      inventory: value.inventory ?? value.observation?.inventory ?? null,
      progress: value.progress ?? value.observation?.task?.progress ?? null,
      targetBlock: value.targetBlock ?? value.observation?.targetBlock ?? null,
      action: value.action || null,
      rewardBreakdown: value.rewardBreakdown || null
    }))
    .sort((a, b) => b.reward - a.reward || a.username.localeCompare(b.username));

  return {
    generation: generation.generation,
    source: generation.source || 'summary',
    status: generation.status || 'unknown',
    totalReward: safeNumber(generation.totalReward),
    startedAt: generation.startedAt || null,
    episodeStartedAt: generation.episodeStartedAt || null,
    episodeEndedAt: generation.episodeEndedAt || null,
    episodeDurationMs: generation.episodeDurationMs ?? null,
    endedAt: generation.endedAt || null,
    durationMs: generation.durationMs ?? null,
    errors: generation.errors || [],
    agents: options.compact ? undefined : agentList,
    agentCount: agentList.length,
    completedAgents: agentList.filter(agent => agent.done).length,
    bestAgent: agentList[0] || null,
    transitionFiles: generation.transitionFiles || [],
    latestTransitionAt: generation.latestTransitionAt || null
  };
}

function buildLiveGenerationFromTransitions(runDir, generation) {
  const transitionsDir = path.join(runDir, 'transitions');
  if (!fs.existsSync(transitionsDir)) return { agents: {}, totalReward: 0, files: [], latestTransitionAt: null };
  const prefix = `generation-${pad(generation)}-`;
  const files = fs.readdirSync(transitionsDir)
    .filter(name => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .map(name => path.join(transitionsDir, name));

  const agents = {};
  let totalReward = 0;
  let latestTransitionAt = null;

  for (const filePath of files) {
    const stat = safeStat(filePath);
    if (stat && (!latestTransitionAt || stat.mtimeMs > Date.parse(latestTransitionAt))) {
      latestTransitionAt = new Date(stat.mtimeMs).toISOString();
    }
    const transitions = readJsonl(filePath, 10 * 1024 * 1024);
    const last = transitions.at(-1);
    if (!last?.username) continue;
    const reward = transitions.reduce((sum, transition) => sum + safeNumber(transition.reward), 0);
    totalReward += reward;
    agents[last.username] = {
      ...last,
      reward,
      ticks: last.tick || transitions.length,
      progress: last.observation?.task?.progress || null,
      health: last.observation?.health ?? null,
      food: last.observation?.food ?? null,
      position: last.observation?.position || null,
      heldItem: last.observation?.heldItem || null,
      inventory: last.observation?.inventory || null,
      targetBlock: last.observation?.targetBlock || null
    };
  }

  return {
    agents,
    totalReward,
    files: files.map(filePath => ({
      path: toDisplayPath(filePath),
      size: safeStat(filePath)?.size || 0
    })),
    latestTransitionAt
  };
}

function readLatestCheckpoint(taskName) {
  if (!taskName) return null;
  const taskDir = path.join(paths.checkpointsDir, taskName);
  if (!fs.existsSync(taskDir)) return null;

  const dirs = fs.readdirSync(taskDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && GENERATION_RE.test(entry.name))
    .map(entry => path.join(taskDir, entry.name))
    .sort((a, b) => parseGenerationNumber(a) - parseGenerationNumber(b));

  const latestDir = dirs.at(-1);
  if (!latestDir) return null;
  const manifest = readJson(path.join(latestDir, 'manifest.json'));
  if (!manifest) return null;

  return {
    path: toDisplayPath(latestDir),
    ...manifest
  };
}

function buildPvpSnapshot() {
  const history = readJson(paths.pvpRewardHistory);
  const stat = safeStat(paths.pvpRewardImage);
  const rows = Array.isArray(history) ? history : [];
  const latest = rows.at(-1) || null;
  const keys = latest ? Object.keys(latest).filter(key => key !== 'g' && typeof latest[key] === 'number') : [];

  return {
    historyPath: toDisplayPath(paths.pvpRewardHistory),
    imagePath: toDisplayPath(paths.pvpRewardImage),
    graphImageUrl: stat ? `/api/pvp/reward-trends.png?mtime=${Math.round(stat.mtimeMs)}` : null,
    imageMtime: stat ? new Date(stat.mtimeMs).toISOString() : null,
    generationCount: rows.length,
    latest,
    keys,
    series: rows.slice(-80)
  };
}

function listRuns() {
  if (!fs.existsSync(paths.runsDir)) return [];
  return fs.readdirSync(paths.runsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(paths.runsDir, entry.name))
    .sort((a, b) => runSortTime(b) - runSortTime(a));
}

function listGenerationDirs(runDir) {
  const generationsDir = path.join(runDir, 'generations');
  if (!fs.existsSync(generationsDir)) return [];
  return fs.readdirSync(generationsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && GENERATION_RE.test(entry.name))
    .map(entry => path.join(generationsDir, entry.name))
    .sort((a, b) => parseGenerationNumber(a) - parseGenerationNumber(b));
}

function inferRunStatus(generations) {
  const latest = generations.at(-1);
  if (!latest) return 'waiting';
  if (latest.status === 'open') return 'open';
  if (latest.status === 'failed') return 'failed';
  return 'completed';
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readJsonl(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > maxBytes) {
      return readLastLines(filePath, 300).map(parseLineJson).filter(Boolean);
    }
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map(parseLineJson).filter(Boolean);
  } catch {
    return [];
  }
}

function parseLineJson(line) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readLastLines(filePath, maxLines = 80) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const stat = fs.statSync(filePath);
    const bytes = Math.min(stat.size, 256 * 1024);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(bytes);
    fs.readSync(fd, buffer, 0, bytes, stat.size - bytes);
    fs.closeSync(fd);
    return buffer.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}

function readProperties(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return result;
}

function extractRecentPlayers(lines) {
  const players = new Map();
  for (const line of lines) {
    const join = line.match(/INFO\]: ([^\s]+)\[\/.*\] logged in/);
    const leave = line.match(/INFO\]: ([^\s]+) lost connection/);
    if (join) players.set(join[1], { username: join[1], state: 'joined', line });
    if (leave) players.set(leave[1], { username: leave[1], state: 'left', line });
  }
  return [...players.values()].slice(-12);
}

function probePort(host, port) {
  const normalizedHost = host && host !== '0.0.0.0' && host !== '*' ? host : '127.0.0.1';
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;
    const finish = open => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ host: normalizedHost, port, open });
    };
    socket.setTimeout(350);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, normalizedHost);
  });
}

function runSortTime(runDir) {
  const runJson = readJson(path.join(runDir, 'run.json'));
  const fromJson = runJson?.startedAt ? Date.parse(runJson.startedAt) : 0;
  const fromName = Date.parse(parseRunStartedAt(runDir) || '') || 0;
  const stat = safeStat(runDir);
  return Math.max(fromJson, fromName, stat?.mtimeMs || 0);
}

function parseRunStartedAt(runDir) {
  const name = path.basename(runDir);
  const match = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function parseGenerationNumber(filePath) {
  const match = path.basename(filePath).match(GENERATION_RE);
  return match ? Number(match[1]) : null;
}

function pick(source, keys) {
  return Object.fromEntries(keys.map(key => [key, source[key]]).filter(([, value]) => value !== undefined));
}

function safeStat(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  } catch {
    return null;
  }
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numberFrom(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pad(value) {
  return String(value).padStart(4, '0');
}

function toDisplayPath(filePath) {
  if (!filePath) return null;
  return path.relative(hubRoot, filePath).replaceAll(path.sep, '/');
}
