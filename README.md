# Splatter

A top-down paint shooter for up to 15 players. Shoot paint, cover the floor, and own the most of it when the 3-minute timer runs out. Play free-for-all with 15 personal colours, or Blue vs Orange vs Yellow in 5 v 5 v 5 teams. Empty slots are filled with bots.

## How it works

- `shared/sim.js` is the whole game simulation: physics, paint grid, bullets, objects, XP, classes and bots. The server runs it authoritatively; the browser runs it for practice mode.
- `server/index.js` serves the website and runs game rooms over WebSockets at `/ws`. Each room holds up to 15 tanks, ticks physics at 60 Hz and sends snapshots at 20 Hz.
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

## Controls

- Computer: WASD to move, mouse to aim, click to shoot, Space for your class special, 1–6 to upgrade stats.
- Phone: left thumb moves, right thumb aims and shoots, pink button for your special.
