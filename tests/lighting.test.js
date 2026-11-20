import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSky, createDayCycle } from '../src/render/lighting.js';

test('computeSky: meio-dia claro, meia-noite escura, pôr do sol dourado', () => {
  const noon = computeSky(12);
  assert.equal(noon.darkness, 0);
  assert.equal(noon.lights, 0);
  assert.ok(noon.sun > 0.99);

  const midnight = computeSky(0);
  assert.ok(midnight.darkness > 0.7);
  assert.equal(midnight.lights, 1);

  const sunset = computeSky(18);
  assert.ok(sunset.golden > 0.8, 'pôr do sol deve ser dourado');
  assert.ok(sunset.lights > 0, 'luzes começam a acender no pôr do sol');
  assert.ok(sunset.darkness < midnight.darkness);

  // horas fora do intervalo são normalizadas
  assert.deepEqual(computeSky(36), computeSky(12));
  assert.deepEqual(computeSky(-6), computeSky(18));
});

test('createDayCycle: hora inicial, duração e congelamento via URL', () => {
  const padrao = createDayCycle('');
  assert.equal(padrao.startHour, 17.5);
  assert.equal(padrao.daySeconds, 480);
  assert.equal(padrao.hourAt(0), 17.5);
  assert.equal(padrao.hourAt(480), 17.5); // um dia completo depois
  assert.equal(padrao.hourAt(120), 23.5); // 1/4 do dia = +6h

  const noite = createDayCycle('?hora=22&dia=240');
  assert.equal(noite.hourAt(0), 22);
  assert.equal(noite.hourAt(60), 4); // +6h com dia de 240s

  const congelado = createDayCycle('?hora=3&ciclo=0');
  assert.equal(congelado.hourAt(9999), 3);
  assert.ok(congelado.sample(9999).lights === 1);
});
