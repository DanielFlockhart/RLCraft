'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  Image as ImageIcon,
  RefreshCcw,
  ScrollText,
  Server,
  Shield,
  Trophy,
  Users
} from 'lucide-react';

const POLL_MS = 2000;

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/snapshot', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Snapshot request failed with ${response.status}`);
      const value = await response.json();
      setSnapshot(value);
      setError(null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const latestRun = snapshot?.scenario?.latest;
  const latestGeneration = latestRun?.latestGeneration;
  const server = snapshot?.server;
  const pvp = snapshot?.pvp;

  const metrics = [
    {
      label: 'Server',
      value: server?.status || 'checking',
      detail: server?.ready ? 'ready' : server?.rcon?.reachable ? 'rcon reachable' : 'not ready',
      icon: Server,
      tone: server?.status === 'online' ? 'good' : 'muted'
    },
    {
      label: 'Scenario',
      value: latestRun?.task?.label || latestRun?.task?.name || 'no run',
      detail: latestRun ? `${latestRun.status} / generation ${latestGeneration?.generation || 0}` : 'waiting for runs',
      icon: Activity,
      tone: latestRun?.status === 'failed' ? 'bad' : latestRun?.status === 'open' ? 'warn' : 'good'
    },
    {
      label: 'Reward',
      value: formatNumber(latestGeneration?.totalReward),
      detail: latestGeneration?.bestAgent ? `${latestGeneration.bestAgent.username} leads` : 'no agent data',
      icon: Trophy,
      tone: 'blue'
    },
    {
      label: 'PVP Graph',
      value: pvp?.generationCount ? `${pvp.generationCount} rows` : 'missing',
      detail: pvp?.imageMtime ? `image ${formatTime(pvp.imageMtime)}` : 'no image',
      icon: ImageIcon,
      tone: pvp?.graphImageUrl ? 'good' : 'muted'
    }
  ];

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brandMark">
            <Activity size={24} aria-hidden="true" />
          </span>
          <div>
            <h1>RlCraft Realtime</h1>
            <p>{snapshot?.hubRoot || 'Loading local project data'}</p>
          </div>
        </div>
        <div className="topActions">
          <StatusPill status={server?.status || 'checking'} />
          <button className="iconButton" type="button" onClick={load} title="Refresh">
            <RefreshCcw size={18} aria-hidden="true" className={loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="notice bad">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="metricGrid" aria-label="Current status">
        {metrics.map(metric => (
          <MetricTile key={metric.label} {...metric} />
        ))}
      </section>

      <section className="dashboardGrid">
        <ScenarioPanel run={latestRun} generation={latestGeneration} />
        <ServerPanel server={server} />
        <AgentsPanel generation={latestGeneration} />
        <RewardPanel run={latestRun} />
        <PvpPanel pvp={pvp} />
        <LogsPanel server={server} />
        <RecentRunsPanel runs={snapshot?.scenario?.recentRuns || []} />
      </section>
    </main>
  );
}

