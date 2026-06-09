# Architecture

## Goal

Build a reinforcement learning system where Minecraft agents can learn separate survival skills, then eventually compose those skills into full progression from spawning to defeating the Ender Dragon.

The current implementation uses task-specific NEAT populations. Each task has its own network population and checkpoint directory.

## Runtime Flow

1. `src/index.js` loads configuration from `src/config/default.js` plus environment overrides.
2. `Orchestrator` creates a run directory and optionally starts the shared Paper server.
3. `MinecraftRcon` connects to the server, applies runtime gamerules, and resets agents.
4. `GenerationRunner` creates the selected training task from `src/training-tasks/`.
5. Each generation asks the task to prepare the world. The starter tasks build per-agent cages using RCON.
6. Each generation spawns `AgentRuntime` instances through Mineflayer and resets each one to its task-provided spawn.
7. Agents produce task observations, including inventory, task progress, looking block, and nearest target block.
8. `NetworkPolicy` maps a task-specific NEAT genome to movement, look, attack, use, and dig actions.
9. The selected task calculates reward and terminal state.
10. `TrainerAdapter` assigns per-agent rewards back to genomes, evolves the population, and writes task-specific checkpoints.
11. `RunStore` writes generation summaries and transition JSONL.

## Training Tasks

Task folders live under `src/training-tasks/`.

- `wood_collection` builds 32x32 glass cages with grass floors and oak trees. Reward is based on collecting logs and completing the target count.
- `block_collection` builds 32x32 cages with dirt, sand, gravel, and dirt piles. Reward is based on collecting configured block drops.
- `movement` builds 32x32 cages with a start point, goal marker, and small obstacles. Reward is based on progress toward the goal.

Each task exports a default config and a task class. New tasks should define target items or progress logic, reward weights, cage settings, and `prepareEnvironment()` world generation.

## Future RL Extension Points

- Add more task folders for stone tools, iron, diamond, nether travel, blaze rods, eyes, stronghold, End, and dragon fight.
- Replace or extend `src/learning/trainer.js` if you want PPO/SAC/etc. instead of NEAT.
- Add curriculum management that decides when a trained task network is frozen and when the next task starts training.
- Add evaluator runs that freeze learning and compare policies across fixed seeds/worlds.

## Data Written Per Run

- `runs/<timestamp>-game-completion-rl/run.json`
- `runs/<timestamp>-game-completion-rl/generations/generation-0001/summary.json`
- `runs/<timestamp>-game-completion-rl/transitions/generation-0001-QuestAgent1.jsonl`
- `checkpoints/<task>/population.json`
- `checkpoints/<task>/generation-0001/manifest.json`

The population file is separate per task, so selecting `wood_collection` never mutates the movement or block-collection networks.

## Robustness Boundaries

- RCON connection startup retries for slow Paper boot and each command can reconnect after transient socket failures.
- Agents retry spawn, clean up failed Mineflayer clients, stop all controls on terminal/error states, and stop ticking after completion.
- Generation finalization is guarded by `finally`, so summaries are written and agents disconnect even if spawn, task, policy, or trainer hooks fail.
- Managed server shutdown uses RCON `stop` first, then process termination with a timeout fallback.
- Process-level `SIGINT`, `SIGTERM`, unhandled rejection, and uncaught exception handlers route through the same cleanup path.
