import path from 'path';

export const hubRoot = process.env.RLCRAFT_ROOT
  ? path.resolve(process.env.RLCRAFT_ROOT)
  : path.resolve(/* turbopackIgnore: true */ process.cwd(), '..');

export const paths = {
  hubRoot,
  gameRoot: path.join(hubRoot, 'game-completion-rl'),
  runsDir: path.join(hubRoot, 'game-completion-rl', 'runs'),
  checkpointsDir: path.join(hubRoot, 'game-completion-rl', 'checkpoints'),
  serverDir: path.join(hubRoot, 'server'),
  serverProperties: path.join(hubRoot, 'server', 'server.properties'),
  latestServerLog: path.join(hubRoot, 'server', 'logs', 'latest.log'),
  fallbackServerLog: path.join(hubRoot, 'server', 'server.log'),
  pvpGraphsDir: path.join(hubRoot, 'pvp', 'graphs'),
  pvpRewardHistory: path.join(hubRoot, 'pvp', 'graphs', 'reward_history.json'),
  pvpRewardImage: path.join(hubRoot, 'pvp', 'graphs', 'reward_trends.png')
};
