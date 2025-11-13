
// Simple lane-battle engine with: 3 lanes, center-lane buff (+10% speed, +15% dmg taken),
// ally collision (no overtaking; following units match leader speed), basic AI, portrait-first UI.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const manaBar = document.getElementById('manaBar');
const gameArea = document.getElementById('gameArea');

const W = canvas.width;
const H = canvas.height;

// Lanes y positions (3 lanes)
const lanes = [
  { y: H*0.25, name: 'top' },
  { y: H*0.50, name: 'mid', mid:true },
  { y: H*0.75, name: 'bot' },
];

// Field
const riverY = H*0.5;
const bridgeW = 64, bridgeH = 12;

// Images
const IMAGES = {};
const loadImg = (key, src) => new Promise(r=>{
  const i = new Image(); i.onload=()=>{ IMAGES[key]=i; r(); }; i.src=src;
});

let mana = 5, manaMax = 10;
let selectedLane = 1; // default mid
let selectedUnit = null;
let time = 0;

const you = [];
const enemy = [];

const UNIT_TYPES = {
  scout: { hp: 40, speed: 68, range: 18, dmg: 8, rate: 0.7, cost:3, sprite:'scout', minGap: 20 },
  spark: { hp: 32, speed: 55, range: 120, dmg: 6, rate: 0.5, cost:2, sprite:'spark', projectile:true, minGap: 18 },
  tank:  { hp:120, speed: 32, range: 22, dmg:10, rate: 0.9, cost:4, sprite:'tank', blocking:true, minGap: 28 },
  healer:{ hp: 36, speed: 50, range: 75, heal:5, rate: 1.0, cost:3, sprite:'healer', support:true, minGap: 18 },
};

function laneModifiers(lane){
  if(lane.mid) return {speed:1.10, dmgTaken:1.15};
  return {speed:1.0, dmgTaken:1.0};
}

class Unit{
  constructor(type, laneIndex, x, dir){
    Object.assign(this, JSON.parse(JSON.stringify(UNIT_TYPES[type]))); // clone base stats
    this.type = type;
    this.laneIndex = laneIndex;
    this.y = lanes[laneIndex].y;
    this.x = x;
    this.dir = dir; // 1 to right, -1 to left
    this.hpMax = this.hp;
    this.cool = 0;
    this.dead = false;
  }
  get speedActual(){
    const mod = laneModifiers(lanes[this.laneIndex]).speed;
    return this.speed * mod;
  }
  get dmgTaken(){
    return laneModifiers(lanes[this.laneIndex]).dmgTaken;
  }
  allies(list){ return list.filter(u=>u.laneIndex===this.laneIndex && !u.dead); }
  enemies(list){ return list.filter(u=>u.laneIndex===this.laneIndex && !u.dead); }
}

function spawn(side, type, laneIndex){
  const dir = side==='you' ? 1 : -1;
  const x = side==='you' ? 16 : W-16;
  const u = new Unit(type, laneIndex, x, dir);
  (side==='you'?you:enemy).push(u);
}

// UI lane selection (tap field)
gameArea.addEventListener('click', (e)=>{
  const rect = canvas.getBoundingClientRect();
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  // find closest lane
  let best = 0, dist=1e9;
  lanes.forEach((l,i)=>{
    const d = Math.abs(l.y - y);
    if(d<dist){ dist=d; best=i; }
  });
  selectedLane = best;
  statusEl.textContent = `Corsia: ${ lanes[best].name.toUpperCase() } • Ora scegli una carta`;
  if(selectedUnit){
    tryDeploy(selectedUnit);
  }
});

// Cards
document.querySelectorAll('.card').forEach(card=>{
  const unit = card.dataset.unit;
  if(!unit){
    card.addEventListener('click', ()=>{ restart(); });
    return;
  }
  card.addEventListener('click', ()=>{
    selectedUnit = unit;
    tryDeploy(unit);
  });
});

function tryDeploy(unitKey){
  const cost = UNIT_TYPES[unitKey].cost;
  if(mana >= cost){
    spawn('you', unitKey, selectedLane);
    mana -= cost;
    selectedUnit = null;
  }
}

function restart(){
  you.length = 0; enemy.length=0; mana=5; time=0;
  statusEl.textContent = 'Tocca una corsia, poi una carta';
}

function step(dt){
  time += dt;
  // mana regen
  mana = Math.min(manaMax, mana + dt*1.5);
  manaBar.style.width = `${(mana/manaMax)*100}%`;

  // Enemy AI: spawn every few seconds
  if(time>2){
    if(Math.random()<0.015){
      const laneIndex = Math.floor(Math.random()*lanes.length);
      const types = ['scout','spark','tank','healer'];
      const t = types[Math.floor(Math.random()*types.length)];
      spawn('enemy', t, laneIndex);
    }
  }

  // Update units (both sides)
  updateSide(you, enemy, dt);
  updateSide(enemy, you, dt);
}

