/* =================== CONFIGURAZIONE CANVAS & COORDINATE =================== */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

const LOGICAL_W = 720;
const LOGICAL_H = 1280;
const UI_H = 220;
const FIELD_H = LOGICAL_H - UI_H;

let scale = 1;
let offX = 0;
let offY = 0;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));

  scale = Math.min(canvas.width / LOGICAL_W, canvas.height / LOGICAL_H);
  offX = Math.floor((canvas.width - LOGICAL_W * scale) / 2);
  offY = Math.floor((canvas.height - LOGICAL_H * scale) / 2);
}

function toLogical(ev) {
  const rect = canvas.getBoundingClientRect();
  const px = (ev.clientX - rect.left) * (canvas.width / rect.width);
  const py = (ev.clientY - rect.top) * (canvas.height / rect.height);
  return {
    x: (px - offX) / scale,
    y: (py - offY) / scale
  };
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);
resizeCanvas();

/* ============================ COSTANTI & DATI ============================= */

const LANES = 3;
const COL_X = [LOGICAL_W * 0.18, LOGICAL_W * 0.5, LOGICAL_W * 0.82];
const RIVER_Y = FIELD_H * 0.5;

// "cristallo centrale" nella corsia centrale
const crystal = {
  lane: 1,
  x: COL_X[1],
  y: RIVER_Y,
  hp: 150,
  max: 150,
  pulse: 0,
  lastHitBy: null, // 'P' o 'E'
};

let selectedLane = 1;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* ===================== GRAFICA DI BASE (PATTERN, OMBRE) =================== */

const tex = { grass: null, dirt: null };

function makePattern(fillFn, w = 128, h = 128) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  fillFn(g, w, h);
  return g.createPattern(c, 'repeat');
}

function buildTextures() {
  tex.grass = makePattern((g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#e9f5d0');
    grd.addColorStop(1, '#c5dd98');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(70,110,40,${0.05 + Math.random() * 0.05})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
  });

  tex.dirt = makePattern((g, w, h) => {
    g.fillStyle = '#c89a67';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = `rgba(90,50,30,${0.05 + Math.random() * 0.07})`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, Math.random() * 1.5, 0, Math.PI * 2);
      g.fill();
    }
  });
}
buildTextures();

function softShadow(x, y, rx, ry, alpha = 0.22) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* =============================== STATO GIOCO ============================== */

const state = {
  time: 0,
  playing: true,
  manaP: 5,
  manaE: 5,
  manaMax: 10,
  manaRegen: 0.018, // circa 1.08 al secondo
  floats: [],
  particles: [],
  units: [],
  towers: [],
  aiTimer: 2.0,
  profile: {
    level: 1,
    wins: 0,
    arena: 1
  }
};

// Torri giocatore (giu) e nemico (su), solo corsie laterali
state.towers.push(
  { team: 'P', lane: 0, x: COL_X[0], y: FIELD_H - 90, hp: 120, max: 120 },
  { team: 'P', lane: 2, x: COL_X[2], y: FIELD_H - 90, hp: 120, max: 120 },
  { team: 'E', lane: 0, x: COL_X[0], y: 90, hp: 120, max: 120 },
  { team: 'E', lane: 2, x: COL_X[2], y: 90, hp: 120, max: 120 }
);

// Tipi di unità base (stile “mini manga”)
const UNIT_TYPES = {
  scout: {
    id: 'scout',
    name: 'Scout',
    hp: 24,
    dmg: 4,
    spd: 0.45, // logico al secondo
    range: 36,
    color: '#60a5fa',
    cost: 3
  },
  tank: {
    id: 'tank',
    name: 'Tank',
    hp: 80,
    dmg: 6,
    spd: 0.28,
    range: 40,
    color: '#fb7185',
    cost: 4
  },
  spark: {
    id: 'spark',
    name: 'Spark',
    hp: 18,
    dmg: 5,
    spd: 0.32,
    range: 45,
    color: '#fbbf24',
    cost: 2
  }
};

const CARD_ORDER = ['scout', 'tank', 'spark'];

