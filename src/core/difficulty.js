// Níveis de dificuldade: ajustam dano recebido, polícia e dinheiro.

export const DIFFICULTIES = {
  facil: {
    id: 'facil',
    label: 'Fácil',
    desc: 'Menos dano, polícia mais calma, fuga rápida.',
    damageTaken: 0.5, // multiplica o dano que a protagonista e o carro dela recebem
    crimeMult: 0.6, // quanto cada crime sobe as estrelas
    escapeMult: 0.6, // tempo para perder uma estrela
    extraPolice: 0,
    maxPolice: 2,
    shootFromStars: 4, // a polícia atira a partir de N estrelas
    policeSpread: 0.45, // mira da polícia (radianos de erro)
    bustPenalty: 0.05, // % do dinheiro que perde ao ser presa
    moneyMult: 1,
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    desc: 'O jogo como foi pensado.',
    damageTaken: 1,
    crimeMult: 1,
    escapeMult: 1,
    extraPolice: 0,
    maxPolice: 4,
    shootFromStars: 3,
    policeSpread: 0.22,
    bustPenalty: 0.1,
    moneyMult: 1,
  },
  dificil: {
    id: 'dificil',
    label: 'Difícil',
    desc: 'Mais dano e polícia agressiva — mas ganha 50% a mais de dinheiro.',
    damageTaken: 1.5,
    crimeMult: 1.4,
    escapeMult: 1.5,
    extraPolice: 1,
    maxPolice: 5,
    shootFromStars: 2,
    policeSpread: 0.12,
    bustPenalty: 0.2,
    moneyMult: 1.5,
  },
};

export const DIFFICULTY_ORDER = ['facil', 'normal', 'dificil'];
const STORAGE_KEY = 'gta-dificuldade';

export function getDifficulty(id) {
  return DIFFICULTIES[id] || DIFFICULTIES.normal;
}

export function loadDifficultyId(storage = globalThis.localStorage) {
  try {
    const id = storage?.getItem(STORAGE_KEY);
    return DIFFICULTIES[id] ? id : 'normal';
  } catch {
    return 'normal';
  }
}

export function saveDifficultyId(id, storage = globalThis.localStorage) {
  if (!DIFFICULTIES[id]) return;
  try {
    storage?.setItem(STORAGE_KEY, id);
  } catch {
    /* sem storage */
  }
}

/** Quantas viaturas perseguem, já ajustado pela dificuldade. */
export function policeCarsFor(baseCount, level, diff) {
  if (level <= 0) return 0;
  return Math.min(diff.maxPolice, baseCount + (level >= 2 ? diff.extraPolice : 0));
}
