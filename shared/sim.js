// Splatter shared simulation: runs on the server (authoritative) and in the browser (practice mode).
// No DOM, no Node APIs.

export const WW = 3600, WH = 2160, CELL = 12, GW = 300, GH = 180, MATCH = 180, MAX_PLAYERS = 15;
export const PCOL = ['#E4E2DD','#FF2D87','#FF3B3B','#FF8A1F','#FFB020','#FFD21F','#9BE22D','#2DBE5A','#5EE6B0','#1FD6D0','#4FC3FF','#2D8CFF','#4B5BFF','#9B5CFF','#E040FB','#A0622D'];
export const PNAME = ['','Pink','Red','Orange','Amber','Yellow','Lime','Green','Mint','Aqua','Sky','Blue','Indigo','Purple','Magenta','Cocoa'];
export const TCOL = [null,'#2D8CFF','#FF8A1F','#FFD21F'];
export const TNAME = ['','Blue','Orange','Yellow'];
export const CLASSES = {
  splat:     {label:'Splat', r:30, mass:1.0, rate:3, speed:700, range:520, dmg:12, ink:3, splat:42, br:8},
  roller:    {label:'Roller', r:34, mass:1.4, rate:2, speed:700, range:300, dmg:10, ink:2, splat:34, br:8, desc:'Paints a wide stripe just by driving', spec:'Charge', specLong:'Special: 1.5 s charge, double ram damage'},
  bomber:    {label:'Bomber', r:32, mass:1.2, rate:0.8, speed:900, range:650, dmg:35, ink:12, splat:110, br:12, bomb:true, desc:'Lobs ink bombs that burst into big splashes', spec:'Cluster', specLong:'Special: next bomb splits into 4'},
  sprayer:   {label:'Sprayer', r:30, mass:1.0, rate:2, speed:600, range:340, dmg:7, ink:8, splat:30, br:7, spread:5, desc:'Spray gun: a 5-shot spread in front', spec:'Spin', specLong:'Special: 3 s of spinning spray'},
  liner:     {label:'Liner', r:28, mass:0.9, rate:1, speed:1500, range:1100, dmg:30, ink:10, splat:30, br:6, line:true, desc:'Long-range sniper that paints thin lines', spec:'Scope', specLong:'Special: zoom out for 4 s'}
};
export const CLASS_LIST = ['splat','roller','bomber','sprayer','liner'];
export const CLASS_KEYS = ['roller','bomber','sprayer','liner'];
export const STAT_NAMES = ['Ink capacity','Bullet damage','Fire rate','Bullet range','Hull health','Move speed'];
export const OBJ_TYPES = ['can','barrel','gold'];
export const OBJ = {can:{hp:20,mass:2,xp:10,r:22,splat:50}, barrel:{hp:80,mass:6,xp:50,r:30,splat:120}, gold:{hp:200,mass:4,xp:200,r:26,splat:160}};
const BOT_NAMES = ['blue_wave','limelight','tangerine','sunny','purp','aqua','redline','honey','moss','minty','skyhigh','indigo','magenta','cocoa','splatcat','drip','smudge','inky','roller_rex','blotto','gloss','tint'];

export const xpNeed = n => Math.round(15*Math.pow(n,1.4));
export const maxHpOf = stats => 100 + 12*stats[4];
export const inkCapOf = stats => 100*(1 + 0.12*stats[0]);
const TAU = Math.PI*2;
const rand = (a,b) => a + Math.random()*(b-a);
const clamp = (v,a,b) => v < a ? a : v > b ? b : v;
function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

/* ---------- splat shape and mask (no canvas needed) ---------- */
export const SPLAT_PATH = 'M0,-40 C20,-44 30,-30 42,-34 C50,-20 36,-6 46,8 C52,22 30,26 26,40 C14,50 -4,36 -18,44 C-34,46 -30,26 -44,16 C-52,0 -36,-10 -40,-26 C-36,-40 -16,-34 0,-40 Z';
export const MASK_N = 64, MASK_S = 32/52;
export const MASK = (() => {
  const nums = SPLAT_PATH.replace(/[MCZ]/g,' ').trim().split(/[\s,]+/).map(Number);
  const poly = [[nums[0], nums[1]]];
  for (let i=2; i+5<nums.length; i+=6){
    const [x0,y0] = poly[poly.length-1];
    const x1=nums[i], y1=nums[i+1], x2=nums[i+2], y2=nums[i+3], x3=nums[i+4], y3=nums[i+5];
    for (let k=1;k<=12;k++){ const t=k/12, u=1-t; poly.push([u*u*u*x0+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3, u*u*u*y0+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3]); }
  }
  const m = new Uint8Array(MASK_N*MASK_N);
  for (let py=0;py<MASK_N;py++) for (let px=0;px<MASK_N;px++){
    const x = (px+0.5-32)/MASK_S, y = (py+0.5-32)/MASK_S;
    let inside = false;
    for (let i=0,j=poly.length-1;i<poly.length;j=i++){
      const [xi,yi]=poly[i], [xj,yj]=poly[j];
      if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside = !inside;
    }
    m[py*MASK_N+px] = inside ? 1 : 0;
  }
  return m;
})();