function resetGame() {
  state.units = [];
  state.floats = [];
  state.particles = [];
  state.manaP = 5;
  state.manaE = 5;
  state.manaMax = 10;
  state.manaRegen = 0.018;
  state.time = 0;
  state.playing = true;
  state.aiTimer = 2.0;

  // reset torri
  state.towers.forEach(t => {
    t.hp = t.max;
  });

  // reset cristallo
  crystal.hp = crystal.max;
  crystal.lastHitBy = null;
}

/* ============================== FLOATS & FX =============================== */

function addFloat(text, x, y, color) {
  state.floats.push({
    text,
    x,
    y,
    t: 0,
    color
  });
}

function addHitFX(x, y, color) {
  for (let i = 0; i < 10; i++) {
    state.particles.push({
      x,
      y,
      vx: rand(-1.2, 1.2),
      vy: rand(-1.8, -0.4),
      life: rand(0.3, 0.6),
      t: 0,
      color
    });
  }
}

/* =========================== LOGICA UNITÀ / TORRI ========================= */

function spawnUnit(team, lane, typeId) {
  const type = UNIT_TYPES[typeId];
  if (!type) return;
  const dir = team === 'P' ? -1 : 1;
  const startY = team === 'P' ? FIELD_H - 140 : 140;
  state.units.push({
    team,
    lane,
    x: COL_X[lane],
    y: startY,
    dir,
    type,
    hp: type.hp,
    atkCD: 0
  });
}

function getTower(team, lane) {
  return state.towers.find(t => t.team === team && t.lane === lane);
}

function laneCrystalTarget(u) {
  // Il cristallo è nella corsia centrale lane=1
  if (u.lane !== crystal.lane || crystal.hp <= 0) return null;
  const dy = (crystal.y - u.y) * u.dir;
  if (dy < -80) return null; // troppo dietro
  return { type: 'crystal', obj: crystal, dist: Math.abs(dy) };
}

function updateUnits(dt) {
  const minGap = 52; // distanza minima tra alleati sulla stessa corsia
  const atkInterval = 0.55;

  for (const u of state.units) {
    u.atkCD -= dt;

    const enemyTeam = u.team === 'P' ? 'E' : 'P';
    const dir = u.dir;
    let target = null;
    let bestDist = 1e9;

    // prima: controlla unità nemiche sulla stessa corsia
    for (const o of state.units) {
      if (o.team !== enemyTeam || o.lane !== u.lane) continue;
      const dy = (o.y - u.y) * dir;
      if (dy <= 0) continue; // deve essere davanti
      if (dy < bestDist) {
        bestDist = dy;
        target = { type: 'unit', obj: o, dist: dy };
      }
    }

    // poi torre nemica in quella corsia
    const towerEnemy = getTower(enemyTeam, u.lane);
    if (towerEnemy && towerEnemy.hp > 0) {
      const dyT = (towerEnemy.y - u.y) * dir;
      if (dyT > 0 && dyT < bestDist) {
        bestDist = dyT;
        target = { type: 'tower', obj: towerEnemy, dist: dyT };
      }
    }

    // infine, cristallo centrale (solo lane 1)
    const cTarget = laneCrystalTarget(u);
    if (cTarget && cTarget.dist < bestDist && cTarget.dist < 220) {
      bestDist = cTarget.dist;
      target = cTarget;
    }

    // collisione con alleati (non si superano)
    let frontAlly = null;
    let bestAllyDist = 1e9;
    for (const o of state.units) {
      if (o === u || o.team !== u.team || o.lane !== u.lane) continue;
      const dy = (o.y - u.y) * dir;
      if (dy <= 0) continue;
      if (dy < bestAllyDist) {
        bestAllyDist = dy;
        frontAlly = o;
      }
    }
    let canMove = true;
    if (frontAlly && bestAllyDist < minGap) canMove = false;

    // Attacco
    let attacked = false;
    if (target && target.dist <= u.type.range) {
      if (u.atkCD <= 0) {
        u.atkCD = atkInterval;
        if (target.type === 'unit') {
          target.obj.hp -= u.type.dmg;
          addFloat('-' + u.type.dmg.toFixed(0), target.obj.x, target.obj.y - 24,
            u.team === 'P' ? '#ffb36a' : '#ffd4d4');
          addHitFX(target.obj.x, target.obj.y, '#ffb36a');
        } else if (target.type === 'tower') {
          target.obj.hp -= u.type.dmg;
          addFloat('-' + u.type.dmg.toFixed(0), target.obj.x, target.obj.y - 40,
            u.team === 'P' ? '#ffb36a' : '#ffd4d4');
          addHitFX(target.obj.x, target.obj.y, '#ffb36a');
        } else if (target.type === 'crystal') {
          crystal.hp -= u.type.dmg;
          crystal.hp = Math.max(0, crystal.hp);
          crystal.lastHitBy = u.team;
          crystal.pulse = 1.0;
          addFloat('+' + 2, crystal.x, crystal.y - 26,
            u.team === 'P' ? '#60f5ff' : '#ff90ff');
          addHitFX(crystal.x, crystal.y, '#fff0aa');
          // bonus mana
          if (u.team === 'P') {
            state.manaP = Math.min(state.manaMax, state.manaP + 2);
          } else {
            state.manaE = Math.min(state.manaMax, state.manaE + 2);
          }
        }
        attacked = true;
      }
    }

    // Movimento
    if (!attacked && canMove) {
      u.y += u.type.spd * dir * (60 * dt);
    }
  }

  // pulizia unità morte o fuori
  state.units = state.units.filter(u => u.hp > 0 && u.y > 40 && u.y < FIELD_H - 40);

  // pulizia cristallo (resta a 0 hp ma non sparisce, solo inerte)
}

