# Server Profile

The shared server can load agents now, but the current hub server is configured for a flat peaceful experiment. A true complete-the-game project eventually needs a survival world profile.

Recommended settings for real training:

- `level-type=default`
- `generate-structures=true`
- `difficulty=normal`
- `spawn-monsters=true`
- `spawn-animals=true`
- `allow-nether=true`
- `pvp=false`
- `enable-rcon=true`
- `online-mode=false`

The scaffold applies runtime gamerules through RCON, but server.properties values such as `level-type`, `spawn-monsters`, and structure generation require a server restart and usually a fresh world.

Keep the current shared server unchanged while experimenting with the runtime. Before real training, create a separate server world or back up `../server/world*`, then apply a game-completion profile.
