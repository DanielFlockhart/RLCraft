# PVP NEAT Experiment

This package contains the Mineflayer bots, sensors, NEAT evolution code, saved populations, and reward charts for the PVP experiment.

## Layout

- `src/` - bot control, sensors, RCON helpers, NEAT evolution, and experiment config.
- `artifacts/` - saved population data.
- `graphs/` - reward history and rendered reward charts.
- `run_pvp.sh` - starts the shared server, runs PVP, stops the server, and repeats.

## Commands

From this folder:

- `npm run start:pvp` runs the PVP experiment against an already running server.
- `npm run start:distance` runs the older distance experiment.
- `./run_pvp.sh` starts the shared server and loops the PVP experiment.

From the hub root, use:

- `npm run pvp`
- `npm run pvp:start`
- `npm run server:start`

The shared Paper server lives in `../server`. PVP uses RCON on port `25575` and Mineflayer on port `25565`, as configured in `src/experiments/_base/config.js`.

## Notes

The PVP experiment runs a round-robin each generation with parallel matches in separated glass arenas. Bots are restricted to Mineflayer inputs and sensor state rather than direct access to hidden game data.