/* =============================== IA NEMICA ================================ */

function enemyAI(dt) {
  state.aiTimer -= dt;
  if (state.aiTimer > 0 || !state.playing) return;

  state.aiTimer = rand(1.0, 2.1);

  // sceglie una carta in base al mana disponibile
  const options = [];
  for (const id of CARD_ORDER) {
    const type = UNIT_TYPES[id];
    if (state.manaE >= type.cost) options.push(type);
  }
  if (!options.length) return;

  const chosen = options[(Math.random() * options.length) | 0];
  const lane = (Math.random() * LANES) | 0;

  state.manaE = Math.max(0, state.manaE - chosen.cost);
  spawnUnit('E', lane, chosen.id);
}

/* ============================== UPDATE GLOBALE ============================ */

function update(dt) {
  state.time += dt;

  if (state.playing) {
    // mana
    state.manaP = clamp(state.manaP + state.manaRegen * 60 * dt, 0, state.manaMax);
    state.manaE = clamp(state.manaE + state.manaRegen * 60 * dt, 0, state.manaMax);

    // IA
    enemyAI(dt);

    // unità / torri / cristallo
    updateUnits(dt);

    // controllo fine partita
    const pAlive = state.towers.filter(t => t.team === 'P' && t.hp > 0).length;
    const eAlive = state.towers.filter(t => t.team === 'E' && t.hp > 0).length;

    if (pAlive === 0 || eAlive === 0) {
      state.playing = false;
      // aggiorno level/wins se player ha vinto
      if (eAlive === 0) {
        state.profile.wins++;
        if (state.profile.wins % 3 === 0) {
          state.profile.level++;
          state.profile.arena = Math.min(5, state.profile.level);
        }
      }
    }
  }

  // floats
  state.floats.forEach(f => {
    f.t += dt;
    f.y -= 30 * dt;
  });
  state.floats = state.floats.filter(f => f.t < 1.0);

  // particelle
  state.particles.forEach(p => {
    p.t += dt;
    p.x += p.vx * 60 * dt;
    p.y += p.vy * 60 * dt;
    p.vy += 0.08;
  });
  state.particles = state.particles.filter(p => p.t < p.life);

  // cristallo pulse
  if (crystal.pulse > 0) {
    crystal.pulse = Math.max(0, crystal.pulse - dt * 2.5);
  }
}

/* ================================ RENDERING =============================== */

function applyTransform() {
  ctx.setTransform(scale, 0, 0, scale, offX, offY);
}

