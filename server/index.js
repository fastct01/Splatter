// Color Duel game server: serves the client and runs authoritative game rooms over WebSockets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createSim, encodeGrid, CLASS_LIST, OBJ_TYPES, MAX_PLAYERS, lookCode } from '../shared/sim.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public'), SHARED = path.join(ROOT, 'shared');
const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 50;                 // 20 snapshots per second
const SIM_DT = 1/60;                // 60 physics steps per second
const END_PAUSE = 12;               // seconds between matches
const MIN_PLAYERS = 2;              // a match starts once this many players are in the room
const MIME = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json', '.mp3':'audio/mpeg', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json'};

/* ---------- rooms ---------- */
const rooms = new Map();
let roomSeq = 0;

class Room {
  constructor(mode){
    this.id = ++roomSeq; this.mode = mode;
    this.clients = new Set();
    this.stamps = []; this.events = [];
    this.phase = 'wait'; this.endT = 0; this.rosterDirty = false;
    this.acc = 0; this.last = Date.now();
    this.sim = createSim({
      mode, bots: false,
      onStamp: (x, y, r, o, rot) => this.stamps.push(Math.round(x), Math.round(y), Math.round(r), o, Math.round(rot*1000)),
      onEvent: e => this.onEvent(e)
    });
    rooms.set(this.id, this);
    console.log(`room ${this.id} (${mode}) created`);
  }
  onEvent(e){
    if (e.k === 'roster'){ this.rosterDirty = true; return; }
    if (e.k === 'end'){ this.phase = 'end'; this.endT = END_PAUSE; this.events.push({k:'end'}); return; }
    this.events.push(e);
  }
  roster(){ return this.sim.G.tanks.map(t => ({id:t.id, name:t.name, slot:t.slot, team:t.team, human:t.human})); }
  matchInfo(c){
    const G = this.sim.G;
    return {type:'match', you:c.tankId, mode:this.mode, obstacles:G.obstacles, grid:encodeGrid(G.grid), counts:Array.from(G.counts),
            paintable:G.paintable, time:G.time, phase:this.phase, endT:this.endT, roster:this.roster()};
  }
  join(c, name){
    const t = this.sim.addHuman({name});
    if (!t) return false;
    c.room = this; c.tankId = t.id; this.clients.add(c);
    this.rosterDirty = true;
    send(c, this.matchInfo(c));
    if (this.phase === 'wait' && this.clients.size >= MIN_PLAYERS) this.startMatch();
    return true;
  }
  startMatch(){
    this.phase = this.clients.size >= MIN_PLAYERS ? 'play' : 'wait';
    this.acc = 0; this.stamps = []; this.events = [];
    this.sim.resetMatch();
    this.rosterDirty = false;
    for (const c of this.clients) send(c, this.matchInfo(c));
  }
  leave(c){
    this.clients.delete(c);
    if (c.tankId) this.sim.removeHuman(c.tankId);
    c.room = null;
    if (!this.clients.size){ rooms.delete(this.id); console.log(`room ${this.id} closed`); }
  }
  tick(){
    const now = Date.now();
    let dt = (now - this.last)/1000; this.last = now;
    if (dt > 0.25) dt = 0.25;
    if (this.phase === 'play' || this.phase === 'wait'){
      const untimed = this.phase === 'wait';
      this.acc += dt;
      let n = 0;
      while (this.acc >= SIM_DT && n < 15){ this.sim.step(SIM_DT, untimed); this.acc -= SIM_DT; n++; if (this.phase === 'end') break; }
    } else {
      this.endT -= dt;
      if (this.endT <= 0){ this.startMatch(); return; }
    }
    this.broadcast();
  }
  broadcast(){
    const G = this.sim.G;
    const roster = this.rosterDirty ? this.roster() : null; this.rosterDirty = false;
    const tanks = G.tanks.map(t => [t.id, Math.round(t.x), Math.round(t.y), Math.round(t.aim*100), CLASS_LIST.indexOf(t.cls), t.slot, t.team,
      Math.ceil(Math.max(0,t.hp)), Math.round(t.mhp),
      (t.dead?1:0) | (t.protect>0?2:0) | (t.flash>0?4:0) | (t.charge?8:0) | (t.spinning?16:0) | (t.human?32:0) | (t.moving?64:0),
      t.level, Math.round(t.spinA*100), lookCode(t)]);
    const bombs = G.bombs.map(b => [b.id, Math.round(b.x0), Math.round(b.y0), Math.round(b.x1), Math.round(b.y1), Math.round(b.t*1000), Math.round(b.T*1000), b.po, b.R]);
    const common = {type:'snap', t:Date.now(), tm:Math.round(G.time*10)/10, ph:this.phase, T:tanks, M:bombs, P:this.stamps, C:Array.from(G.counts)};
    if (roster) common.R = roster;
    const shared = this.events.filter(e => e.k === 'kill' || e.k === 'ring' || e.k === 'gold' || e.k === 'end');
    for (const c of this.clients){
      const me = this.sim.getTank(c.tankId);
      if (!me) continue;
      const scope = me.cls === 'liner' && me.specialT > 0 ? 1.6 : 1;
      const ax = 1700*scope, ay = 1150*scope;
      const B = [], O = [];
      for (const b of G.bullets) if (Math.abs(b.x - me.x) < ax && Math.abs(b.y - me.y) < ay) B.push([b.id, Math.round(b.x), Math.round(b.y), b.po, b.r]);
      for (const o of G.objects) if (Math.abs(o.x - me.x) < ax && Math.abs(o.y - me.y) < ay) O.push([o.id, Math.round(o.x), Math.round(o.y), Math.round(o.rot*100), OBJ_TYPES.indexOf(o.type), Math.ceil(o.hp), o.maxHp, o.flash > 0 ? 1 : 0]);
      const E = shared.concat(this.events.filter(e => (e.id === c.tankId) || (e.k === 'hit' && e.by === c.tankId)));
      const Y = {id:me.id, vx:Math.round(me.vx), vy:Math.round(me.vy), ink:Math.round(me.ink), icap:Math.round(me.icap), xp:Math.round(me.xp), xpn:me.xpn,
        pts:me.points, st:me.stats, scd:Math.round(me.specialCd*10)/10, sT:Math.round(me.specialT*10)/10, sf:me.surface, cp:me.classPending?1:0, rt:Math.round(me.respawnT*10)/10,
        cells:me.cellsPainted, spl:me.splats, xpt:Math.round(me.xpTotal), kb:me.killedBy};
      send(c, Object.assign({}, common, {B, O, E, Y}));
    }
    this.stamps = []; this.events = [];
  }
}