// Paints one splat into the grid. Returns the number of cells that changed owner.
export function stampGrid(grid, counts, x, y, r, owner, rot){
  const ext = r*1.25;
  const i0 = Math.max(0, Math.floor((x-ext)/CELL)), i1 = Math.min(GW-1, Math.floor((x+ext)/CELL));
  const j0 = Math.max(0, Math.floor((y-ext)/CELL)), j1 = Math.min(GH-1, Math.floor((y+ext)/CELL));
  const k = 44/r*MASK_S, c = Math.cos(-rot), s = Math.sin(-rot);
  let changed = 0;
  for (let j=j0;j<=j1;j++){
    const dy = (j+0.5)*CELL - y;
    for (let i=i0;i<=i1;i++){
      const idx = j*GW+i, v = grid[idx];
      if (v === 255 || v === owner) continue;
      const dx = (i+0.5)*CELL - x;
      const px = Math.floor(32 + (dx*c - dy*s)*k), py = Math.floor(32 + (dx*s + dy*c)*k);
      if (px<0 || py<0 || px>=MASK_N || py>=MASK_N || !MASK[py*MASK_N+px]) continue;
      if (counts){ counts[v]--; counts[owner]++; }
      grid[idx] = owner; changed++;
    }
  }
  return changed;
}

// Run-length encoding of the paint grid, for players who join mid-match.
export function encodeGrid(grid){
  const out = []; let v = grid[0], n = 0;
  for (let i=0;i<grid.length;i++){ if (grid[i] === v) n++; else { out.push(v, n); v = grid[i]; n = 1; } }
  out.push(v, n); return out;
}
export function decodeGrid(rle, grid){
  let p = 0; for (let i=0;i<rle.length;i+=2){ grid.fill(rle[i], p, p + rle[i+1]); p += rle[i+1]; }
}

