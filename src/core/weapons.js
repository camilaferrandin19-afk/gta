// Armas estilo GTA: estado do arsenal, disparo e balística (sem DOM; testável).

export const WEAPONS = {
  punhos: { id: 'punhos', name: 'Punhos', slot: 1, melee: true, cooldown: 0.42, damage: 20, range: 26 },
  pistola: {
    id: 'pistola', name: 'Pistola', slot: 2, cooldown: 0.3, damage: 34, magSize: 12, reload: 1.1,
    speed: 1150, range: 560, spread: 0.035, pellets: 1, startAmmo: 96, auto: false,
  },
  submetralhadora: {
    id: 'submetralhadora', name: 'Submetralhadora', slot: 3, cooldown: 0.085, damage: 15, magSize: 30, reload: 1.6,
    speed: 1250, range: 520, spread: 0.09, pellets: 1, startAmmo: 240, auto: true,
  },
  escopeta: {
    id: 'escopeta', name: 'Escopeta', slot: 4, cooldown: 0.85, damage: 13, magSize: 6, reload: 2.0,
    speed: 1000, range: 300, spread: 0.3, pellets: 7, startAmmo: 36, auto: false,
  },
};

export const WEAPON_ORDER = ['punhos', 'pistola', 'submetralhadora', 'escopeta'];

export function createArsenal() {
  return {
    owned: new Set(['punhos']),
    current: 'punhos',
    mag: {},      // balas no pente
    reserve: {},  // balas de reserva
    cooldown: 0,
    reloadTimer: 0,
    muzzleFlash: 0,
  };
}

export function giveWeapon(arsenal, id, extraAmmo = null) {
  const w = WEAPONS[id];
  if (!w) return;
  const firstTime = !arsenal.owned.has(id);
  arsenal.owned.add(id);
  if (w.melee) return;
  if (firstTime) arsenal.mag[id] = w.magSize;
  arsenal.reserve[id] = (arsenal.reserve[id] || 0) + (extraAmmo ?? w.startAmmo);
}

export function giveAllWeapons(arsenal) {
  for (const id of WEAPON_ORDER) giveWeapon(arsenal, id);
  for (const id of WEAPON_ORDER) {
    const w = WEAPONS[id];
    if (!w.melee) arsenal.mag[id] = w.magSize;
  }
  if (arsenal.current === 'punhos') arsenal.current = 'pistola';
}

export function selectWeapon(arsenal, id) {
  if (!arsenal.owned.has(id) || arsenal.current === id) return false;
  arsenal.current = id;
  arsenal.reloadTimer = 0;
  arsenal.cooldown = Math.max(arsenal.cooldown, 0.15);
  return true;
}

export function cycleWeapon(arsenal, dir = 1) {
  const owned = WEAPON_ORDER.filter((id) => arsenal.owned.has(id));
  if (owned.length < 2) return false;
  const idx = owned.indexOf(arsenal.current);
  const next = owned[(idx + dir + owned.length) % owned.length];
  return selectWeapon(arsenal, next);
}

export function startReload(arsenal) {
  const w = WEAPONS[arsenal.current];
  if (!w || w.melee || arsenal.reloadTimer > 0) return false;
  if ((arsenal.mag[w.id] || 0) >= w.magSize || (arsenal.reserve[w.id] || 0) <= 0) return false;
  arsenal.reloadTimer = w.reload;
  return true;
}

/** Avança os timers; conclui a recarga quando der. */
export function tickArsenal(arsenal, dt) {
  arsenal.cooldown = Math.max(0, arsenal.cooldown - dt);
  arsenal.muzzleFlash = Math.max(0, arsenal.muzzleFlash - dt);
  if (arsenal.reloadTimer > 0) {
    arsenal.reloadTimer = Math.max(0, arsenal.reloadTimer - dt);
    if (arsenal.reloadTimer === 0) {
      const w = WEAPONS[arsenal.current];
      const need = w.magSize - (arsenal.mag[w.id] || 0);
      const take = Math.min(need, arsenal.reserve[w.id] || 0);
      arsenal.mag[w.id] = (arsenal.mag[w.id] || 0) + take;
      arsenal.reserve[w.id] = (arsenal.reserve[w.id] || 0) - take;
    }
  }
}

/**
 * Tenta atirar. Retorna { kind: 'melee' } | { kind: 'shot', bullets: [...] } | { kind: 'empty' } | null.
 * origin = { x, y }, angle em radianos, rnd para testes.
 */
export function tryFire(arsenal, origin, angle, rnd = Math.random) {
  if (arsenal.cooldown > 0 || arsenal.reloadTimer > 0) return null;
  const w = WEAPONS[arsenal.current];
  if (!w) return null;
  arsenal.cooldown = w.cooldown;
  if (w.melee) return { kind: 'melee', weapon: w };
  if ((arsenal.mag[w.id] || 0) <= 0) {
    if (!startReload(arsenal)) return { kind: 'empty', weapon: w };
    return null;
  }
  arsenal.mag[w.id] -= 1;
  arsenal.muzzleFlash = 0.06;
  const bullets = [];
  for (let i = 0; i < w.pellets; i++) {
    const a = angle + (rnd() - 0.5) * w.spread;
    const speed = w.speed * (0.92 + rnd() * 0.16);
    bullets.push({
      x: origin.x,
      y: origin.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      damage: w.damage,
      travelled: 0,
      range: w.range * (w.pellets > 1 ? 0.85 + rnd() * 0.3 : 1),
      alive: true,
      prevX: origin.x,
      prevY: origin.y,
    });
  }
  if (arsenal.mag[w.id] === 0) startReload(arsenal);
  return { kind: 'shot', weapon: w, bullets };
}

/**
 * Move as balas e resolve colisões.
 * hooks = {
 *   hitsWall(x, y) → bool,
 *   hitVehicle(x, y) → vehicle | null,
 *   hitPedestrian(x, y) → ped | null,
 * }
 * Retorna a lista de impactos: { type: 'wall'|'vehicle'|'ped', x, y, target, damage }.
 */
export function stepBullets(bullets, dt, hooks) {
  const impacts = [];
  for (const b of bullets) {
    if (!b.alive) continue;
    b.prevX = b.x;
    b.prevY = b.y;
    const dist = Math.hypot(b.vx, b.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / 8));
    for (let s = 0; s < steps && b.alive; s++) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;
      b.travelled += dist / steps;
      const ped = hooks.hitPedestrian?.(b.x, b.y);
      if (ped) {
        impacts.push({ type: 'ped', x: b.x, y: b.y, target: ped, damage: b.damage });
        b.alive = false;
        break;
      }
      const veh = hooks.hitVehicle?.(b.x, b.y);
      if (veh) {
        impacts.push({ type: 'vehicle', x: b.x, y: b.y, target: veh, damage: b.damage });
        b.alive = false;
        break;
      }
      if (hooks.hitsWall?.(b.x, b.y)) {
        impacts.push({ type: 'wall', x: b.x, y: b.y, target: null, damage: 0 });
        b.alive = false;
        break;
      }
      if (b.travelled >= b.range) b.alive = false;
    }
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    if (!bullets[i].alive) bullets.splice(i, 1);
  }
  return impacts;
}