function findRoom(mode){
  let best = null;
  for (const r of rooms.values()){
    if (r.mode !== mode || r.clients.size >= MAX_PLAYERS) continue;
    if (!best || r.clients.size > best.clients.size) best = r;
  }
  return best || new Room(mode);
}

function send(c, msg){
  if (c.ws.readyState !== 1) return;
  if (c.ws.bufferedAmount > 1_000_000) return;       // slow client: skip this snapshot
  c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

setInterval(() => { for (const r of rooms.values()) r.tick(); }, TICK_MS);

/* ---------- HTTP ---------- */
function serveFile(res, file){
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()){ res.writeHead(404, {'content-type':'text/plain'}); res.end('Not found'); return; }
    res.writeHead(200, {'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache'});
    fs.createReadStream(file).pipe(res);
  });
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/health'){ res.writeHead(200, {'content-type':'text/plain'}); res.end('ok'); return; }
  if (p === '/api/status'){
    let players = 0; const byMode = {ffa:0, teams:0};
    for (const r of rooms.values()){ players += r.clients.size; byMode[r.mode] += r.clients.size; }
    res.writeHead(200, {'content-type':'application/json', 'cache-control':'no-store'});
    res.end(JSON.stringify({players, rooms: rooms.size, byMode})); return;
  }
  let base = PUBLIC, rel = p === '/' ? '/index.html' : p;
  if (rel.startsWith('/shared/')){ base = SHARED; rel = rel.slice('/shared'.length); }
  const file = path.join(base, path.normalize(rel));
  if (!file.startsWith(base + path.sep)){ res.writeHead(403); res.end(); return; }
  serveFile(res, file);
});

/* ---------- WebSockets ---------- */
const wss = new WebSocketServer({server, path:'/ws', maxPayload: 4096});
wss.on('connection', ws => {
  const c = {ws, room:null, tankId:0, alive:true, msgs:0, window:Date.now()};
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', data => {
    const now = Date.now();
    if (now - c.window > 1000){ c.window = now; c.msgs = 0; }
    if (++c.msgs > 90) return;                      // rate limit
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join' && !c.room){
      const mode = m.mode === 'teams' ? 'teams' : 'ffa';
      const name = String(m.name || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16) || 'Player';
      const room = findRoom(mode);
      if (!room.join(c, name)) send(c, {type:'error', text:'That room is full. Try again.'});
      return;
    }
    if (!c.room) return;
    const sim = c.room.sim;
    if (m.t === 'in') sim.setInput(c.tankId, m);
    else if (m.t === 'up') sim.upgrade(c.tankId, Math.floor(+m.i));
    else if (m.t === 'cls') sim.pickClass(c.tankId, String(m.k));
  });
  ws.on('close', () => { if (c.room) c.room.leave(c); });
  ws.on('error', () => {});
});
setInterval(() => {
  for (const ws of wss.clients){
    const c = [...rooms.values()].flatMap(r => [...r.clients]).find(x => x.ws === ws);
    if (c && !c.alive){ ws.terminate(); continue; }
    if (c) c.alive = false;
    try { ws.ping(); } catch {}
  }
}, 10000);

server.listen(PORT, () => console.log(`Color Duel listening on ${PORT}`));

function shutdown(){
  console.log('shutting down');
  for (const ws of wss.clients){ try { ws.close(1012, 'Server restarting'); } catch {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