/* ---------- the simulation ---------- */
export function createSim(opts){
  const mode = opts.mode === 'teams' ? 'teams' : 'ffa';
  const onStamp = opts.onStamp || (() => {});
  const onEvent = opts.onEvent || (() => {});
  const useBots = opts.bots !== false;
  let nextId = 1, nextB = 1;
  const G = {mode, grid:new Uint8Array(GW*GH), counts:new Int32Array(16), paintable:0, tanks:[], bullets:[], bombs:[], objects:[],
             obstacles:[], time:MATCH, clock:0, over:false, goldT:25};

  const paintOwner = t => mode === 'teams' ? t.team : t.slot;
  const isEnemy = (a,b) => a !== b && (mode !== 'teams' || a.team !== b.team);
  function inObstacle(x,y,pad){ pad = pad||0; for (const o of G.obstacles) if (x>o.x-pad && x<o.x+o.w+pad && y>o.y-pad && y<o.y+o.h+pad) return true; return false; }
  function gridAt(x,y){ const i = Math.floor(x/CELL), j = Math.floor(y/CELL); if (i<0||j<0||i>=GW||j>=GH) return 255; return G.grid[j*GW+i]; }

  function genObstacles(){
    const obs = []; let tries = 0;
    while (obs.length < 15 && tries < 3000){
      tries++;
      const w = Math.round(rand(60,220)), h = Math.round(rand(60,220));
      const x = Math.round(380 + Math.random()*(WW-760-w)), y = Math.round(260 + Math.random()*(WH-640-h));
      if (obs.some(o => x<o.x+o.w+150 && x+w+150>o.x && y<o.y+o.h+150 && y+h+150>o.y)) continue;
      if (Math.hypot(x+w/2-WW/2, y+h/2-WH/2) < 280) continue;
      obs.push({x,y,w,h});
    }
    return obs;
  }

  function makeTank(o){
    const t = Object.assign({id:nextId++, name:'', human:false, slot:1, team:0, x:0, y:0, vx:0, vy:0, aim:0, aimDist:400, cls:'splat', r:30,
      level:1, xp:0, xpTotal:0, points:0, stats:[0,0,0,0,0,0], hp:100, ink:100, reload:0, specialCd:0, specialT:0, cluster:false,
      surface:0, sm:1, am:1, lastHit:-99, dead:false, respawnT:0, protect:2, flash:0, cellsPainted:0, paintAcc:0, splats:0, deaths:0,
      trailAcc:0, spinA:0, spinReload:0, moving:false, damagers:{}, killedBy:'', classPending:false, charge:false, spinning:false,
      ai:{think:0, wpT:0, strafe:Math.random()<0.5?1:-1, err:0, strafeT:0},
      input:{mx:0,my:0,fire:false,special:false}}, o);
    refresh(t);
    return t;
  }
  function refresh(t){ t.mhp = maxHpOf(t.stats); t.icap = inkCapOf(t.stats); t.xpn = xpNeed(t.level); t.charge = t.cls === 'roller' && t.specialT > 0; t.spinning = t.cls === 'sprayer' && t.specialT > 0; }

  function usedNames(){ return new Set(G.tanks.map(t => t.name)); }
  function botName(){ const used = usedNames(); const free = BOT_NAMES.filter(n => !used.has(n)); return free.length ? free[Math.floor(Math.random()*free.length)] : 'bot' + nextId; }
  function freeSlots(){ const used = new Set(G.tanks.map(t => t.slot)); const s = []; for (let k=1;k<=15;k++) if (!used.has(k)) s.push(k); return shuffle(s); }

  function fillBots(){
    while (useBots && G.tanks.length < MAX_PLAYERS){
      let team = 0;
      if (mode === 'teams'){ const c = [0,0,0,0]; for (const t of G.tanks) c[t.team]++; team = [1,2,3].find(k => c[k] < 5); }
      const t = makeTank({name:botName(), slot:freeSlots()[0], team});
      G.tanks.push(t); spawnTank(t);
    }
  }

  function resetMatch(){
    G.grid.fill(0); G.counts.fill(0); G.paintable = 0;
    G.obstacles = genObstacles();
    for (let j=0;j<GH;j++) for (let i=0;i<GW;i++){ if (inObstacle((i+0.5)*CELL,(j+0.5)*CELL,0)) G.grid[j*GW+i] = 255; else G.paintable++; }
    G.counts[0] = G.paintable;
    G.time = MATCH; G.clock = 0; G.over = false; G.bullets = []; G.bombs = []; G.objects = []; G.goldT = 25;
    const humans = G.tanks.filter(t => t.human);
    G.tanks = humans.map(h => makeTank({id:h.id, name:h.name, human:true, slot:h.slot, team:h.team}));
    for (const t of G.tanks) spawnTank(t);
    fillBots();
    for (let k=0;k<40;k++) spawnObject(Math.random() < 0.75 ? 'can' : 'barrel');
    onEvent({k:'roster'});
  }

  function addHuman(o){
    const want = o.slot >= 1 && o.slot <= 15 ? o.slot : 1;
    if (!useBots){
      if (G.tanks.length >= MAX_PLAYERS) return null;
      let team = 0;
      if (mode === 'teams'){ const c = [0,0,0,0]; for (const t of G.tanks) c[t.team]++; team = shuffle([1,2,3]).sort((a,b) => c[a] - c[b])[0]; if (c[team] >= 5) return null; }
      const slot = G.tanks.some(t => t.slot === want) ? freeSlots()[0] : want;
      const t = makeTank({name:o.name || 'Player', human:true, slot, team});
      G.tanks.push(t); spawnTank(t);
      onEvent({k:'roster'});
      return t;
    }
    const bots = G.tanks.filter(t => !t.human);
    if (!bots.length) return null;
    let victim;
    if (mode === 'teams'){
      const hc = [0,0,0,0]; for (const t of G.tanks) if (t.human) hc[t.team]++;
      const order = shuffle([1,2,3]).sort((a,b) => hc[a] - hc[b]);
      const team = order.find(tm => bots.some(b => b.team === tm));
      const pool = bots.filter(b => b.team === team);
      victim = pool.find(b => b.slot === want) || pool[Math.floor(Math.random()*pool.length)];
    } else {
      victim = bots.find(b => b.slot === want) || bots[Math.floor(Math.random()*bots.length)];
    }
    let slot = victim.slot;
    if (slot !== want){ const holder = G.tanks.find(t => t.slot === want); if (holder && !holder.human){ holder.slot = slot; slot = want; } }
    const t = makeTank({name:o.name || 'Player', human:true, slot, team:victim.team});
    G.tanks[G.tanks.indexOf(victim)] = t;
    spawnTank(t);
    onEvent({k:'roster'});
    return t;
  }
  function removeHuman(id){
    const i = G.tanks.findIndex(t => t.id === id); if (i < 0) return;
    if (!useBots){ G.tanks.splice(i, 1); onEvent({k:'roster'}); return; }
    const h = G.tanks[i];
    const b = makeTank({name:'', slot:h.slot, team:h.team});
    G.tanks[i] = b; b.name = botName(); spawnTank(b);
    onEvent({k:'roster'});
  }
  function getTank(id){ return G.tanks.find(t => t.id === id); }
  function setInput(id, inp){
    const t = getTank(id); if (!t || !t.human) return;
    t.input.mx = clamp(+inp.mx || 0, -1, 1); t.input.my = clamp(+inp.my || 0, -1, 1);
    t.input.fire = !!inp.f;
    if (inp.s) t.input.special = true;
    if (Number.isFinite(+inp.a)) t.aim = +inp.a;
    if (Number.isFinite(+inp.d)) t.aimDist = clamp(+inp.d, 0, 3000);
  }
  function upgradeId(id, i){ const t = getTank(id); if (t && Number.isInteger(i) && i >= 0 && i < 6) upgrade(t, i); }
  function pickClass(id, k){ const t = getTank(id); if (t && t.cls === 'splat' && t.level >= 15 && CLASS_KEYS.includes(k)) setClass(t, k); }

  function spawnTank(t){
    t.r = CLASSES[t.cls].r;
    let x, y;
    if (mode === 'teams'){
      for (let k=0;k<40;k++){
        if (t.team===1){ x = rand(90,320); y = rand(200,WH-420); }
        else if (t.team===2){ x = rand(WW-320,WW-90); y = rand(200,WH-420); }
        else { x = rand(600,WW-600); y = rand(WH-320,WH-90); }
        if (!inObstacle(x,y,t.r+20)) break;
      }
    } else {
      let best = null, bd = -1;
      for (let k=0;k<30;k++){
        const px = rand(150,WW-150), py = rand(150,WH-150);
        if (inObstacle(px,py,t.r+30)) continue;
        let md = 1e9; for (const e of G.tanks) if (e!==t && !e.dead && e.x) md = Math.min(md, Math.hypot(e.x-px,e.y-py));
        if (md >= 600){ best = [px,py]; break; }
        if (md > bd){ bd = md; best = [px,py]; }
      }
      [x,y] = best || [WW/2, WH/2];
    }
    Object.assign(t, {x, y, vx:0, vy:0, dead:false, protect:2, reload:0, damagers:{}, specialT:0});
    refresh(t); t.hp = t.mhp; t.ink = t.icap;
  }

  function spawnObject(type, near){
    const d = OBJ[type];
    for (let k=0;k<30;k++){
      const x = near ? WW/2 + rand(-260,260) : rand(120,WW-120), y = near ? WH/2 + rand(-200,200) : rand(120,WH-120);
      if (inObstacle(x,y,d.r+20)) continue;
      if (G.tanks.some(t => !t.dead && Math.hypot(t.x-x,t.y-y) < 220)) continue;
      G.objects.push({id:nextB++, type, x, y, vx:0, vy:0, dir:rand(0,TAU), rot:rand(0,6), vr:rand(-0.6,0.6), hp:d.hp, maxHp:d.hp, mass:d.mass, r:d.r, flash:0, dead:false});
      return;
    }
  }

  function stamp(x, y, r, owner, credit){
    const rot = Math.random()*TAU;
    const changed = stampGrid(G.grid, G.counts, x, y, r, owner, rot);
    onStamp(x, y, r, owner, rot);
    if (credit && changed){
      credit.cellsPainted += changed; credit.paintAcc += changed;
      const gain = Math.floor(credit.paintAcc/4); if (gain){ credit.paintAcc -= gain*4; addXP(credit, gain); }
    }
    return changed;
  }

  function addXP(t, a){
    if (G.over) return;
    t.xp += a; t.xpTotal += a;
    while (t.level < 30 && t.xp >= xpNeed(t.level)){
      t.xp -= xpNeed(t.level); t.level++; t.points++;
      if (t.human) onEvent({k:'lvl', id:t.id, lv:t.level});
      if (t.level === 15 && t.cls === 'splat'){
        if (t.human){ t.classPending = true; t.protect = Math.max(t.protect, 5); onEvent({k:'cls', id:t.id}); }
        else setClass(t, CLASS_KEYS[Math.floor(Math.random()*4)]);
      }
    }
    if (t.level >= 30) t.xp = Math.min(t.xp, xpNeed(30));
    t.xpn = xpNeed(t.level);
  }
  function setClass(t, k){ t.cls = k; t.r = CLASSES[k].r; t.classPending = false; t.specialCd = 2; }
  function upgrade(t, i){ if (t.points > 0 && t.stats[i] < 8){ t.stats[i]++; t.points--; if (i===4) t.hp += 12; if (i===0) t.ink += 12; refresh(t); } }

  function damage(t, amt, src){
    if (t.dead || t.protect > 0 || amt <= 0) return;
    t.hp -= amt; t.lastHit = G.clock; t.flash = 0.06;
    if (src && src !== t) t.damagers[src.id] = G.clock;
    if (t.human) onEvent({k:'shake', id:t.id, s:0.12});
    if (t.hp <= 0) kill(t, src);
  }
  function kill(t, src){
    t.dead = true; t.respawnT = 3; t.deaths++; t.hp = 0;
    const killer = src && src !== t ? src : null;
    const po = killer ? paintOwner(killer) : paintOwner(t);
    stamp(t.x, t.y, 140, po, killer);
    onEvent({k:'ring', x:t.x, y:t.y, r:150, o:po});
    if (killer){
      killer.splats++; addXP(killer, 60 + 10*t.level);
      for (const id in t.damagers){ const e = getTank(+id); if (e && e !== killer && G.clock - t.damagers[id] < 4) addXP(e, 20); }
      t.killedBy = killer.name;
    } else t.killedBy = '';
    onEvent({k:'kill', a: killer ? killer.id : 0, b:t.id, an: killer ? killer.name : '', bn:t.name});
    if (t.human) onEvent({k:'shake', id:t.id, s:0.25});
    t.xp = Math.floor(t.xp*0.8); t.damagers = {};
  }

  function fire(t){
    const C = CLASSES[t.cls];
    if (t.ink < C.ink) return;
    t.ink -= C.ink;
    t.reload = 1/C.rate*(1 - 0.06*t.stats[2]);
    const dm = 1 + 0.08*t.stats[1], rm = 1 + 0.08*t.stats[3];
    const ca = Math.cos(t.aim), sa = Math.sin(t.aim);
    if (C.bomb){
      const d = clamp(t.aimDist, 120, C.range*rm);
      G.bombs.push({id:nextB++, x0:t.x + ca*t.r, y0:t.y + sa*t.r, x1:clamp(t.x + ca*d, 30, WW-30), y1:clamp(t.y + sa*d, 30, WH-30), t:0, T:0.6, R:110, dmg:C.dmg*dm, cluster:t.cluster, owner:t, po:paintOwner(t)});
      t.cluster = false;
      const J = 0.35*900*0.15/C.mass; t.vx -= ca*J; t.vy -= sa*J;
      return;
    }
    if (C.spread){ for (let k=0;k<C.spread;k++) spawnBullet(t, t.aim + (k - (C.spread-1)/2)*0.18, C, dm, rm); const J = 6/C.mass; t.vx -= ca*J; t.vy -= sa*J; return; }
    spawnBullet(t, t.aim, C, dm, rm);
    const J = C.dmg/100*C.speed*0.15/C.mass; t.vx -= ca*J; t.vy -= sa*J;
  }
  function spawnBullet(t, a, C, dm, rm){
    const ca = Math.cos(a), sa = Math.sin(a), m = t.r*1.4;
    const x = t.x + ca*m, y = t.y + sa*m;
    G.bullets.push({id:nextB++, x, y, px:x, py:y, vx:ca*C.speed + t.vx*0.3, vy:sa*C.speed + t.vy*0.3, r:C.br, dmg:C.dmg*dm, hp:C.dmg*dm,
      owner:t, po:paintOwner(t), dist:0, range:C.range*rm, splat:C.splat, line:!!C.line, drop:0, dead:false});
  }
  function special(t){
    if (t.cls === 'splat' || t.specialCd > 0) return;
    t.specialCd = 8;
    if (t.cls === 'roller') t.specialT = 1.5;
    else if (t.cls === 'bomber') t.cluster = true;
    else if (t.cls === 'sprayer'){ t.specialT = 3; t.spinA = t.aim; t.spinReload = 0; }
    else if (t.cls === 'liner') t.specialT = 4;
  }

  function botThink(t, dt){
    const ai = t.ai, C = CLASSES[t.cls], po = paintOwner(t);
    const rng = C.range*(1 + 0.08*t.stats[3]);
    ai.think -= dt; ai.wpT -= dt; ai.strafeT -= dt;
    if (ai.strafeT <= 0){ ai.strafe = -ai.strafe; ai.strafeT = rand(1.5,4); }
    if (ai.think <= 0){
      ai.think = rand(0.12,0.28);
      let best = null, bd = 720;
      for (const e of G.tanks){ if (e.dead || !isEnemy(t,e) || e.protect > 0) continue; const d = Math.hypot(e.x-t.x, e.y-t.y); if (d < bd){ bd = d; best = e; } }
      ai.target = best; ai.obj = null;
      if (!best){ let od = 480; for (const o of G.objects){ const d = Math.hypot(o.x-t.x, o.y-t.y); if (d < od){ od = d; ai.obj = o; } } }
      if (!ai.wp || ai.wpT <= 0 || Math.hypot(ai.wp[0]-t.x, ai.wp[1]-t.y) < 90){
        let bp = null, bs = -1;
        for (let k=0;k<8;k++){
          const px = clamp(t.x + rand(-900,900), 120, WW-120), py = clamp(t.y + rand(-700,700), 120, WH-120);
          if (inObstacle(px,py,50)) continue;
          const sc = (gridAt(px,py) !== po ? 2 : 0) + Math.random();
          if (sc > bs){ bs = sc; bp = [px,py]; }
        }
        ai.wp = bp || [WW/2, WH/2]; ai.wpT = rand(3,5);
      }
      ai.err = (Math.random()-0.5)*0.22;
      while (t.points > 0){ const w = [2,3,3,2,3,2]; let tot = 0; for (let i=0;i<6;i++) if (t.stats[i]<8) tot += w[i]; if (!tot) break; let r = Math.random()*tot; for (let i=0;i<6;i++){ if (t.stats[i]>=8) continue; r -= w[i]; if (r <= 0){ upgrade(t,i); break; } } }
    }
    let mx = 0, my = 0, fireOn = false, spec = false, aim = t.aim;
    const e = ai.target && !ai.target.dead ? ai.target : null;
    if (e){
      const dx = e.x - t.x, dy = e.y - t.y, d = Math.hypot(dx,dy) || 1;
      const lead = d/(C.speed || 900)*0.7;
      aim = Math.atan2(e.y + e.vy*lead - t.y, e.x + e.vx*lead - t.x) + ai.err;
      t.aimDist = d;
      const pref = Math.min(rng*0.7, 520);
      const radial = d > pref + 80 ? 1 : d < pref - 80 ? -0.7 : 0;
      mx = dx/d*radial + (-dy/d)*ai.strafe*0.85; my = dy/d*radial + (dx/d)*ai.strafe*0.85;
      if (t.cls === 'roller'){ mx = dx/d; my = dy/d; if (d < 320) spec = true; }
      if (t.hp < t.mhp*0.3 && t.cls !== 'roller'){ mx = -dx/d + (-dy/d)*ai.strafe*0.5; my = -dy/d + (dx/d)*ai.strafe*0.5; }
      fireOn = d < rng*1.05 && t.ink > C.ink + 4;
      if ((t.cls === 'bomber' || (t.cls === 'sprayer' && d < 360)) && Math.random() < 0.02) spec = true;
    } else if (ai.obj && !ai.obj.dead){
      const o = ai.obj, dx = o.x - t.x, dy = o.y - t.y, d = Math.hypot(dx,dy) || 1;
      aim = Math.atan2(dy,dx) + ai.err*0.5; t.aimDist = d;
      const radial = d > 260 ? 1 : d < 160 ? -0.6 : 0;
      mx = dx/d*radial; my = dy/d*radial;
      fireOn = d < rng && t.ink > C.ink + 10;
    } else {
      const dx = ai.wp[0] - t.x, dy = ai.wp[1] - t.y, d = Math.hypot(dx,dy) || 1;
      mx = dx/d; my = dy/d;
      aim = Math.atan2(dy,dx) + Math.sin(G.clock*2 + t.id)*0.6; t.aimDist = rng*0.8;
      fireOn = t.ink > t.icap*0.45;
    }
    const lx = t.x + mx*(t.r + 70), ly = t.y + my*(t.r + 70);
    if (inObstacle(lx, ly, 10) || lx < 40 || ly < 40 || lx > WW-40 || ly > WH-40){ const nx = -my*ai.strafe, ny = mx*ai.strafe; mx = nx; my = ny; }
    let da = aim - t.aim; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    t.aim += clamp(da, -9*dt, 9*dt);
    t.input.mx = mx; t.input.my = my; t.input.fire = fireOn; t.input.special = spec;
  }

  function updateTank(t, dt){
    const C = CLASSES[t.cls], po = paintOwner(t);
    let own = 0, en = 0, neu = 0;
    const sp0 = Math.hypot(t.vx, t.vy), fa = sp0 > 20 ? Math.atan2(t.vy, t.vx) : t.aim, o6 = t.r*0.6;
    const cf = Math.cos(fa)*o6, sf = Math.sin(fa)*o6;
    const pts = [[0,0],[cf,sf],[-cf,-sf],[-sf,cf],[sf,-cf]];
    for (const p of pts){ const v = gridAt(t.x+p[0], t.y+p[1]); if (v === po) own++; else if (v === 0 || v === 255) neu++; else en++; }
    t.surface = own > en && own > neu ? 1 : en > own && en > neu ? -1 : 0;
    const ts = t.surface === 1 ? 1.4 : t.surface === -1 ? 0.6 : 1, ta = t.surface === 1 ? 1.3 : t.surface === -1 ? 0.7 : 1;
    const ease = Math.min(1, dt/0.15); t.sm += (ts - t.sm)*ease; t.am += (ta - t.am)*ease;
    let mx = t.input.mx, my = t.input.my; const ml = Math.hypot(mx,my); if (ml > 1){ mx /= ml; my /= ml; }
    const charge = t.cls === 'roller' && t.specialT > 0;
    const acc = 1400*t.am*(charge ? 1.6 : 1);
    t.vx += mx*acc*dt; t.vy += my*acc*dt;
    const drag = Math.exp(-4*dt); t.vx *= drag; t.vy *= drag;
    const maxS = 260/Math.sqrt(C.mass)*t.sm*(1 + 0.04*t.stats[5])*(charge ? 1.6 : 1);
    let sp = Math.hypot(t.vx, t.vy); if (sp > maxS){ t.vx *= maxS/sp; t.vy *= maxS/sp; sp = maxS; }
    t.moving = sp > 30;
    t.x += t.vx*dt; t.y += t.vy*dt;
    t.reload -= dt; t.specialCd -= dt; t.specialT -= dt; t.protect -= dt; t.flash -= dt;
    const cap = t.icap, moving = sp > 30, since = G.clock - t.lastHit;
    if (t.surface === 1) t.ink += cap*(moving ? 0.30 : 0.45)*dt; else if (t.surface === 0) t.ink += cap*0.06*dt;
    if (t.ink > cap) t.ink = cap;
    if (t.surface === 1 && since > 2) t.hp += 6*dt; else if (t.surface === 0 && since > 4) t.hp += 1*dt;
    if (t.surface === -1 && t.protect <= 0) t.hp = Math.max(Math.min(t.hp,1), t.hp - 3*dt);
    if (t.hp > t.mhp) t.hp = t.mhp;
    if (t.input.fire && t.reload <= 0) fire(t);
    if (t.input.special){ special(t); if (t.human) t.input.special = false; }
    if (t.cls === 'sprayer' && t.specialT > 0){
      t.spinA += dt*6; t.spinReload -= dt;
      if (t.spinReload <= 0 && t.ink >= 3){ t.spinReload = 1/6; t.ink -= 3; for (let k=0;k<6;k++) spawnBullet(t, t.spinA + k*Math.PI/3, C, 1 + 0.08*t.stats[1], 1 + 0.08*t.stats[3]); }
    }
    if (t.cls === 'roller' && moving && t.ink > 0){
      t.trailAcc += sp*dt;
      while (t.trailAcc >= 12){ t.trailAcc -= 12; t.ink -= 0.6; stamp(t.x - t.vx/sp*t.r*0.3, t.y - t.vy/sp*t.r*0.3, 35, po, t); }
    }
    refresh(t);
  }

  function segDist2(ax, ay, bx, by, px, py){
    const dx = bx-ax, dy = by-ay, l = dx*dx + dy*dy;
    let u = l ? ((px-ax)*dx + (py-ay)*dy)/l : 0; u = u < 0 ? 0 : u > 1 ? 1 : u;
    const x = ax + u*dx - px, y = ay + u*dy - py; return x*x + y*y;
  }
  function damageObj(o, amt, src, dx, dy){
    if (o.dead) return;
    o.hp -= amt; o.flash = 0.06;
    if (dx !== undefined){ o.vx += dx*60/o.mass; o.vy += dy*60/o.mass; }
    if (o.hp <= 0) destroyObj(o, src);
  }
  function destroyObj(o, src){
    o.dead = true;
    const d = OBJ[o.type];
    const owner = src ? paintOwner(src) : 0;
    if (src){ addXP(src, d.xp); stamp(o.x, o.y, d.splat, owner, src); }
    onEvent({k:'ring', x:o.x, y:o.y, r:d.splat, o:owner});
    if (o.type === 'barrel'){
      for (const t of G.tanks){ if (t.dead) continue; const dd = Math.hypot(t.x-o.x, t.y-o.y); if (dd < 100 + t.r){ const k = Math.max(0, 1 - dd/(100+t.r)); damage(t, 15, t === src ? null : src); const nx = (t.x-o.x)/(dd||1), ny = (t.y-o.y)/(dd||1); t.vx += nx*300*k/CLASSES[t.cls].mass; t.vy += ny*300*k/CLASSES[t.cls].mass; } }
    }
    if (o.type === 'gold' && src){ src.ink = src.icap; if (src.human) onEvent({k:'toast', id:src.id, text:'Gold bucket: ink full'}); }
  }

  function updateBullets(dt){
    const B = G.bullets;
    for (const b of B){
      if (b.dead) continue;
      b.px = b.x; b.py = b.y; b.x += b.vx*dt; b.y += b.vy*dt;
      const step = Math.hypot(b.vx, b.vy)*dt; b.dist += step; b.drop += step;
      if (b.line){ while (b.drop >= 10){ b.drop -= 10; const f = 1 - b.drop/step; stamp(b.px + (b.x-b.px)*f, b.py + (b.y-b.py)*f, 11, b.po, b.owner); } }
      else if (b.drop >= 130){ b.drop -= 130; stamp(b.x, b.y, 7, b.po, b.owner); }
      if (b.x < 0 || b.y < 0 || b.x > WW || b.y > WH){ b.dead = true; stamp(clamp(b.x,14,WW-14), clamp(b.y,14,WH-14), 26, b.po, b.owner); continue; }
      if (inObstacle(b.x, b.y, 0)){ b.dead = true; const a = Math.atan2(b.vy,b.vx); stamp(b.px - Math.cos(a)*8, b.py - Math.sin(a)*8, 26, b.po, b.owner); continue; }
      for (const t of G.tanks){
        if (t.dead || !isEnemy(b.owner, t)) continue;
        const rr = t.r + b.r;
        if (segDist2(b.px, b.py, b.x, b.y, t.x, t.y) < rr*rr){
          b.dead = true;
          const sp = Math.hypot(b.vx,b.vy) || 1, m = CLASSES[t.cls].mass;
          if (t.protect <= 0){ t.vx += b.vx/sp*40/m; t.vy += b.vy/sp*40/m; }
          stamp(t.x, t.y, 18, b.po, b.owner);
          if (t.protect <= 0){ addXP(b.owner, 2); if (b.owner.human) onEvent({k:'hit', by:b.owner.id, x:b.x, y:b.y}); }
          damage(t, b.dmg, b.owner);
          break;
        }
      }
      if (b.dead) continue;
      for (const o of G.objects){
        if (o.dead) continue;
        const rr = o.r + b.r;
        if (segDist2(b.px, b.py, b.x, b.y, o.x, o.y) < rr*rr){ b.dead = true; const sp = Math.hypot(b.vx,b.vy) || 1; damageObj(o, b.dmg, b.owner, b.vx/sp, b.vy/sp); break; }
      }
      if (b.dead) continue;
      if (b.dist >= b.range){ b.dead = true; stamp(b.x, b.y, b.splat, b.po, b.owner); }
    }
    for (let i=0;i<B.length;i++){
      const a = B[i]; if (a.dead) continue;
      for (let j=i+1;j<B.length;j++){
        const c = B[j]; if (c.dead || !isEnemy(a.owner, c.owner)) continue;
        const dx = a.x-c.x, dy = a.y-c.y, rr = a.r + c.r;
        if (dx*dx + dy*dy < rr*rr){ const ad = a.dmg, cd = c.dmg; a.hp -= cd; c.hp -= ad; if (a.hp <= 0) a.dead = true; if (c.hp <= 0) c.dead = true; if (a.dead) break; }
      }
    }
    G.bullets = B.filter(b => !b.dead);
  }

  function updateBombs(dt){
    for (const b of G.bombs){
      b.t += dt;
      if (b.t < b.T) continue;
      b.done = true;
      const x = b.x1, y = b.y1;
      for (const t of G.tanks){
        if (t.dead || !isEnemy(b.owner, t)) continue;
        const d = Math.hypot(t.x-x, t.y-y);
        if (d < b.R + t.r*0.5){ const k = Math.max(0, 1 - d/b.R); damage(t, b.dmg*Math.max(k,0.15), b.owner); if (t.protect <= 0){ const m = CLASSES[t.cls].mass; t.vx += (t.x-x)/(d||1)*450*k/m; t.vy += (t.y-y)/(d||1)*450*k/m; } }
      }
      for (const o of G.objects){ if (o.dead) continue; const d = Math.hypot(o.x-x, o.y-y); if (d < b.R + o.r*0.5){ const k = Math.max(0.15, 1 - d/b.R); damageObj(o, b.dmg*k, b.owner, (o.x-x)/(d||1)*3, (o.y-y)/(d||1)*3); } }
      stamp(x, y, b.R, b.po, b.owner);
      onEvent({k:'ring', x, y, r:b.R, o:b.po});
      for (const t of G.tanks) if (t.human && !t.dead && Math.hypot(t.x-x, t.y-y) < 200) onEvent({k:'shake', id:t.id, s:0.12});
      if (b.cluster){ for (let k=0;k<4;k++){ const a = k*Math.PI/2 + Math.PI/4; G.bombs.push({id:nextB++, x0:x, y0:y, x1:clamp(x + Math.cos(a)*140, 30, WW-30), y1:clamp(y + Math.sin(a)*140, 30, WH-30), t:0, T:0.4, R:70, dmg:20, cluster:false, owner:b.owner, po:b.po}); } }
    }
    G.bombs = G.bombs.filter(b => !b.done);
  }

  function updateObjects(dt){
    for (const o of G.objects){
      if (o.dead) continue;
      o.dir += rand(-0.3,0.3)*dt;
      const tx = Math.cos(o.dir)*15, ty = Math.sin(o.dir)*15;
      const k = Math.min(1, 0.5*dt); o.vx += (tx - o.vx)*k; o.vy += (ty - o.vy)*k;
      o.x += o.vx*dt; o.y += o.vy*dt; o.rot += o.vr*dt; o.flash -= dt;
    }
  }

  function resolveCircleRect(e, r, rest){
    for (const o of G.obstacles){
      const cx = clamp(e.x, o.x, o.x+o.w), cy = clamp(e.y, o.y, o.y+o.h);
      const dx = e.x - cx, dy = e.y - cy, d2 = dx*dx + dy*dy;
      if (d2 >= r*r) continue;
      let nx, ny;
      if (d2 === 0){
        const l = e.x - o.x, rr = o.x + o.w - e.x, tp = e.y - o.y, bt = o.y + o.h - e.y, m = Math.min(l, rr, tp, bt);
        if (m === l){ nx = -1; ny = 0; e.x = o.x - r; } else if (m === rr){ nx = 1; ny = 0; e.x = o.x + o.w + r; } else if (m === tp){ nx = 0; ny = -1; e.y = o.y - r; } else { nx = 0; ny = 1; e.y = o.y + o.h + r; }
      } else { const d = Math.sqrt(d2); nx = dx/d; ny = dy/d; e.x = cx + nx*r; e.y = cy + ny*r; }
      const vn = e.vx*nx + e.vy*ny;
      if (vn < 0){ e.vx -= (1 + rest)*vn*nx; e.vy -= (1 + rest)*vn*ny; e.vx *= 0.97; e.vy *= 0.97; }
    }
    if (e.x < r){ e.x = r; if (e.vx < 0) e.vx = -e.vx*rest; }
    if (e.y < r){ e.y = r; if (e.vy < 0) e.vy = -e.vy*rest; }
    if (e.x > WW - r){ e.x = WW - r; if (e.vx > 0) e.vx = -e.vx*rest; }
    if (e.y > WH - r){ e.y = WH - r; if (e.vy > 0) e.vy = -e.vy*rest; }
  }

  function collide(){
    const T = G.tanks.filter(t => !t.dead);
    for (let i=0;i<T.length;i++) for (let j=i+1;j<T.length;j++){
      const a = T[i], b = T[j];
      const dx = b.x - a.x, dy = b.y - a.y, rs = a.r + b.r, d2 = dx*dx + dy*dy;
      if (d2 >= rs*rs || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx/d, ny = dy/d, ov = rs - d;
      const ma = CLASSES[a.cls].mass, mb = CLASSES[b.cls].mass, ia = 1/ma, ib = 1/mb;
      if (!isEnemy(a,b)){ a.x -= nx*ov*0.25; a.y -= ny*ov*0.25; b.x += nx*ov*0.25; b.y += ny*ov*0.25; continue; }
      a.x -= nx*ov*ia/(ia+ib); a.y -= ny*ov*ia/(ia+ib); b.x += nx*ov*ib/(ia+ib); b.y += ny*ov*ib/(ia+ib);
      const vn = (b.vx - a.vx)*nx + (b.vy - a.vy)*ny;
      if (vn < 0){
        const close = -vn, J = -(1 + 0.4)*vn/(ia + ib);
        a.vx -= J*ia*nx; a.vy -= J*ia*ny; b.vx += J*ib*nx; b.vy += J*ib*ny;
        if (close > 150){
          const ca = a.cls === 'roller' && a.specialT > 0 ? 2 : 1, cb = b.cls === 'roller' && b.specialT > 0 ? 2 : 1;
          damage(a, 0.08*close*mb*cb, b); damage(b, 0.08*close*ma*ca, a);
        }
      }
    }
    const O = G.objects.filter(o => !o.dead);
    for (const t of T){
      if (t.dead) continue;
      const mt = CLASSES[t.cls].mass;
      for (const o of O){
        if (o.dead) continue;
        const dx = o.x - t.x, dy = o.y - t.y, rs = t.r + o.r, d2 = dx*dx + dy*dy;
        if (d2 >= rs*rs || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx/d, ny = dy/d, ov = rs - d, it = 1/mt, io = 1/o.mass;
        t.x -= nx*ov*it/(it+io); t.y -= ny*ov*it/(it+io); o.x += nx*ov*io/(it+io); o.y += ny*ov*io/(it+io);
        const vn = (o.vx - t.vx)*nx + (o.vy - t.vy)*ny;
        if (vn < 0){ const J = -1.5*vn/(it+io); t.vx -= J*it*nx; t.vy -= J*it*ny; o.vx += J*io*nx; o.vy += J*io*ny; }
        damageObj(o, 0.5, t);
      }
    }
    for (let i=0;i<O.length;i++) for (let j=i+1;j<O.length;j++){
      const a = O[i], b = O[j]; if (a.dead || b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y, rs = a.r + b.r, d2 = dx*dx + dy*dy;
      if (d2 >= rs*rs || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx/d, ny = dy/d, ov = rs - d, ia = 1/a.mass, ib = 1/b.mass;
      a.x -= nx*ov*ia/(ia+ib); a.y -= ny*ov*ia/(ia+ib); b.x += nx*ov*ib/(ia+ib); b.y += ny*ov*ib/(ia+ib);
      const vn = (b.vx - a.vx)*nx + (b.vy - a.vy)*ny;
      if (vn < 0){ const J = -1.6*vn/(ia+ib); a.vx -= J*ia*nx; a.vy -= J*ia*ny; b.vx += J*ib*nx; b.vy += J*ib*ny; }
    }
    for (const t of T) if (!t.dead) resolveCircleRect(t, t.r, 0.2);
    for (const o of O) if (!o.dead) resolveCircleRect(o, o.r, 0.6);
  }

  function step(dt, untimed){
    if (G.over) return;
    G.clock += dt;
    if (!untimed){ G.time -= dt; if (G.time <= 0){ G.time = 0; G.over = true; onEvent({k:'end'}); return; } }
    for (const t of G.tanks){
      if (t.dead){ t.respawnT -= dt; if (t.respawnT <= 0) spawnTank(t); continue; }
      if (!t.human) botThink(t, dt);
      updateTank(t, dt);
    }
    updateBullets(dt);
    updateBombs(dt);
    updateObjects(dt);
    collide();
    G.objects = G.objects.filter(o => !o.dead);
    if (G.objects.filter(o => o.type !== 'gold').length < 40) spawnObject(Math.random() < 0.75 ? 'can' : 'barrel');
    G.goldT -= dt;
    if (G.goldT <= 0){ G.goldT = 60; if (!G.objects.some(o => o.type === 'gold')){ spawnObject('gold', true); onEvent({k:'gold'}); } }
  }

  resetMatch();
  return {G, step, resetMatch, addHuman, removeHuman, setInput, upgrade:upgradeId, pickClass, getTank, paintOwner, isEnemy};
}
