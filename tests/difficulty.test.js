import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIFFICULTIES, DIFFICULTY_ORDER, getDifficulty, loadDifficultyId, saveDifficultyId, policeCarsFor } from '../src/core/difficulty.js';
import { createWanted, reportCrime, tickWanted } from '../src/core/police.js';

const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test('tem Fácil, Normal e Difícil, com Normal como padrão', () => {
  assert.deepEqual(DIFFICULTY_ORDER, ['facil', 'normal', 'dificil']);
  assert.equal(getDifficulty('xyz').id, 'normal');
  assert.equal(loadDifficultyId(memoria()), 'normal');
});

test('salva e carrega a escolha', () => {
  const s = memoria();
  saveDifficultyId('dificil', s);
  assert.equal(loadDifficultyId(s), 'dificil');
  saveDifficultyId('inexistente', s);
  assert.equal(loadDifficultyId(s), 'dificil');
});

test('fácil é mais gentil e difícil mais duro', () => {
  const { facil, normal, dificil } = DIFFICULTIES;
  assert.ok(facil.damageTaken < normal.damageTaken && normal.damageTaken < dificil.damageTaken);
  assert.ok(facil.shootFromStars > normal.shootFromStars && normal.shootFromStars > dificil.shootFromStars);
  assert.ok(facil.bustPenalty < dificil.bustPenalty);
  assert.ok(dificil.moneyMult > normal.moneyMult);
});

test('limite de viaturas por dificuldade', () => {
  assert.equal(policeCarsFor(4, 5, DIFFICULTIES.facil), 2);
  assert.equal(policeCarsFor(4, 5, DIFFICULTIES.normal), 4);
  assert.equal(policeCarsFor(4, 5, DIFFICULTIES.dificil), 5);
  assert.equal(policeCarsFor(1, 1, DIFFICULTIES.dificil), 1);
  assert.equal(policeCarsFor(0, 0, DIFFICULTIES.dificil), 0);
});

test('fuga mais rápida no fácil', () => {
  const fugir = (mult) => {
    const w = createWanted();
    reportCrime(w, 'shot');
    let t = 0;
    while (tickWanted(w, 0.1, false, mult) !== 'escaped') t += 0.1;
    return t;
  };
  assert.ok(fugir(DIFFICULTIES.facil.escapeMult) < fugir(DIFFICULTIES.dificil.escapeMult));
});
