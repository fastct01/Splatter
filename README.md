# Bubble Arena

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

Everyone starts each match as a **Rookie** with a basic paint pistol. Rookie upgrades are cheap (4 points each). After your 5th upgrade a class menu pops up in the middle of the screen. You keep full control while it's open: click a class or press 1–4, and your player transforms into it. Upgrades the new class also has carry over; the rest are refunded as points. Bots pick a class at random.

| Class | Plays like | Special (Space) | Its 6 upgrades |
|---|---|---|---|
| Blaster | Steady shots at medium range | 2 s of double fire rate | Fire rate, shot damage, range, ink tank, health, move speed |
| Roller | Paints a wide stripe by walking | 1.5 s charge, double ram damage | Roller width, ram damage, charge reload, ink tank, health, move speed |
| Bomber | Lobs bombs that burst into big splashes | Next bomb splits into 4 | Blast radius, bomb damage, reload, throw range, ink tank, health |
| Liner | Long-range sniper that paints thin lines | Zoom out for 4 s | Shot damage, range, line width, reload, ink tank, move speed |

Upgrades show on your player in every facing direction: level 3 adds a small change (bigger muzzle, drum magazine, armour vest, painted sneakers), level 6 a bigger one (twin barrel, spikes, helmet, second ink tank). When every upgrade is maxed the antenna light turns gold. The designs are on the Class upgrades board in the mockups.

Your level is the number of upgrades you've bought, and the bar under it fills with the points towards the next one (for example 3/4). Every 10 XP gives 1 upgrade point. Class upgrades cost 10 points (one per 100 XP) and go up to 8 levels each. XP comes only from splatting players and breaking floating objects (paint tin 15, prism 45, drum 60, gold 200); painting the floor gives none. In bot tests most players unlock their class 40 s to 2 min into the 3-minute match.

## Controls

- Computer: WASD to move, mouse to aim, click to shoot, Space for your class special, M to mute, 1–6 to upgrade, 1–4 to pick a class when the class menu is open.
- Phone: left thumb moves, right thumb aims and shoots, pink button for your special.
