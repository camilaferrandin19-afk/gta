// Polícia e nível de procurado (estilo GTA). Sem DOM; testável.
//
// "heat" é contínuo; as estrelas são floor(heat), de 0 a 5.
// Fora da vista da polícia por algum tempo, perde uma estrela por vez.

export const MAX_STARS = 5;

export const CRIMES = {
  shot: 0.06,          // cada tiro (o primeiro tiro já dá 1 estrela, ver abaixo)
  ped: 0.6,            // pedestre derrubado pela protagonista
  vehicle: 0.8,        // veículo destruído
  carjack: 0.35,       // tomar carro de motorista
  'hit-police': 0.5,   // bater numa viatura
  'police-down': 1.5,  // destruir uma viatura
};

export function createWanted() {
  return { heat: 0, unseen: 0, seenRecently: false, flash: false };
}

export function stars(w) {
  return Math.max(0, Math.min(MAX_STARS, Math.floor(w.heat + 1e-9)));
}

export function reportCrime(w, type, amount = null) {
  const add = amount ?? CRIMES[type] ?? 0;
  const before = stars(w);
  // Atirar em público chama a polícia na hora
  if (type === 'shot' && w.heat < 1) w.heat = 1;
  w.heat = Math.min(MAX_STARS + 0.99, w.heat + add);
  w.unseen = 0;
  return stars(w) - before;
}

export function clearWanted(w) {
  w.heat = 0;
  w.unseen = 0;
  w.flash = false;
}

/** Tempo fora da vista para perder uma estrela (mais estrelas = mais tempo). */
export function escapeTime(level) {
  return 6 + level * 2;
}

/**
 * Avança o tempo. seen = alguma viatura enxerga a protagonista.
 * Retorna 'lost-star' | 'escaped' | null.
 */
export function tickWanted(w, dt, seen, escapeMult = 1) {
  const level = stars(w);
  w.seenRecently = seen;
  if (level === 0) {
    w.heat = Math.max(0, w.heat - dt * 0.05);
    w.unseen = 0;
    w.flash = false;
    return null;
  }
  if (seen) {
    w.unseen = 0;
    w.flash = false;
    return null;
  }
  w.unseen += dt;
  w.flash = true;
  if (w.unseen >= escapeTime(level) * escapeMult) {
    w.unseen = 0;
    w.heat = level - 1;
    return level - 1 === 0 ? 'escaped' : 'lost-star';
  }
  return null;
}

/** Quantas viaturas devem estar perseguindo. */
export function desiredPoliceCars(level) {
  return [0, 1, 2, 3, 4, 4][Math.max(0, Math.min(5, level))];
}

/** A partir de 3 estrelas a polícia atira. */
export function policeShoots(level) {
  return level >= 3;
}

/**
 * Rota em "L" pela malha de ruas (a cidade é uma grade completa).
 * pf precisa de nearestNode(x, y) → {ix, iy} e nodeToWorld(ix, iy) → {x, y}.
 */
export function gridRoute(pf, from, to) {
  const a = pf.nearestNode(from.x, from.y);
  const b = pf.nearestNode(to.x, to.y);
  const pts = [pf.nodeToWorld(a.ix, a.iy)];
  const corner = Math.abs(b.ix - a.ix) >= Math.abs(b.iy - a.iy)
    ? pf.nodeToWorld(b.ix, a.iy)
    : pf.nodeToWorld(a.ix, b.iy);
  const last = pts[pts.length - 1];
  if (corner.x !== last.x || corner.y !== last.y) pts.push(corner);
  const end = pf.nodeToWorld(b.ix, b.iy);
  const last2 = pts[pts.length - 1];
  if (end.x !== last2.x || end.y !== last2.y) pts.push(end);
  pts.push({ x: to.x, y: to.y });
  // Se já está mais perto do 1º ponto seguinte do que do nó, pula o nó
  if (pts.length > 2) {
    const d0 = Math.hypot(pts[0].x - from.x, pts[0].y - from.y);
    const d1 = Math.hypot(pts[1].x - from.x, pts[1].y - from.y);
    const d01 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    if (d1 < d01 && d0 < d01) pts.shift();
  }
  return pts;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Controle de direção da viatura rumo ao próximo ponto.
 * Retorna { moveX, actionPressed, secondaryPressed } no formato da entrada do jogador.
 */
export function driveToward(car, point, { ram = false, dt = 1 / 60 } = {}) {
  const desired = Math.atan2(point.y - car.y, point.x - car.x);
  const diff = wrapAngle(desired - car.angle);
  const dist = Math.hypot(point.x - car.x, point.y - car.y);

  // Destravar: parado com acelerador → dá ré girando
  if (car.unstickTimer > 0) {
    car.unstickTimer = Math.max(0, car.unstickTimer - dt);
    return { moveX: -Math.sign(diff || 1), actionPressed: false, secondaryPressed: true };
  }
  if ((car.speed || 0) < 22 && !car.waitingAtTarget) {
    car.stuckFor = (car.stuckFor || 0) + dt;
    if (car.stuckFor > 1.3) {
      car.stuckFor = 0;
      car.unstickTimer = 0.9;
    }
  } else {
    car.stuckFor = 0;
  }

  // Ponto às costas: ré em curva ajuda a manobrar
  if (Math.abs(diff) > 2.4 && dist < 120 && !ram) {
    return { moveX: -Math.sign(diff), actionPressed: false, secondaryPressed: true };
  }
  const moveX = Math.max(-1, Math.min(1, diff * 2.2));
  const sharp = Math.abs(diff) > 0.9;
  const fast = (car.speed || 0) > (sharp ? 170 : 330);
  const brake = !ram && fast && (sharp || dist < 110);
  return { moveX, actionPressed: !brake, secondaryPressed: brake };
}

export const POLICE_PROFILE = {
  maxSpeed: 470,
  reverseMax: 180,
  accel: 520,
  brake: 760,
  turnRate: 3.4,
  lateralGrip: 10,
  driftGrip: 5,
  length: 46,
  width: 24,
  radius: 17,
};
