import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createArsenal, cycleWeapon, giveAllWeapons, selectWeapon, startReload, stepBullets, tickArsenal, tryFire, WEAPONS,
} from '../src/core/weapons.js';
import { CHEAT_CODES, createCheatBuffer, turboProfile } from '../src/core/cheats.js';

test('arsenal começa só com punhos; BANGBANG dá tudo', () => {
  const a = createArsenal();
  assert.deepEqual([...a.owned], ['punhos']);
  assert.equal(selectWeapon(a, 'pistola'), false);
  giveAllWeapons(a);
  assert.equal(a.current, 'pistola');
  assert.equal(a.mag.pistola, WEAPONS.pistola.magSize);
  assert.ok(cycleWeapon(a, 1));
  assert.equal(a.current, 'submetralhadora');
});

test('pistola atira, respeita cadência e recarrega sozinha', () => {
  const a = createArsenal();
  giveAllWeapons(a);
  const shot = tryFire(a, { x: 0, y: 0 }, 0, () => 0.5);
  assert.equal(shot.kind, 'shot');
  assert.equal(shot.bullets.length, 1);
  assert.ok(shot.bullets[0].vx > 1000);
  assert.equal(tryFire(a, { x: 0, y: 0 }, 0), null, 'cadência impede tiro imediato');

  a.mag.pistola = 1;
  a.cooldown = 0;
  tryFire(a, { x: 0, y: 0 }, 0, () => 0.5);
  assert.ok(a.reloadTimer > 0, 'pente vazio inicia recarga');
  const reserveBefore = a.reserve.pistola;
  tickArsenal(a, 5);
  assert.equal(a.mag.pistola, 12);
  assert.equal(a.reserve.pistola, reserveBefore - 12);
});

test('escopeta solta vários projéteis; recarga manual', () => {
  const a = createArsenal();
  giveAllWeapons(a);
  selectWeapon(a, 'escopeta');
  a.cooldown = 0;
  const shot = tryFire(a, { x: 0, y: 0 }, 0);
  assert.equal(shot.bullets.length, 7);
  tickArsenal(a, 1);
  assert.equal(startReload(a), true);
});

test('balas param na parede, acertam carro e pedestre', () => {
  const bullets = [
    { x: 0, y: 0, vx: 1000, vy: 0, damage: 10, travelled: 0, range: 500, alive: true },
    { x: 0, y: 100, vx: 1000, vy: 0, damage: 10, travelled: 0, range: 500, alive: true },
    { x: 0, y: 200, vx: 1000, vy: 0, damage: 10, travelled: 0, range: 500, alive: true },
  ];
  const car = { id: 'c' };
  const ped = { id: 'p' };
  const impacts = stepBullets(bullets, 0.2, {
    hitsWall: (x, y) => y === 0 && x > 50,
    hitVehicle: (x, y) => (y === 100 && x > 80 ? car : null),
    hitPedestrian: (x, y) => (y === 200 && x > 120 ? ped : null),
  });
  assert.equal(impacts.length, 3);
  assert.deepEqual(impacts.map((i) => i.type).sort(), ['ped', 'vehicle', 'wall']);
  assert.equal(bullets.length, 0);
});

test('códigos: reconhece digitação com letras extras antes', () => {
  const buf = createCheatBuffer();
  let got = null;
  for (const ch of 'wasdANALAURA') got = buf.push(ch) || got;
  assert.equal(got?.id, 'special-car');
  got = null;
  for (const ch of 'bangbang') got = buf.push(ch) || got;
  assert.equal(got?.id, 'weapons');
  assert.equal(buf.push('1'), null);
  // nenhum código usa teclas que já têm função
  for (const c of CHEAT_CODES) assert.ok(!/[IMFEQXZPK]/.test(c.code), `${c.code} usa tecla reservada`);
  const t = turboProfile({ maxSpeed: 100, accel: 100, brake: 100 });
  assert.ok(t.maxSpeed > 100 && t.accel > 100);
});
