// Dinheiro, combos de manobras e catálogo das lojas (sem DOM; testável).
//
// Combo: cada manobra (drift longo ou "quase batida") aumenta a corrente.
// O multiplicador sobe com a corrente (x1 → x5). Se ficar 3,5 s sem manobra,
// o valor acumulado é depositado (valor × multiplicador). Bater o carro perde tudo.

export const COMBO_WINDOW = 3.5;
export const MAX_MULT = 5;
const DRIFT_MIN_SECONDS = 0.6;
const DRIFT_RATE = 70;      // R$ por segundo de drift a ~300 de velocidade
const NEAR_MISS_VALUE = 60;

export const REWARDS = {
  missionBase: 500,
  missionStep: 250,
  collectible: { normal: 50, especial: 150, lendario: 400 },
  cheat: 5000,
};

export function createWallet(money = 0) {
  return {
    money: Math.max(0, Math.round(money)),
    chain: 0,
    pending: 0,
    timer: 0,
    driftTime: 0,
    lastStunt: '',
  };
}

export function multiplierFor(chain) {
  return Math.min(MAX_MULT, 1 + Math.floor(chain / 2));
}

export function addMoney(wallet, amount) {
  const v = Math.round(amount);
  wallet.money = Math.max(0, wallet.money + v);
  return v;
}

export function spend(wallet, price) {
  if (wallet.money < price) return false;
  wallet.money -= price;
  return true;
}

export function comboActive(wallet) {
  return wallet.pending > 0 && (wallet.timer > 0 || wallet.driftTime > 0);
}

/**
 * Avança o combo.
 * s = { drifting, driftIntensity, speed, crashed, nearMisses }
 * Retorna eventos: { type: 'stunt'|'bank'|'lost', amount?, mult?, label? }
 */
export function tickCombo(wallet, dt, s = {}) {
  const events = [];

  if (s.crashed && wallet.pending > 0) {
    events.push({ type: 'lost', amount: Math.round(wallet.pending) });
    wallet.pending = 0;
    wallet.chain = 0;
    wallet.timer = 0;
    wallet.driftTime = 0;
    return events;
  }

  const drifting = Boolean(s.drifting) && (s.speed || 0) > 140;
  if (drifting) {
    wallet.driftTime += dt;
    wallet.pending += dt * DRIFT_RATE * Math.max(0.3, s.driftIntensity || 0.5) * Math.min(1.8, (s.speed || 0) / 300);
    wallet.timer = COMBO_WINDOW;
    wallet.lastStunt = 'DRIFT';
  } else if (wallet.driftTime > 0) {
    if (wallet.driftTime >= DRIFT_MIN_SECONDS) {
      wallet.chain += 1;
      events.push({ type: 'stunt', label: 'DRIFT', mult: multiplierFor(wallet.chain) });
    }
    wallet.driftTime = 0;
  }

  for (let i = 0; i < (s.nearMisses || 0); i++) {
    wallet.pending += NEAR_MISS_VALUE;
    wallet.chain += 1;
    wallet.timer = COMBO_WINDOW;
    wallet.lastStunt = 'QUASE BATIDA';
    events.push({ type: 'stunt', label: 'QUASE BATIDA', mult: multiplierFor(wallet.chain) });
  }

  if (!drifting && wallet.timer > 0) {
    wallet.timer = Math.max(0, wallet.timer - dt);
    if (wallet.timer === 0 && wallet.pending > 0) {
      const mult = multiplierFor(wallet.chain);
      const amount = Math.round(wallet.pending * mult);
      wallet.money += amount;
      events.push({ type: 'bank', amount, mult });
      wallet.pending = 0;
      wallet.chain = 0;
    }
  }
  return events;
}

export function missionReward(missionIndex) {
  return REWARDS.missionBase + REWARDS.missionStep * Math.max(0, missionIndex);
}

export function collectibleReward(rarity) {
  return REWARDS.collectible[rarity] ?? REWARDS.collectible.normal;
}

/** Itens da loja de armas (a pé). */
export const GUN_SHOP = [
  { id: 'pistola', kind: 'weapon', name: 'Pistola', desc: 'Leve e precisa. Vem com 48 balas.', price: 400, ammo: 48 },
  { id: 'submetralhadora', kind: 'weapon', name: 'Submetralhadora', desc: 'Automática. Vem com 120 balas.', price: 1200, ammo: 120 },
  { id: 'escopeta', kind: 'weapon', name: 'Escopeta', desc: 'Tiro espalhado. Vem com 18 cartuchos.', price: 1600, ammo: 18 },
  { id: 'municao-pistola', kind: 'ammo', weapon: 'pistola', name: 'Munição de pistola', desc: '+36 balas', price: 80, ammo: 36 },
  { id: 'municao-sub', kind: 'ammo', weapon: 'submetralhadora', name: 'Munição de submetralhadora', desc: '+90 balas', price: 150, ammo: 90 },
  { id: 'municao-escopeta', kind: 'ammo', weapon: 'escopeta', name: 'Cartuchos', desc: '+12 cartuchos', price: 160, ammo: 12 },
  { id: 'kit-medico', kind: 'heal', name: 'Kit médico', desc: 'Vida cheia', price: 150 },
];

/** Serviços da oficina (dentro de um veículo). */
export const GARAGE_SHOP = [
  { id: 'conserto', kind: 'repair', name: 'Conserto completo', desc: 'Lataria e motor novos', price: 200 },
  { id: 'pintura', kind: 'paint', name: 'Pintura nova', desc: 'Troca a cor — e despista a polícia!', price: 250 },
  { id: 'neon', kind: 'neon', name: 'Neon por baixo', desc: 'Brilho rosa embaixo do carro', price: 800 },
  { id: 'turbo', kind: 'turbo', name: 'Turbo', desc: 'Mais velocidade e arrancada', price: 1500 },
];

export const PAINT_COLORS = ['#e63946', '#3a86ff', '#ffbe0b', '#06d6a0', '#8338ec', '#ff006e', '#111827', '#f8f9fa', '#fb5607'];

/** Formata em reais: 1234 → "R$ 1.234". */
export function formatMoney(value) {
  const n = Math.max(0, Math.round(value || 0));
  return `R$ ${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
