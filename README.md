# Splatter

A top-down paint shooter for up to 15 players. Shoot paint, cover the floor, and own the most of it when the 3-minute timer runs out. Play free-for-all with 15 personal colours, or Blue vs Orange vs Yellow in 5 v 5 v 5 teams. Online matches are real players only; a match starts once 2 players are in the room. Practice mode lets you play offline against bots.

## How it works

- `shared/sim.js` is the whole game simulation: physics, paint grid, bullets, objects, XP, classes and bots. Players are 2.5D sprites with 8 facing directions, drawn in the client from SVG. The server runs it authoritatively; the browser runs it for practice mode.
- `server/index.js` serves the website and runs game rooms over WebSockets at `/ws`. Each room holds up to 15 players, ticks physics at 60 Hz and sends snapshots at 20 Hz.
- `public/index.html` is the client: menus, rendering, input, interpolation and touch controls.

## Run locally

```
npm install
npm start
```

Open http://localhost:3000. Open a second tab to play against yourself.

## Deploy on Render

Create a **Web Service** from this repo:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`
- Region: Frankfurt (closest to the UK)

Run exactly one instance per service: WebSocket players must reach the instance that hosts their room. To grow, add more services rather than more instances.

The free plan sleeps after 15 minutes without traffic and takes about a minute to wake up. Use a paid instance for real players.

## Classes and upgrades

Pick a class on the title screen before you play. You keep it for the whole match; on the results screen you can pick a different one for the next match.

| Class | Plays like | Special (Space) | Its 6 upgrades |
|---|---|---|---|
| Blaster | Steady shots at medium range | 2 s of double fire rate | Fire rate, shot damage, range, ink tank, health, move speed |
| Roller | Paints a wide stripe by walking | 1.5 s charge, double ram damage | Roller width, ram damage, charge reload, ink tank, health, move speed |
| Bomber | Lobs bombs that burst into big splashes | Next bomb splits into 4 | Blast radius, bomb damage, reload, throw range, ink tank, health |
| Liner | Long-range sniper that paints thin lines | Zoom out for 4 s | Shot damage, range, line width, reload, ink tank, move speed |

Every 50 XP gives 1 upgrade point and an upgrade costs 10 points, so you get one upgrade per 500 XP. Each upgrade goes up to 8 levels. XP comes from painting, breaking objects and splatting players.

## Controls

- Computer: WASD to move, mouse to aim, click to shoot, Space for your class special, 1–6 to upgrade stats.
- Phone: left thumb moves, right thumb aims and shoots, pink button for your special.
