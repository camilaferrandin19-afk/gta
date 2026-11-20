import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWanted, createWanted, desiredPoliceCars, driveToward, escapeTime, gridRoute, policeShoots, reportCrime, stars, tickWanted,
} from '../src/core/police.js';

test('primeiro tiro dá 1 estrela; crimes acumulam até 5', () => {
  const w = createWanted();
  assert.equal(stars(w), 0);
  reportCrime(w, 'shot');
  assert.equal(stars(w), 1);
  reportCrime(w, 'police-down');
  assert.equal(stars(w), 2);
  for (let i = 0; i < 10; i++) reportCrime(w, 'police-down');
  assert.equal(stars(w), 5);
  clearWanted(w);
  assert.equal(stars(w), 0);
});

test('fora da vista perde estrelas uma a uma até escapar', () => {
  const w = createWanted();
  reportCrime(w, 'shot', 1); // 2 estrelas
  assert.equal(stars(w), 2);
  let ev = null;
  for (let t = 0; t < escapeTime(2) + 0.1; t += 0.1) ev = tickWanted(w, 0.1, false) || ev;
  assert.equal(ev, 'lost-star');
  assert.equal(stars(w), 1);
  assert.equal(w.flash, true);
  ev = null;
  for (let t = 0; t < escapeTime(1) + 0.1; t += 0.1) ev = tickWanted(w, 0.1, false) || ev;
  assert.equal(ev, 'escaped');
  assert.equal(stars(w), 0);
});

test('ser visto zera a contagem de fuga', () => {
  const w = createWanted();
  reportCrime(w, 'shot');
  for (let t = 0; t < 5; t += 0.1) tickWanted(w, 0.1, false);
  tickWanted(w, 0.1, true);
  assert.equal(w.unseen, 0);
  assert.equal(stars(w), 1);
});

test('mais estrelas, mais viaturas; tiros a partir de 3', () => {
  assert.equal(desiredPoliceCars(0), 0);
  assert.equal(desiredPoliceCars(1), 1);
  assert.equal(desiredPoliceCars(5), 4);
  assert.equal(policeShoots(2), false);
  assert.equal(policeShoots(3), true);
});

test('rota em L pela grade de ruas', () => {
  const pf = {
    nearestNode: (x, y) => ({ ix: Math.round(x / 100), iy: Math.round(y / 100) }),
    nodeToWorld: (ix, iy) => ({ x: ix * 100, y: iy * 100 }),
  };
  const route = gridRoute(pf, { x: 0, y: 0 }, { x: 510, y: 205 });
  assert.deepEqual(route[route.length - 1], { x: 510, y: 205 });
  // todos os trechos intermediários são retos (horizontais ou verticais)
  for (let i = 0; i < route.length - 2; i++) {
    const a = route[i];
    const b = route[i + 1];
    assert.ok(a.x === b.x || a.y === b.y, `trecho ${i} reto`);
  }
});

test('direção: vira para o alvo e freia em curva fechada', () => {
  const car = { x: 0, y: 0, angle: 0, speed: 100 };
  const left = driveToward(car, { x: 0, y: -100 });
  assert.ok(left.moveX < 0, 'alvo acima → vira à esquerda');
  const fastCar = { x: 0, y: 0, angle: 0, speed: 400 };
  const turn = driveToward(fastCar, { x: 10, y: 100 });
  assert.equal(turn.secondaryPressed, true, 'freia antes da curva');
  const straight = driveToward({ x: 0, y: 0, angle: 0, speed: 100 }, { x: 500, y: 0 });
  assert.equal(straight.actionPressed, true);
});
