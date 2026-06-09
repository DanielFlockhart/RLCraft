# AI Minecraft

This folder is the shared workspace for AI and Minecraft experiments.

## Layout

- `pvp/` - the current NEAT/Mineflayer PVP experiment, including ML source, npm package files, saved populations, charts, and local dependencies.
- `server/` - the Paper 1.18.1 Minecraft server runtime, worlds, config, logs, and generic startup script.
- `game-completion-rl/` - infrastructure scaffold for a future RL project where agents learn Minecraft survival progression.

## Commands

From the hub root:

- `npm run server:start` starts only the Minecraft server.
- `npm run pvp:start` starts the PVP bots against an already running server.
- `npm run pvp` starts the server, runs the PVP experiment, stops the server, and loops.
- `npm run distance:start` runs the older distance experiment from the PVP package.
- `npm run game:smoke` checks the game-completion RL scaffold without connecting to Minecraft.
- `npm run game:once` runs one generation of game-completion agents against an already running server.
- `npm run game:start` runs the configured game-completion generations against an already running server.
- `npm run game:managed` starts the shared server first, then runs the game-completion scaffold.

Server memory can be overridden when starting the server:

```sh
MINECRAFT_MIN_MEMORY=2G MINECRAFT_MAX_MEMORY=6G npm run server:start
```
