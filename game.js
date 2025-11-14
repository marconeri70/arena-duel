// =======================================================
// Arena Duel PWA - base verticale con 3 corsie
// - torri sopra/sotto
// - truppe che NON si sorpassano
// - cristallo centrale con bonus mana
// - carte in basso
// =======================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

// Risoluzione logica
const W = 720;
const H = 1280;
const UI_H = 220;
const FIELD_H = H - UI_H;

let scale = 1;
let offX = 0;
let offY = 0;

// --- Resize & mapping -------------------------------------------------------

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));

  scale = Math.min(canvas.width / W, canvas.height / H);
  offX = Math.floor((canvas.width - W * scale) / 2);
  offY = Math.floor((canvas.height - H * scale) / 2);
}

function toLogical(xClient, yClient) {
  const rect = canvas.getBoundingClientRect();
  const X = (xClient - rect.left) * (canvas.width / rect.width);
  const Y = (yClient - rect.top) * (canvas.height / rect.height);
  return {
    x: (X - offX) / scale,
    y: (Y - offY) / scale
  };
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();

// --- Helpers -----------------------------------------------------------------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// --- Colonne / corsie --------------------------------------------------------
const COL_X = [W * 0.18, W * 0.5, W * 0.82];
const RIVER_Y = FIELD_H * 0.5;
const CRYSTAL_RADIUS = 90;

// Stato di gioco
const state = {
  time: 0,
  playing: true,
  selectedLane: 1,
  manaP: 5,
  manaE: 5,
  manaMax: 10,
  manaBaseRegen: 1.8,   // punti al secondo
  manaCrystalBonus: 1.2, // bonus se controlli il cristallo
  notEnoughBlink: 0,

  units: [],
  towers: [],
  floats: [],
  particles: [],
};

// Tipi di unità
const unitTypes = [
  {
    id: 'scout',
    name: 'Scout',
    hp: 24,
    dmg: 4,
    speed: 110,   // pixel al secondo
    range: 32,    // distanza melee
    cost: 3,
    color: '#3B82F6'
  },
  {
    id: 'tank',
    name: 'Tank',
    hp: 75,
    dmg: 6,
    speed: 70,
    range: 38,
    cost: 4,
    color: '#EF4444'
  },
  {
    id: 'spark',
    name: 'Spark',
    hp: 20,
    dmg: 5,
    speed: 90,
    range: 34,
    cost: 2,
    color: '#FBBF24'
  }
];

function initGame() {
  state.units = [];
  state.floats = [];
  state.particles = [];
  state.time = 0;
  state.playing = true;
  state.manaP = 5;
  state.manaE = 5;

  state.towers = [
    { team: 'P', lane: 0, hp: 120, maxHp: 120 },
    { team: 'P', lane: 2, hp: 120, maxHp: 120 },
    { team: 'E', lane: 0, hp: 120, maxHp: 120 },
    { team: 'E', lane: 2, hp: 120, maxHp: 120 },
  ];
}

initGame();

// Utility stato
function getTower(team, lane) {
  return state.towers.find(t => t.team === team && t.lane === lane) || null;
}

function spawnUnit(team, lane, type) {
  const startY = team === 'P' ? FIELD_H - 120 : 120;
  state.units.push({
    team,
    lane,
    type,
    x: COL_X[lane],
    y: startY,
    hp: type.hp,
    atkCooldown: 0
  });
}

function addFloat(text, x, y, color) {
  state.floats.push({ text, x, y, t: 0, color });
}

function addHitParticles(x, y, color) {
  for (let i = 0; i < 8; i++) {
    state.particles.push({
      x,
      y,
      vx: rand(-1.2, 1.2),
      vy: rand(-2.0, -0.4),
      life: rand(0.3, 0.6),
      t: 0,
      color
    });
  }
}

// --- Input (tap/touch) -------------------------------------------------------

let pointerDown = false;

function handlePointerDown(ev) {
  ev.preventDefault();
  pointerDown = true;
  const first =
    ev.touches && ev.touches.length
      ? ev.touches[0]
      : ev.changedTouches && ev.changedTouches.length
      ? ev.changedTouches[0]
      : ev;

  const posL = toLogical(first.clientX, first.clientY);
  handleTap(posL.x, posL.y);
}
function handlePointerUp(ev) {
  pointerDown = false;
}

canvas.addEventListener('mousedown', handlePointerDown);
canvas.addEventListener('mouseup', handlePointerUp);
canvas.addEventListener('touchstart', handlePointerDown, { passive: false });
canvas.addEventListener('touchend', handlePointerUp);

function handleTap(x, y) {
  if (x < 0 || x > W || y < 0 || y > H) return;

  // Se partita finita → tocco sulle carte = reset
  if (!state.playing && y > FIELD_H) {
    initGame();
    return;
  }

  if (y <= FIELD_H) {
    // Tap nel campo = cambio corsia
    let bestLane = 0;
    let bestDist = Infinity;
    for (let i = 0; i < 3; i++) {
      const d = Math.abs(x - COL_X[i]);
      if (d < bestDist) {
        bestDist = d;
        bestLane = i;
      }
    }
    state.selectedLane = bestLane;
  } else {
    // Tap nella zona carte
    handleCardTap(x, y);
  }
}

function handleCardTap(x, y) {
  const cardsTop = FIELD_H + 40;
  const cardsHeight = UI_H - 60;
  if (y < cardsTop || y > cardsTop + cardsHeight) return;

  const margin = 24;
  const totalWidth = W - margin * 2;
  const cardWidth = totalWidth / unitTypes.length;

  for (let i = 0; i < unitTypes.length; i++) {
    const cx = margin + i * cardWidth;
    const rect = {
      x: cx,
      y: cardsTop,
      w: cardWidth - 10,
      h: cardsHeight - 20
    };
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
      if (!state.playing) {
        initGame();
        return;
      }
      const type = unitTypes[i];
      if (state.manaP >= type.cost) {
        state.manaP -= type.cost;
        spawnUnit('P', state.selectedLane, type);
      } else {
        state.notEnoughBlink = 0.4;
      }
      break;
    }
  }
}

