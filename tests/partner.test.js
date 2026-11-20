import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartner, followTarget, pickLine, updatePartner, PARTNER_LINES } from '../src/world/partner.js';

const camila = { id: 'camila', name: 'Camila', skinColor: '#f3cda6', sleeveColor: '#2c6a43', sprites: { top: 'a.svg' } };

function step(partner, ctx, times = 1, dt = 1 / 30) {
  let last = null;
  for (let i = 0; i < times; i++) {
    const ev = updatePartner(partner, { dt, ...ctx });
    if (ev) last = ev;
  }
  return last;
}

test('parceira aparece atrás da protagonista e a segue', () => {
  const p = createPartner(camila);
  const player = { x: 500, y: 500, angle: 0, radius: 10 };
  step(p, { player });
  assert.equal(p.state, 'following');
  assert.ok(p.visible);
  assert.ok(p.x < player.x, 'fica atrás (protagonista olhando para +x)');

  player.x = 800;
  step(p, { player }, 90);
  const d = Math.hypot(player.x - p.x, player.y - p.y);
  assert.ok(d < 70, `alcançou a protagonista (distância ${d.toFixed(1)})`);
  assert.equal(p.sprites.sleeveColor, '#2c6a43');
});

test('parceira embarca, viaja junto e desce do outro lado', () => {
  const p = createPartner(camila);
  const player = { x: 500, y: 500, angle: 0, radius: 10 };
  step(p, { player });
  const car = { id: 'v1', kind: 'car', x: 520, y: 500, angle: 0, width: 24, length: 44 };

  const ev = step(p, { player, playerVehicle: car }, 30);
  assert.equal(ev, 'boarded');
  assert.equal(p.state, 'riding');
  assert.equal(p.visible, false, 'dentro do carro não aparece');

  car.x = 900;
  step(p, { player, playerVehicle: car });
  assert.equal(p.x, 900, 'viaja junto');

  // protagonista desce pelo lado de cima (y menor)
  player.x = 900;
  player.y = 470;
  const ev2 = step(p, { player, playerVehicle: null, lastVehicle: car });
  assert.equal(ev2, 'exited');
  assert.equal(p.state, 'following');
  assert.ok(p.y > car.y, 'desce pelo lado oposto ao da protagonista');
});

test('na moto ela fica visível (garupa); muito longe ela "pula" para dentro', () => {
  const p = createPartner(camila);
  const player = { x: 0, y: 0, angle: 0, radius: 10 };
  step(p, { player });
  const moto = { id: 'm1', kind: 'moto', x: 1000, y: 0, angle: 0, width: 16 };
  const ev = step(p, { player, playerVehicle: moto });
  assert.equal(ev, 'boarded');
  step(p, { player, playerVehicle: moto });
  assert.equal(p.visible, true);
});

test('se ficar muito para trás, reaparece perto', () => {
  const p = createPartner(camila);
  const player = { x: 0, y: 0, angle: 0, radius: 10 };
  step(p, { player });
  player.x = 3000;
  const ev = step(p, { player });
  assert.equal(ev, 'teleported');
  assert.ok(Math.hypot(player.x - p.x, player.y - p.y) < 80);
});

test('followTarget e falas', () => {
  const t = followTarget({ x: 0, y: 0, angle: Math.PI / 2 }, 40);
  assert.ok(t.y < 0, 'olhando para baixo, o ponto fica acima');
  for (const kind of Object.keys(PARTNER_LINES)) {
    assert.ok(PARTNER_LINES[kind].includes(pickLine(kind, () => 0)));
  }
});