function MetricTile({ label, value, detail, icon: Icon, tone }) {
  return (
    <article className={`metric ${tone || 'muted'}`}>
      <div className="metricIcon">
        <Icon size={20} aria-hidden="true" />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value ?? 'n/a'}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function ScenarioPanel({ run, generation }) {
  const completed = generation?.completedAgents || 0;
  const total = generation?.agentCount || 0;

  return (
    <Panel title="Scenario" icon={Activity} className="span2">
      <div className="scenarioHead">
        <div>
          <h2>{run?.task?.label || run?.task?.name || 'No active run found'}</h2>
          <p>{run?.id || 'game-completion-rl/runs is empty'}</p>
        </div>
        <StatusPill status={run?.status || 'waiting'} />
      </div>

      <div className="kvGrid">
        <KeyValue label="Generation" value={generation?.generation ? `${generation.generation} / ${run?.config?.generationsTarget || '?'}` : 'n/a'} />
        <KeyValue label="Agents" value={total ? `${completed}/${total} done` : run?.config?.agentCount || 'n/a'} />
        <KeyValue label="Episode" value={duration(generation?.episodeDurationMs || run?.config?.episodeMs)} />
        <KeyValue label="Started" value={formatTime(run?.startedAt)} />
        <KeyValue label="Trainer" value={run?.trainer?.algorithm || 'n/a'} />
        <KeyValue label="Population" value={run?.trainer?.populationSize || 'n/a'} />
      </div>

      {run?.task?.targetItems ? (
        <div className="targetStrip">
          {Object.entries(run.task.targetItems).map(([item, count]) => (
            <span key={item}>{item}: {count}</span>
          ))}
        </div>
      ) : null}

      {run?.checkpoint ? (
        <div className="checkpoint">
          <Database size={18} aria-hidden="true" />
          <span>Checkpoint generation {run.checkpoint.generation}</span>
          <strong>{run.checkpoint.best ? `${run.checkpoint.best.username} ${formatNumber(run.checkpoint.best.fitness)}` : 'no best genome'}</strong>
        </div>
      ) : null}
    </Panel>
  );
}

function ServerPanel({ server }) {
  return (
    <Panel title="Server" icon={Server}>
      <div className="serverStatus">
        <div className={`pulse ${server?.status === 'online' ? 'online' : ''}`} />
        <div>
          <strong>{server?.host || '127.0.0.1'}:{server?.port || 25565}</strong>
          <span>{server?.ready ? 'Paper is ready' : server?.status === 'online' ? 'port is open' : 'offline'}</span>
        </div>
      </div>

      <div className="kvList">
        <KeyValue label="RCON" value={server?.rcon?.enabled ? `${server.rcon.reachable ? 'reachable' : 'closed'}:${server.rcon.port}` : 'disabled'} />
        <KeyValue label="Mode" value={server?.config?.gamemode || 'n/a'} />
        <KeyValue label="Difficulty" value={server?.config?.difficulty || 'n/a'} />
        <KeyValue label="Level" value={server?.config?.['level-name'] || 'n/a'} />
        <KeyValue label="View" value={server?.config?.['view-distance'] || 'n/a'} />
        <KeyValue label="PVP" value={server?.config?.pvp || 'n/a'} />
      </div>

      <div className="players">
        <span>Recent players</span>
        {(server?.players || []).length ? (
          server.players.map(player => (
            <small key={`${player.username}-${player.state}`}>{player.username} {player.state}</small>
          ))
        ) : (
          <small>none in log tail</small>
        )}
      </div>
    </Panel>
  );
}

function AgentsPanel({ generation }) {
  const agents = generation?.agents || [];

  return (
    <Panel title="Agents" icon={Users} className="span2">
      <div className="agentTable">
        <div className="agentHeader">
          <span>Agent</span>
          <span>Progress</span>
          <span>Reward</span>
          <span>State</span>
        </div>
        {agents.length ? agents.map(agent => (
          <div className="agentRow" key={agent.username}>
            <div>
              <strong>{agent.username}</strong>
              <small>{formatPosition(agent.position)} {agent.heldItem ? `/ ${agent.heldItem}` : ''}</small>
            </div>
            <div>
              <ProgressBar value={agent.progress?.ratio} />
              <small>{formatProgress(agent.progress)}</small>
            </div>
            <strong>{formatNumber(agent.reward)}</strong>
            <span className={`state ${agent.done ? 'done' : 'active'}`}>{agent.reason || (agent.done ? 'done' : 'active')}</span>
          </div>
        )) : (
          <div className="empty">No generation agent data yet.</div>
        )}
      </div>
    </Panel>
  );
}

function RewardPanel({ run }) {
  const series = run?.rewardSeries || [];
  const latest = run?.latestGeneration;
  const bestAgent = latest?.bestAgent;

  return (
    <Panel title="Rewards" icon={BarChart3} className="span2">
      <MiniChart rows={series} />
      <div className="rewardFooter">
        <KeyValue label="Latest total" value={formatNumber(latest?.totalReward)} />
        <KeyValue label="Best agent" value={bestAgent ? bestAgent.username : 'n/a'} />
        <KeyValue label="Best reward" value={formatNumber(bestAgent?.reward)} />
        <KeyValue label="Source" value={latest?.source || 'n/a'} />
      </div>
    </Panel>
  );
}

function PvpPanel({ pvp }) {
  const latestEntries = Object.entries(pvp?.latest || {}).filter(([key]) => key !== 'g').slice(0, 12);

  return (
    <Panel title="PVP Reward Image" icon={ImageIcon} className="span2">
      {pvp?.graphImageUrl ? (
        <img className="rewardImage" src={pvp.graphImageUrl} alt="PVP reward trend chart" />
      ) : (
        <div className="imageFallback">No reward_trends.png found.</div>
      )}
      <div className="pvpBreakdown">
        <div>
          <strong>Generation {pvp?.latest?.g || 'n/a'}</strong>
          <span>{pvp?.imagePath || 'pvp/graphs/reward_trends.png'}</span>
        </div>
        <div className="chips">
          {latestEntries.map(([key, value]) => (
            <span key={key}>{key} {formatNumber(value)}</span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function LogsPanel({ server }) {
  const lines = server?.log?.lines || [];
  return (
    <Panel title="Server Log" icon={ScrollText} className="span2">
      <div className="logMeta">
        <span>{server?.log?.path || 'server/logs/latest.log'}</span>
        <span>{formatTime(server?.log?.mtime)}</span>
      </div>
      <pre className="logTail">{lines.slice(-32).join('\n') || 'No server log lines found.'}</pre>
    </Panel>
  );
}

function RecentRunsPanel({ runs }) {
  return (
    <Panel title="Recent Runs" icon={Clock3}>
      <div className="runList">
        {runs.length ? runs.map(run => (
          <div className="runLine" key={run.id}>
            <div>
              <strong>{run.task || 'unknown task'}</strong>
              <small>{run.id}</small>
            </div>
            <span>{run.latestGeneration || 0}</span>
            <StatusPill status={run.status} />
          </div>
        )) : <div className="empty">No run directories found.</div>}
      </div>
    </Panel>
  );
}

function MiniChart({ rows }) {
  const points = useMemo(() => {
    if (!rows?.length) return [];
    const values = rows.map(row => row.totalReward || 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return rows.map((row, index) => {
      const x = rows.length === 1 ? 50 : (index / (rows.length - 1)) * 100;
      const y = 82 - (((row.totalReward || 0) - min) / range) * 64;
      return { x, y, row };
    });
  }, [rows]);

  if (!points.length) return <div className="chartEmpty">No reward series yet.</div>;

  const pathData = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const areaData = `${pathData} L 100 92 L 0 92 Z`;

  return (
    <svg className="miniChart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Generation reward chart">
      <path d={areaData} className="chartArea" />
      <path d={pathData} className="chartLine" />
      {points.map(point => (
        <circle key={point.row.generation} cx={point.x} cy={point.y} r="1.6" className={point.row.status === 'failed' ? 'chartDot bad' : 'chartDot'} />
      ))}
    </svg>
  );
}

function Panel({ title, icon: Icon, className = '', children }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panelTitle">
        <Icon size={18} aria-hidden="true" />
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

function KeyValue({ label, value }) {
  return (
    <div className="keyValue">
      <span>{label}</span>
      <strong>{value ?? 'n/a'}</strong>
    </div>
  );
}

function StatusPill({ status }) {
  const normalized = String(status || 'unknown').toLowerCase();
  const Icon = normalized === 'online' || normalized === 'completed' ? CheckCircle2 : normalized === 'failed' ? AlertTriangle : Shield;
  return (
    <span className={`status ${normalized}`}>
      <Icon size={14} aria-hidden="true" />
      {status || 'unknown'}
    </span>
  );
}

function ProgressBar({ value }) {
  const pct = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) * 100 : 0;
  return (
    <div className="progress" aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatNumber(value, digits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en', {
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.abs(value) < 1 && value !== 0 ? 3 : 0
  }).format(value);
}

function formatTime(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function duration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${seconds}s`;
}

function formatPosition(position) {
  if (!position) return 'no position';
  return `${round(position.x)}, ${round(position.y)}, ${round(position.z)}`;
}

function formatProgress(progress) {
  if (!progress) return 'no task progress';
  const count = progress.count ?? 0;
  const target = progress.targetCount ?? '?';
  const percent = typeof progress.ratio === 'number' ? ` / ${Math.round(progress.ratio * 100)}%` : '';
  return `${count}/${target}${percent}`;
}

function round(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '?';
}