// --- Update loop -------------------------------------------------------------

let lastTime = performance.now();
let aiTimer = 1.5;

function gameLoop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  update(dt);
  draw();

  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

function update(dt) {
  state.time += dt;
  if (state.notEnoughBlink > 0) state.notEnoughBlink -= dt;

  // Mana regen con bonus cristallo
  let bonusP = 0;
  let bonusE = 0;

  // Controllo cristallo centrale: se una unità è vicina al centro
  let controlP = 0;
  let controlE = 0;
  for (const u of state.units) {
    const dy = Math.abs(u.y - RIVER_Y);
    const dx = Math.abs(u.x - COL_X[1]);
    const d = Math.hypot(dx, dy);
    if (d <= CRYSTAL_RADIUS) {
      if (u.team === 'P') controlP++;
      else controlE++;
    }
  }
  if (controlP > controlE && controlP > 0) bonusP = state.manaCrystalBonus;
  else if (controlE > controlP && controlE > 0) bonusE = state.manaCrystalBonus;

  const regenP = state.manaBaseRegen + bonusP;
  const regenE = state.manaBaseRegen + bonusE;

  if (state.playing) {
    state.manaP = clamp(state.manaP + regenP * dt, 0, state.manaMax);
    state.manaE = clamp(state.manaE + regenE * dt, 0, state.manaMax);
  }

  // Semplice IA nemica
  if (state.playing) {
    aiTimer -= dt;
    if (aiTimer <= 0) {
      aiTimer = rand(1.0, 2.4);
      const affordable = unitTypes.filter(t => state.manaE >= t.cost);
      if (affordable.length > 0) {
        const type = affordable[(Math.random() * affordable.length) | 0];
        state.manaE -= type.cost;
        const lane = (Math.random() * 3) | 0;
        spawnUnit('E', lane, type);
      }
    }
  }

  updateUnits(dt);
  updateFloats(dt);
  updateParticles(dt);
  updateResult();
}