function updateSide(allies, foes, dt){
  // sort by x for following logic depending on direction
  allies.sort((a,b)=> a.dir>0 ? a.x-b.x : b.x-a.x);
  for(let i=0;i<allies.length;i++){
    const u = allies[i];
    if(u.dead) continue;

    // target in range?
    // find closest foe in same lane
    const enemies = foes.filter(f=>f.laneIndex===u.laneIndex && !f.dead);
    let target = null, bestDist = 9999;
    enemies.forEach(f=>{
      const d = Math.abs(f.x - u.x);
      if(d<bestDist){ bestDist=d; target=f; }
    });

    // healer support
    if(u.support){
      // heal nearest ally in small radius
      const mates = allies.filter(m=>m.laneIndex===u.laneIndex && !m.dead && m!==u);
      let ally = null, bd=9999;
      mates.forEach(m=>{
        const d = Math.abs(m.x - u.x);
        if(d<bd && d<=u.range){ bd=d; ally=m; }
      });
      if(ally){
        u.cool -= dt;
        if(u.cool<=0){
          ally.hp = Math.min(ally.hpMax, ally.hp + u.heal);
          u.cool = u.rate;
        }
      }
    }

    // attack if target in range
    if(target && Math.abs(target.x - u.x) <= u.range){
      u.cool -= dt;
      if(u.cool<=0){
        u.cool = u.rate;
        if(u.projectile){
          // instant for simplicity; could add projectile entity
          target.hp -= u.dmg * target.dmgTaken; // dmgTaken modifier applies to target's lane
        }else{
          target.hp -= u.dmg * target.dmgTaken;
        }
      }
      // don't move while attacking
    }else{
      // movement with no-overtake: maintain minGap from leader in front
      let desiredSpeed = u.speedActual;
      // leader check: find next unit "ahead" in same lane among allies
      const ahead = allies.find(v => v!==u && v.laneIndex===u.laneIndex &&
        (u.dir>0 ? v.x>u.x : v.x<u.x));
      if(ahead){
        const gap = Math.abs(ahead.x - u.x);
        const minGap = Math.max(u.minGap, ahead.minGap);
        if(gap < minGap){
          // match leader speed or stop
          desiredSpeed = Math.min(desiredSpeed, ahead.speedActual * 0.98);
          // small push back to avoid overlapping
          if(u.dir>0 && u.x > ahead.x - minGap) u.x = ahead.x - minGap;
          if(u.dir<0 && u.x < ahead.x + minGap) u.x = ahead.x + minGap;
        }
        // if leader is blocking (tank) and too close, effectively cap speed
        if(ahead.blocking && gap < (minGap+6)){
          desiredSpeed = Math.min(desiredSpeed, ahead.speedActual);
        }
      }
      u.x += u.dir * desiredSpeed * dt * 0.6; // 0.6 to tune pacing
    }

    // bounds / win condition demo
    if(u.dir>0 && u.x>=W-8){ u.dead=true; }
    if(u.dir<0 && u.x<=8){ u.dead=true; }
    if(u.hp<=0){ u.dead=true; }
  }
  // prune
  for(let i=allies.length-1;i>=0;i--){ if(allies[i].dead) allies.splice(i,1); }
}

function draw(){
  // background field grid
  ctx.clearRect(0,0,W,H);
  // tiles
  const tileH = H/6;
  for(let r=0;r<6;r++){
    ctx.fillStyle = r%2? '#88b688' : '#79ab79';
    ctx.fillRect(0, r*tileH, W, tileH);
  }
  // river
  ctx.fillStyle = '#6bb3d6';
  ctx.fillRect(0, H*0.5-10, W, 20);
  // bridges
  ctx.fillStyle = '#805a3a';
  ctx.fillRect(W*0.25-bridgeW/2, H*0.5-bridgeH/2, bridgeW, bridgeH);
  ctx.fillRect(W*0.75-bridgeW/2, H*0.5-bridgeH/2, bridgeW, bridgeH);

  // lane lines
  ctx.strokeStyle = 'rgba(0,0,0,.2)';
  ctx.lineWidth = 1;
  lanes.forEach(l=>{
    ctx.beginPath();
    ctx.moveTo(0, l.y);
    ctx.lineTo(W, l.y);
    ctx.stroke();
  });

  // draw units
  function drawList(list, flip=false){
    list.forEach(u=>{
      const img = IMAGES[u.sprite];
      if(!img) return;
      const scale = 0.6;
      const w = img.width*scale, h = img.height*scale;
      ctx.save();
      ctx.translate(u.x, u.y);
      if(flip) ctx.scale(-1,1);
      ctx.translate(-w/2, -h/2);
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();

      // hp bar
      const barW = 40, barH=5;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(u.x-barW/2, u.y-28, barW, barH);
      const ratio = Math.max(0, u.hp / u.hpMax);
      ctx.fillStyle = ratio>0.5 ? '#7ee787' : (ratio>0.25 ? '#e3b341' : '#ff6b6b');
      ctx.fillRect(u.x-barW/2, u.y-28, barW*ratio, barH);
    });
  }
  drawList(you,false);
  drawList(enemy,true);

  // selected lane highlight
  const l = lanes[selectedLane];
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.fillRect(0, l.y - H/6, W, H/3);
}

// Main loop
let last = performance.now();
function loop(now){
  const dt = Math.min(0.033, (now-last)/1000); // cap delta
  last = now;
  step(dt);
  draw();
  requestAnimationFrame(loop);
}

// Load images then start
Promise.all([
  loadImg('tank','assets/sprites/tank.png'),
  loadImg('scout','assets/sprites/scout.png'),
  loadImg('healer','assets/sprites/healer.png'),
  loadImg('spark','assets/sprites/spark.png')
]).then(()=>{
  requestAnimationFrame(loop);
});
