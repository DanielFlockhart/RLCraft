# Game Completion RL

Infrastructure for training Minecraft agents on separate game-completion skills before combining them into longer survival progression.

The runner now supports selectable training tasks. Each task owns its reward signal, per-agent spawn points, and world-generation recipe. The trainer keeps a separate NEAT population for each task under `checkpoints/<task>/population.json`, so wood collection, block collection, movement, and future tasks train separate networks.

## Commands

- `npm run once` runs one short generation against an already running server.
- `npm start` runs the configured number of generations against an already running server.
- `npm run start:managed-server` starts the shared server first, then runs generations.
- `npm run train:wood` trains `wood_collection` against an already running server.
- `npm run train:block` trains `block_collection` against an already running server.
- `npm run train:movement` trains `movement` against an already running server.
- `npm run train:wood:managed`, `npm run train:block:managed`, and `npm run train:movement:managed` start the server first.
- `npm run smoke` checks config/task/policy wiring without connecting to Minecraft.

The root `run-gcrl.sh` script accepts a task name and starts the managed server. It defaults to `GENERATIONS=1000`; set `GENERATIONS=...` yourself for shorter or longer runs.

```sh
./run-gcrl.sh wood_collection
./run-gcrl.sh block_collection
./run-gcrl.sh movement
```

From the hub root, the same project is exposed as:

- `npm run game:once`
- `npm run game:start`
- `npm run game:managed`
- `npm run game:smoke`

## Layout

- `src/runtime/` - server process control, RCON, agent lifecycle, and generation runner.
- `src/training-tasks/` - selectable task folders and shared cage/world-generation helpers.
- `src/tasks/` - legacy full-game task definition.
- `src/policies/` - network policy that maps task observations to controls, look deltas, attack/use/dig.
- `src/learning/` - NEAT population trainer, observation encoder, and task-specific checkpoint writer.
- `src/storage/` - run directory and JSONL transition writer.
- `runs/` - generated run logs and metrics.
- `checkpoints/` - future model/checkpoint output.
- `docs/architecture.md` - architecture plan and extension points.
- `docs/server-profile.md` - server settings needed before true full-game training.

## Environment Overrides

```sh
AGENTS=4 GENERATIONS=3 EPISODE_MS=120000 npm start
START_SERVER=true AGENTS=2 npm start
MC_HOST=localhost MC_PORT=25565 RCON_PASSWORD=mypassword npm run once
TRAINING_TASK=wood_collection AGENTS=8 GENERATIONS=20 npm start
TRAINING_TASK=movement TASK_CAGE_SIZE=40 npm start
```

Available `TRAINING_TASK` values are `wood_collection`, `block_collection`, `movement`, and `complete-game`. Aliases such as `wood`, `blocks`, and `move` are also accepted.

The current shared server can load agents now. Task training builds its own cages with RCON, but before true full-game training, switch the server away from the current flat peaceful profile; see `docs/server-profile.md`.

Human players can join the shared server as observers. The server defaults joining players to spectator mode, training bots are reset to survival individually, player entities are ignored by the task observations, bots do not attack players, and cleanup targets exact bot usernames.

At generation 1, task training clears the configured training area before rebuilding cages. This removes old PvP arenas or stale task cages around the task origin. Defaults cover a 192-block radius and can be adjusted with `TRAINING_AREA_RADIUS`, `TRAINING_AREA_CLEAR_MIN_Y`, and `TRAINING_AREA_CLEAR_MAX_Y`. Set `RESET_WORLD_EVERY_GENERATION=true` only if you want the large reset before every generation; the default is once per run to avoid unnecessary RCON load.

## Robustness

The runtime handles slow Paper startup, RCON reconnects, per-command RCON retries, agent spawn retries, failed policy actions, per-generation cleanup, managed server shutdown through RCON, and forced server process termination if graceful shutdown hangs. Generation summaries include `status`, `errors`, episode duration, per-agent completion state, task progress, looking block, and nearest target block.