// stile arena in base al livello (molto semplice per ora)
function currentArenaColors() {
  const a = state.profile.arena;
  if (a === 1) {
    return { tint: 'rgba(0,0,0,0.0)', sky: '#1e293b' };
  } else if (a === 2) {
    return { tint: 'rgba(255,180,90,0.08)', sky: '#331f16' };
  } else if (a === 3) {
    return { tint: 'rgba(160,210,255,0.12)', sky: '#0f172a' };
  } else if (a === 4) {
    return { tint: 'rgba(160,130,255,0.1)', sky: '#070720' };
  } else {
    return { tint: 'rgba(0,0,0,0.15)', sky: '#020617' };
  }
}

function drawBackground() {
  const { tint, sky } = currentArenaColors();

  // cielo
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, LOGICAL_W, FIELD_H);

  // prato
  ctx.fillStyle = tex.grass;
  ctx.fillRect(0, 0, LOGICAL_W, FIELD_H);

  // vignetta
  const vg = ctx.createRadialGradient(
    LOGICAL_W / 2,
    FIELD_H / 2,
    Math.min(LOGICAL_W, FIELD_H) * 0.2,
    LOGICAL_W / 2,
    FIELD_H / 2,
    Math.max(LOGICAL_W, FIELD_H) * 0.7
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.20)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, LOGICAL_W, FIELD_H);

  // corsie
  ctx.strokeStyle = '#00000015';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 40; y <= FIELD_H - 40; y += 60) {
    ctx.moveTo(0, y);
    ctx.lineTo(LOGICAL_W, y);
  }
  for (const x of COL_X) {
    ctx.moveTo(x, 40);
    ctx.lineTo(x, FIELD_H - 40);
  }
  ctx.stroke();

  // evidenzia corsia selezionata
  ctx.fillStyle = 'rgba(59,130,246,0.18)';
  ctx.fillRect(COL_X[selectedLane] - LOGICAL_W * 0.16, 0, LOGICAL_W * 0.32, FIELD_H);

  // fiume
  const h = 50;
  const riverRect = { x: 0, y: RIVER_Y - h / 2, w: LOGICAL_W, h };
  const grad = ctx.createLinearGradient(0, riverRect.y, 0, riverRect.y + riverRect.h);
  grad.addColorStop(0, '#bfe3ff');
  grad.addColorStop(0.5, '#64b5f6');
  grad.addColorStop(1, '#3b82f6');
  ctx.fillStyle = grad;
  ctx.fillRect(riverRect.x, riverRect.y, riverRect.w, riverRect.h);

  // riflessi onde
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ffffff';
  const t = state.time;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(0, RIVER_Y + Math.sin(t * 1.5 + i) * 3);
    for (let x = 0; x <= LOGICAL_W; x += 14) {
      const y = RIVER_Y + Math.sin(x * 0.02 + t * 1.5 + i) * 3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(LOGICAL_W, riverRect.y + riverRect.h);
    ctx.lineTo(0, riverRect.y + riverRect.h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // sponde
  ctx.fillStyle = tex.dirt;
  ctx.fillRect(0, riverRect.y - 14, LOGICAL_W, 8);
  ctx.fillRect(0, riverRect.y + riverRect.h + 6, LOGICAL_W, 8);

  // ponti (solo grafici)
  function bridge(cx) {
    softShadow(cx, RIVER_Y + 14, 80, 14, 0.28);
    ctx.save();
    ctx.translate(cx, RIVER_Y);
    const g = ctx.createLinearGradient(-70, -20, -70, 20);
    g.addColorStop(0, '#b0753d');
    g.addColorStop(1, '#7a4a22');
    ctx.fillStyle = g;
    ctx.fillRect(-70, -20, 140, 40);
    ctx.strokeStyle = '#5d3b1d';
    ctx.lineWidth = 3;
    ctx.strokeRect(-70, -20, 140, 40);
    ctx.strokeStyle = '#6d461f';
    for (let i = -62; i <= 62; i += 14) {
      ctx.beginPath();
      ctx.moveTo(i, -20);
      ctx.lineTo(i, 20);
      ctx.stroke();
    }
    ctx.restore();
  }
  bridge(LOGICAL_W * 0.3);
  bridge(LOGICAL_W * 0.7);

  // tinta arena
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, LOGICAL_W, FIELD_H);
}