function updateUnits(dt) {
  const minGap = 45;    // distanza minima tra alleati
  const atkInterval = 0.6;

  for (const u of state.units) {
    u.atkCooldown -= dt;
    const dir = u.team === 'P' ? -1 : 1;

    // Nemico più vicino davanti nella stessa corsia
    let frontEnemy = null;
    let bestDist = Infinity;

    for (const other of state.units) {
      if (other.team === u.team || other.lane !== u.lane) continue;
      const dy = (other.y - u.y) * dir;
      if (dy <= 0) continue;
      if (dy < bestDist) {
        bestDist = dy;
        frontEnemy = other;
      }
    }

    // Torre nemica nella stessa corsia
    let towerEnemy = getTower(u.team === 'P' ? 'E' : 'P', u.lane);
    if (towerEnemy) {
      const towerY = towerEnemy.team === 'P' ? FIELD_H - 80 : 80;
      const dyTower = (towerY - u.y) * dir;
      if (dyTower > 0 && dyTower < bestDist) {
        bestDist = dyTower;
        frontEnemy = null;
      }
    }

    // Alleato davanti per evitare sorpasso
    let frontAlly = null;
    let allyDy = Infinity;
    for (const other of state.units) {
      if (other === u || other.team !== u.team || other.lane !== u.lane) continue;
      const dy = (other.y - u.y) * dir;
      if (dy <= 0) continue;
      if (dy < allyDy) {
        allyDy = dy;
        frontAlly = other;
      }
    }

    let canMove = true;
    if (frontAlly && allyDy < minGap) {
      canMove = false;
    }

    // Attacco contro unità
    let attacked = false;
    if (frontEnemy && bestDist <= u.type.range) {
      if (u.atkCooldown <= 0 && state.playing) {
        u.atkCooldown = atkInterval;
        frontEnemy.hp -= u.type.dmg;
        addFloat(`-${u.type.dmg | 0}`, frontEnemy.x, frontEnemy.y - 28, '#F97316');
        addHitParticles(frontEnemy.x, frontEnemy.y - 6, '#FDBA74');
        attacked = true;
      }
    } else if (towerEnemy) {
      const towerY = towerEnemy.team === 'P' ? FIELD_H - 80 : 80;
      const dy = (towerY - u.y) * dir;
      if (dy <= u.type.range && u.atkCooldown <= 0 && state.playing) {
        u.atkCooldown = atkInterval;
        towerEnemy.hp -= u.type.dmg;
        const tx = COL_X[u.lane];
        addFloat(`-${u.type.dmg | 0}`, tx, towerY - 40, '#FB7185');
        addHitParticles(tx, towerY - 14, '#FCA5A5');
        attacked = true;
      }
    }

    if (!attacked && canMove && state.playing) {
      u.y += dir * u.type.speed * dt;
    }
  }

  // Rimuovi unità morte o fuori campo
  state.units = state.units.filter(
    u => u.hp > 0 && u.y > 40 && u.y < FIELD_H - 40
  );
}

function updateFloats(dt) {
  for (const f of state.floats) {
    f.t += dt;
    f.y -= 25 * dt;
  }
  state.floats = state.floats.filter(f => f.t < 1.0);
}

function updateParticles(dt) {
  for (const p of state.particles) {
    p.t += dt;
    p.x += p.vx * 60 * dt;
    p.y += p.vy * 60 * dt;
    p.vy += 0.12;
  }
  state.particles = state.particles.filter(p => p.t < p.life);
}

function updateResult() {
  let aliveP = 0;
  let aliveE = 0;
  for (const t of state.towers) {
    if (t.team === 'P' && t.hp > 0) aliveP++;
    if (t.team === 'E' && t.hp > 0) aliveE++;
  }

  if (aliveP === 0 || aliveE === 0) {
    if (state.playing) {
      // prima volta che la partita termina
      if (aliveP > aliveE) {
        addFloat('VICTORY!', W * 0.5, FIELD_H * 0.45, '#4ADE80');
      } else if (aliveE > aliveP) {
        addFloat('SCONFITTA', W * 0.5, FIELD_H * 0.45, '#F97373');
      } else {
        addFloat('PAREGGIO', W * 0.5, FIELD_H * 0.45, '#FACC15');
      }
    }
    state.playing = false;
  }
}

