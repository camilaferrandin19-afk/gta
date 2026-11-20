import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMoney, collectibleReward, COMBO_WINDOW, createWallet, formatMoney, missionReward, multiplierFor, spend, tickCombo,
} from '../src/core/economy.js';

const run = (w, seconds, s, dt = 0.05) => {
  const all = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) all.push(...tickCombo(w, dt, s));
  return all;
};

test('drift acumula, vira manobra e deposita com multiplicador', () => {
  const w = createWallet(0);
  run(w, 2, { drifting: true, driftIntensity: 1, speed: 300 });
  assert.ok(w.pending > 100, `acumulou ${w.pending}`);
  const ev1 = run(w, 0.1, { drifting: false, speed: 300 });
  assert.ok(ev1.some((e) => e.type === 'stunt' && e.label === 'DRIFT'));
  const pending = w.pending;
  const ev2 = run(w, COMBO_WINDOW + 0.2, { drifting: false, speed: 100 });
  const bank = ev2.find((e) => e.type === 'bank');
  assert.ok(bank, 'depositou');
  assert.equal(bank.mult, 1);
  assert.equal(w.money, Math.round(pending));
  assert.equal(w.pending, 0);
});

test('quase-batidas em sequência sobem o multiplicador', () => {
  const w = createWallet(0);
  for (let i = 0; i < 4; i++) tickCombo(w, 0.1, { nearMisses: 1, speed: 300 });
  assert.equal(w.chain, 4);
  assert.equal(multiplierFor(w.chain), 3);
  run(w, COMBO_WINDOW + 0.2, { speed: 300 });
  assert.equal(w.money, 60 * 4 * 3);
  assert.equal(multiplierFor(100), 5, 'multiplicador tem teto');
});

test('bater o carro perde o combo pendente', () => {
  const w = createWallet(100);
  tickCombo(w, 0.1, { nearMisses: 2, speed: 300 });
  const ev = tickCombo(w, 0.1, { crashed: true });
  assert.equal(ev[0].type, 'lost');
  assert.equal(w.pending, 0);
  assert.equal(w.money, 100, 'o saldo já depositado não muda');
});

test('gastar, recompensas e formatação', () => {
  const w = createWallet(500);
  assert.equal(spend(w, 600), false);
  assert.equal(spend(w, 400), true);
  assert.equal(w.money, 100);
  addMoney(w, 1234);
  assert.equal(formatMoney(w.money), 'R$ 1.334');
  assert.equal(formatMoney(1234567), 'R$ 1.234.567');
  assert.equal(missionReward(0), 500);
  assert.equal(missionReward(2), 1000);
  assert.equal(collectibleReward('lendario'), 400);
  assert.equal(collectibleReward('xyz'), 50);
});