function drawTower(t) {
  const friendly = t.team === 'P';
  softShadow(t.x, t.y + 16, 32, 12, 0.28);

  const body = ctx.createLinearGradient(t.x, t.y - 26, t.x, t.y + 26);
  body.addColorStop(0, '#e5e7eb');
  body.addColorStop(1, '#9ca3af');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(t.x, t.y, 26, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#11182788';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(t.x, t.y, 26, 26, 0, 0, Math.PI * 2);
  ctx.stroke();

  const domeColor = friendly ? '#3b82f6' : '#f97373';
  ctx.fillStyle = domeColor;
  ctx.beginPath();
  ctx.arc(t.x, t.y - 8, 18, 0, Math.PI * 2);
  ctx.fill();

  // finestrelle
  ctx.fillStyle = '#111827';
  ctx.fillRect(t.x - 5, t.y - 4, 10, 12);

  // HP bar
  const w = 80;
  const h = 8;
  const ratio = clamp(t.hp / t.max, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(t.x - w / 2, t.y - 36, w, h);
  const g = ctx.createLinearGradient(t.x - w / 2, 0, t.x + w / 2, 0);
  g.addColorStop(0, '#4ade80');
  g.addColorStop(1, '#22c55e');
  ctx.fillStyle = g;
  ctx.fillRect(t.x - w / 2, t.y - 36, w * ratio, h);
}

function drawUnit(u) {
  const bob = Math.sin(u.y * 0.08 + state.time * 4) * 3;

  softShadow(u.x, u.y + 18 + bob, 16, 6, 0.25);

  // corpo
  ctx.fillStyle = u.type.color;
  ctx.beginPath();
  ctx.roundRect(u.x - 14, u.y - 4 + bob, 28, 26, 8);
  ctx.fill();

  // testa
  ctx.fillStyle = '#fed7aa';
  ctx.beginPath();
  ctx.arc(u.x, u.y - 16 + bob, 11, 0, Math.PI * 2);
  ctx.fill();

  // occhi e bocca (stile mini manga)
  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.arc(u.x - 4, u.y - 18 + bob, 1.6, 0, Math.PI * 2);
  ctx.arc(u.x + 4, u.y - 18 + bob, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(u.x - 4, u.y - 13 + bob, 8, 1.5);

  // simbolo sul petto
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  if (u.type.id === 'tank') {
    ctx.fillRect(u.x - 6, u.y + bob + 2, 12, 8);
  } else if (u.type.id === 'spark') {
    ctx.beginPath();
    ctx.moveTo(u.x, u.y + bob - 2);
    ctx.lineTo(u.x + 6, u.y + bob + 8);
    ctx.lineTo(u.x - 6, u.y + bob + 8);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.roundRect(u.x - 6, u.y + bob, 12, 8, 3);
    ctx.fill();
  }

  // HP bar
  const ratio = clamp(u.hp / u.type.hp, 0, 1);
  const w = 30, h = 4;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(u.x - w / 2, u.y - 30 + bob, w, h);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(u.x - w / 2, u.y - 30 + bob, w * ratio, h);
}

function drawCrystal() {
  if (crystal.hp <= 0) {
    // cristallo spento
    softShadow(crystal.x, crystal.y + 12, 30, 10, 0.22);
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.roundRect(crystal.x - 24, crystal.y - 20, 48, 40, 10);
    ctx.fill();
    ctx.restore();
    return;
  }

  softShadow(crystal.x, crystal.y + 12, 30, 10, 0.25);

  const pulseScale = 1 + crystal.pulse * 0.2;
  const baseColor = crystal.lastHitBy === 'P' ? '#38bdf8' :
                    crystal.lastHitBy === 'E' ? '#fb7185' : '#a855f7';

  // nucleo
  const grd = ctx.createRadialGradient(
    crystal.x,
    crystal.y,
    0,
    crystal.x,
    crystal.y,
    26 * pulseScale
  );
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.4, baseColor);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(crystal.x, crystal.y, 26 * pulseScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // forma centrale
  ctx.save();
  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.moveTo(crystal.x, crystal.y - 20);
  ctx.lineTo(crystal.x + 14, crystal.y - 4);
  ctx.lineTo(crystal.x + 8, crystal.y + 18);
  ctx.lineTo(crystal.x - 8, crystal.y + 18);
  ctx.lineTo(crystal.x - 14, crystal.y - 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // barra HP
  const ratio = clamp(crystal.hp / crystal.max, 0, 1);
  const w = 60, h = 6;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(crystal.x - w / 2, crystal.y - 30, w, h);
  const g = ctx.createLinearGradient(crystal.x - w / 2, 0, crystal.x + w / 2, 0);
  g.addColorStop(0, '#22c55e');
  g.addColorStop(1, '#eab308');
  ctx.fillStyle = g;
  ctx.fillRect(crystal.x - w / 2, crystal.y - 30, w * ratio, h);
}

function drawParticles() {
  for (const p of state.particles) {
    const a = 1 - (p.t / p.life);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawFloats() {
  ctx.font = 'bold 14px system-ui';
  ctx.textAlign = 'center';
  for (const f of state.floats) {
    const a = clamp(1 - f.t, 0, 1);
    ctx.fillStyle = f.color;
    ctx.globalAlpha = a;
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }
}

function drawTopBar() {
  ctx.save();
  ctx.fillStyle = 'rgba(15,23,42,0.95)';
  ctx.fillRect(0, 0, LOGICAL_W, 32);

  ctx.font = 'bold 14px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e5e7eb';
  const pAlive = state.towers.filter(t => t.team === 'P' && t.hp > 0).length;
  const eAlive = state.towers.filter(t => t.team === 'E' && t.hp > 0).length;
  const crownsP = 2 - eAlive;
  const crownsE = 2 - pAlive;
  ctx.fillText(`Arena ${state.profile.arena} • 👑 ${crownsP} - ${crownsE} 👑`, LOGICAL_W / 2, 20);

  ctx.textAlign = 'left';
  ctx.font = '11px system-ui';
  ctx.fillStyle = '#9ca3af';
  ctx.fillText(`Lvl ${state.profile.level} • Vittorie ${state.profile.wins}`, 10, 20);
  ctx.restore();
}

function drawBottomUI() {
  const y0 = FIELD_H;
  const h = UI_H;

  ctx.save();
  ctx.fillStyle = 'rgba(15,23,42,0.97)';
  ctx.beginPath();
  ctx.roundRect(0, y0, LOGICAL_W, h, [24, 24, 0, 0]);
  ctx.fill();

  // barra mana
  const xPad = 24;
  const barY = y0 + 18;
  const barH = 12;
  const barW = LOGICAL_W - xPad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.roundRect(xPad, barY, barW, barH, 6);
  ctx.fill();

  const ratio = clamp(state.manaP / state.manaMax, 0, 1);
  const grad = ctx.createLinearGradient(xPad, barY, xPad + barW, barY);
  grad.addColorStop(0, '#38bdf8');
  grad.addColorStop(1, '#3b82f6');
  ctx.fillStyle = grad;
  ctx.roundRect(xPad, barY, barW * ratio, barH, 6);
  ctx.fill();

  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e5e7eb';
  ctx.fillText(
    `Mana: ${state.manaP.toFixed(1)} / ${state.manaMax.toFixed(0)}`,
    xPad,
    barY - 4
  );

  // carte
  const cardsY = y0 + 40;
  const cardsH = h - 54;
  const totalW = LOGICAL_W - xPad * 2;
  const cardW = totalW / CARD_ORDER.length;

  for (let i = 0; i < CARD_ORDER.length; i++) {
    const id = CARD_ORDER[i];
    const type = UNIT_TYPES[id];
    const cx = xPad + i * cardW;
    const rect = { x: cx + 6, y: cardsY, w: cardW - 12, h: cardsH - 12 };

    ctx.save();
    ctx.fillStyle = '#020617';
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.45)';
    ctx.lineWidth = 1.5;
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 16);
    ctx.stroke();

    // icona circolare
    const icx = rect.x + rect.w / 2;
    const icy = rect.y + 32;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(icx, icy, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = type.color;
    ctx.beginPath();
    ctx.arc(icx, icy, 16, 0, Math.PI * 2);
    ctx.fill();

    // nome
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(type.name, icx, rect.y + 62);

    // costo
    ctx.font = '11px system-ui';
    ctx.fillStyle = '#a5b4fc';
    ctx.fillText(`Costo: ${type.cost}`, icx, rect.y + 78);

    // se non hai mana → “X”
    if (state.manaP < type.cost && state.playing) {
      ctx.fillStyle = 'rgba(15,23,42,0.7)';
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(248,113,113,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rect.x + 10, rect.y + 10);
      ctx.lineTo(rect.x + rect.w - 10, rect.y + rect.h - 10);
      ctx.moveTo(rect.x + rect.w - 10, rect.y + 10);
      ctx.lineTo(rect.x + 10, rect.y + rect.h - 10);
      ctx.stroke();
    }

    ctx.restore();
  }

  // messaggio fine partita
  if (!state.playing) {
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(
      'Partita finita – tocca una carta per ricominciare',
      LOGICAL_W / 2,
      y0 + h - 18
    );
  }

  ctx.restore();
}

function render() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  applyTransform();

  drawBackground();
  drawCrystal();

  // torri
  for (const t of state.towers) drawTower(t);

  // unità
  // ordina per y per dare impressione di profondità
  const sortedUnits = [...state.units].sort((a, b) => a.y - b.y);
  for (const u of sortedUnits) drawUnit(u);

  drawParticles();
  drawFloats();
  drawTopBar();
  drawBottomUI();

  ctx.restore();
}

/* ============================ INPUT / CONTROLLI =========================== */

let lastTouchTime = 0;

function handlePointerDown(ev) {
  ev.preventDefault();
  const isTouch = ev.type.startsWith('touch');
  let pointEv = ev;
  if (isTouch) {
    const touch = ev.changedTouches[0];
    pointEv = { clientX: touch.clientX, clientY: touch.clientY };
  }

  const p = toLogical(pointEv);
  if (p.x < 0 || p.x > LOGICAL_W || p.y < 0 || p.y > LOGICAL_H) return;

  // se tocco sul campo → cambio corsia
  if (p.y < FIELD_H) {
    // tocco centrale: lane in base a x
    let lane = 0;
    if (p.x < (COL_X[0] + COL_X[1]) * 0.5) lane = 0;
    else if (p.x > (COL_X[1] + COL_X[2]) * 0.5) lane = 2;
    else lane = 1;
    selectedLane = lane;
    return;
  }

  // sotto → carte
  const y0 = FIELD_H;
  const h = UI_H;
  const xPad = 24;
  const cardsY = y0 + 40;
  const cardsH = h - 54;
  const totalW = LOGICAL_W - xPad * 2;
  const cardW = totalW / CARD_ORDER.length;

  if (p.y < cardsY || p.y > cardsY + cardsH) return;

  // se partita finita → qualsiasi carta resetta
  if (!state.playing) {
    resetGame();
    return;
  }

  for (let i = 0; i < CARD_ORDER.length; i++) {
    const cx = xPad + i * cardW;
    const rect = { x: cx + 6, y: cardsY, w: cardW - 12, h: cardsH - 12 };
    if (
      p.x >= rect.x &&
      p.x <= rect.x + rect.w &&
      p.y >= rect.y &&
      p.y <= rect.y + rect.h
    ) {
      const typeId = CARD_ORDER[i];
      const type = UNIT_TYPES[typeId];
      if (state.manaP >= type.cost && state.playing) {
        state.manaP = Math.max(0, state.manaP - type.cost);
        spawnUnit('P', selectedLane, typeId);
      }
      break;
    }
  }
}

canvas.addEventListener('mousedown', handlePointerDown, { passive: false });
canvas.addEventListener('touchstart', handlePointerDown, { passive: false });

/* ================================ GAME LOOP ================================ */

let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.03, Math.max(0.0, (now - lastTime) / 1000));
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