// --- Rendering ---------------------------------------------------------------

function draw() {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, offX, offY);

  // sfondo
  const gradBg = ctx.createLinearGradient(0, 0, 0, H);
  gradBg.addColorStop(0, '#111827');
  gradBg.addColorStop(1, '#020617');
  ctx.fillStyle = gradBg;
  ctx.fillRect(0, 0, W, H);

  drawField();
  drawCrystal();
  drawTowers();
  drawUnits();
  drawParticles();
  drawFloats();
  drawTopBar();
  drawBottomUI();

  ctx.restore();
}

function drawField() {
  // prato
  const fieldGrad = ctx.createLinearGradient(0, 0, 0, FIELD_H);
  fieldGrad.addColorStop(0, '#DCFCE7');
  fieldGrad.addColorStop(1, '#A7F3D0');
  ctx.fillStyle = fieldGrad;
  ctx.fillRect(0, 0, W, FIELD_H);

  // griglia leggera
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 1;
  for (let y = 40; y < FIELD_H; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // corsia selezionata
  const laneW = W / 3;
  ctx.fillStyle = 'rgba(37,99,235,0.18)';
  ctx.fillRect(state.selectedLane * laneW, 0, laneW, FIELD_H);

  // linee corsie
  ctx.strokeStyle = 'rgba(15,23,42,0.25)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 3; i++) {
    const x = i * laneW;
    ctx.beginPath();
    ctx.moveTo(x, 12);
    ctx.lineTo(x, FIELD_H - 12);
    ctx.stroke();
  }

  // fiume
  const riverH = 46;
  const riverTop = RIVER_Y - riverH / 2;
  const riverGrad = ctx.createLinearGradient(0, riverTop, 0, riverTop + riverH);
  riverGrad.addColorStop(0, '#BFDBFE');
  riverGrad.addColorStop(0.5, '#60A5FA');
  riverGrad.addColorStop(1, '#1D4ED8');
  ctx.fillStyle = riverGrad;
  ctx.fillRect(0, riverTop, W, riverH);

  // increspature
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ffffff';
  const t = state.time * 1.5;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    const baseY = RIVER_Y + Math.sin(t + i) * 3;
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= W; x += 16) {
      const y = baseY + Math.sin(x * 0.03 + t * 1.7) * 3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, riverTop + riverH / 2 + 10);
    ctx.lineTo(0, riverTop + riverH / 2 + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // sponde
  ctx.fillStyle = '#B45309';
  ctx.fillRect(0, riverTop - 8, W, 6);
  ctx.fillRect(0, riverTop + riverH + 2, W, 6);
}

function drawCrystal() {
  const x = COL_X[1];
  const y = RIVER_Y;

  // alone
  const rad = ctx.createRadialGradient(x, y, 0, x, y, CRYSTAL_RADIUS);
  rad.addColorStop(0, 'rgba(129,140,248,0.92)');
  rad.addColorStop(0.4, 'rgba(129,140,248,0.45)');
  rad.addColorStop(1, 'rgba(129,140,248,0)');
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = rad;
  ctx.beginPath();
  ctx.arc(x, y, CRYSTAL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // cristallo centrale
  const pulse = 4 + Math.sin(state.time * 2.5) * 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(state.time * 0.8) * 0.08);

  const grad = ctx.createLinearGradient(-12, -24, 12, 24);
  grad.addColorStop(0, '#EEF2FF');
  grad.addColorStop(0.5, '#4F46E5');
  grad.addColorStop(1, '#1D4ED8');
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(0, -32 - pulse);
  ctx.lineTo(16 + pulse, 0);
  ctx.lineTo(0, 32 + pulse);
  ctx.lineTo(-16 - pulse, 0);
  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(15,23,42,0.85)';
  ctx.stroke();

  ctx.restore();

  // cerchio base
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#312E81';
  ctx.beginPath();
  ctx.ellipse(x, y + 26, 40, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTowers() {
  for (const t of state.towers) {
    const laneX = COL_X[t.lane];
    const y = t.team === 'P' ? FIELD_H - 80 : 80;

    // ombra
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(laneX, y + 24, 38, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // corpo
    const bodyW = 54;
    const bodyH = 66;
    const bodyX = laneX - bodyW / 2;
    const bodyY = y - bodyH / 2;

    const bodyGrad = ctx.createLinearGradient(bodyX, bodyY, bodyX, bodyY + bodyH);
    bodyGrad.addColorStop(0, '#E5E7EB');
    bodyGrad.addColorStop(1, '#9CA3AF');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(bodyX, bodyY, bodyW, bodyH, 16);
    ctx.fill();

    // contorno
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(30,64,175,0.7)';
    ctx.beginPath();
    ctx.roundRect(bodyX, bodyY, bodyW, bodyH, 16);
    ctx.stroke();

    // cupola
    const headColor = t.team === 'P' ? '#3B82F6' : '#EF4444';
    ctx.beginPath();
    ctx.arc(laneX, y - 16, 18, 0, Math.PI * 2);
    ctx.fillStyle = headColor;
    ctx.fill();

    // feritoie
    ctx.fillStyle = 'rgba(15,23,42,0.8)';
    ctx.fillRect(laneX - 8, y - 10, 16, 10);

    // barra HP
    const barW = 80;
    const barH = 8;
    const ratio = clamp(t.hp / t.maxHp, 0, 1);
    const bx = laneX - barW / 2;
    const by = y - bodyH / 2 - 18;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(bx, by, barW, barH, 4);
    ctx.fill();

    const hpGrad = ctx.createLinearGradient(bx, by, bx + barW, by);
    hpGrad.addColorStop(0, '#4ADE80');
    hpGrad.addColorStop(1, '#16A34A');
    ctx.fillStyle = hpGrad;
    ctx.beginPath();
    ctx.roundRect(bx, by, barW * ratio, barH, 4);
    ctx.fill();
  }
}

function drawUnits() {
  for (const u of state.units) {
    const x = u.x;
    const y = u.y;
    const bob = Math.sin((u.y / FIELD_H) * 10 + state.time * 6) * 3;

    // ombra
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(x, y + 22 + bob, 28, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // torso
    ctx.fillStyle = u.type.color;
    ctx.beginPath();
    ctx.roundRect(x - 18, y - 8 + bob, 36, 30, 8);
    ctx.fill();

    // testa
    ctx.fillStyle = '#FED7AA';
    ctx.beginPath();
    ctx.arc(x, y - 18 + bob, 11, 0, Math.PI * 2);
    ctx.fill();

    // viso
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(x - 4, y - 20 + bob, 1.4, 0, Math.PI * 2);
    ctx.arc(x + 4, y - 20 + bob, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - 4, y - 15 + bob, 8, 1.4);

    // simbolo sul petto
    ctx.fillStyle = 'rgba(15,23,42,0.35)';
    if (u.type.id === 'tank') {
      ctx.fillRect(x - 8, y + 2 + bob, 16, 10);
    } else if (u.type.id === 'spark') {
      ctx.beginPath();
      ctx.moveTo(x, y + bob);
      ctx.lineTo(x + 7, y + 12 + bob);
      ctx.lineTo(x - 7, y + 12 + bob);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(x - 7, y + 2 + bob, 14, 8, 3);
      ctx.fill();
    }

    // barra HP
    const ratio = clamp(u.hp / u.type.hp, 0, 1);
    const barW = 32;
    const barH = 4;
    const bx = x - barW / 2;
    const by = y - 32 + bob;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.roundRect(bx, by, barW, barH, 3);
    ctx.fill();

    ctx.fillStyle = '#22C55E';
    ctx.beginPath();
    ctx.roundRect(bx, by, barW * ratio, barH, 3);
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of state.particles) {
    const alpha = clamp(1 - p.t / p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawFloats() {
  ctx.font = 'bold 14px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const f of state.floats) {
    const a = clamp(1 - f.t, 0, 1);
    ctx.fillStyle = f.color;
    ctx.globalAlpha = a;
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }
}

function drawTopBar() {
  ctx.fillStyle = 'rgba(15,23,42,0.96)';
  ctx.fillRect(0, 0, W, 36);

  ctx.font = 'bold 13px system-ui';
  ctx.fillStyle = '#E5E7EB';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const txt = `Arena Duel • 👑 TU: ${scorePlayer()}  –  NEMICO: ${scoreEnemy()} 👑`;
  ctx.fillText(txt, W / 2, 18);
}

function scorePlayer() {
  // corone = torri nemiche distrutte
  const enemyTowers = state.towers.filter(t => t.team === 'E');
  let destroyed = 0;
  for (const t of enemyTowers) if (t.hp <= 0) destroyed++;
  return destroyed;
}
function scoreEnemy() {
  const playerTowers = state.towers.filter(t => t.team === 'P');
  let destroyed = 0;
  for (const t of playerTowers) if (t.hp <= 0) destroyed++;
  return destroyed;
}

function drawBottomUI() {
  const top = FIELD_H;
  ctx.fillStyle = 'rgba(15,23,42,0.96)';
  ctx.beginPath();
  ctx.roundRect(0, top, W, UI_H, [20, 20, 0, 0]);
  ctx.fill();

  // barra mana
  const margin = 24;
  const barW = W - margin * 2;
  const barH = 12;
  const barX = margin;
  const barY = top + 14;

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, 6);
  ctx.fill();

  const ratio = clamp(state.manaP / state.manaMax, 0, 1);
  const grad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
  grad.addColorStop(0, '#38BDF8');
  grad.addColorStop(1, '#3B82F6');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW * ratio, barH, 6);
  ctx.fill();

  ctx.font = '11px system-ui';
  ctx.fillStyle = '#E5E7EB';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Mana: ${state.manaP.toFixed(1)} / ${state.manaMax.toFixed(0)}`, margin, barY - 2);

  // Cristallo status
  ctx.textAlign = 'right';
  const txtCrystal = 'Cristallo = bonus mana centrale';
  ctx.fillText(txtCrystal, W - margin, barY - 2);

  // carte
  const cardsTop = top + 40;
  const cardAreaH = UI_H - 54;
  const totalWidth = W - margin * 2;
  const cardWidth = totalWidth / unitTypes.length;

  for (let i = 0; i < unitTypes.length; i++) {
    const c = unitTypes[i];
    const x = margin + i * cardWidth;
    const rectX = x;
    const rectY = cardsTop;
    const rectW = cardWidth - 10;
    const rectH = cardAreaH - 14;

    // sfondo carta
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.roundRect(rectX, rectY, rectW, rectH, 16);
    ctx.fill();

    // bordo
    const affordable = state.manaP >= c.cost;
    ctx.strokeStyle = affordable
      ? 'rgba(52,211,153,0.85)'
      : 'rgba(148,163,184,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(rectX, rectY, rectW, rectH, 16);
    ctx.stroke();

    // icona
    const cx = rectX + rectW / 2;
    const cy = rectY + 30;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.name[0], cx, cy + 1);

    // nome
    ctx.fillStyle = '#E5E7EB';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(c.name, rectX + 10, rectY + 58);

    // costo
    ctx.fillStyle = '#EAB308';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`Costo: ${c.cost}`, rectX + 10, rectY + 76);
  }

  // testo fine partita
  if (!state.playing) {
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FACC15';
    ctx.fillText(
      'Partita finita – tocca una carta per ricominciare',
      W / 2,
      top + UI_H - 18
    );
  }

  // lampeggio "mana insufficiente"
  if (state.notEnoughBlink > 0) {
    const alpha = clamp(state.notEnoughBlink * 2.5, 0, 0.7);
    ctx.fillStyle = `rgba(248,113,113,${alpha})`;
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Mana insufficiente!', W / 2, top + 34);
  }
}
