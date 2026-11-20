// Códigos secretos digitados durante o jogo (estilo GTA).
// Não usam I, M, P (abrem telas), F (entra/sai do carro), E, Q, X, Z nem K (atira).
// G (troca arma) e R (recarrega) podem aparecer: são inofensivos durante a digitação.

export const CHEAT_CODES = [
  { code: 'ANALAURA', id: 'special-car', label: 'Carro especial da Ana Laura!' },
  { code: 'TURBO', id: 'turbo', label: 'Turbo no veículo!' },
  { code: 'CURA', id: 'heal', label: 'Vida cheia e carro consertado!' },
  { code: 'BANGBANG', id: 'weapons', label: 'Todas as armas!' },
  { code: 'AJUDA', id: 'partner', label: 'A Camila está a caminho!' },
  { code: 'LUAR', id: 'night', label: 'Boa noite, cidade!' },
  { code: 'SOLAR', id: 'day', label: 'Bom dia, cidade!' },
];

const MAX_BUFFER = 16;

export function createCheatBuffer(codes = CHEAT_CODES) {
  let buffer = '';
  return {
    /** Recebe uma tecla (e.key). Retorna o código ativado ou null. */
    push(key) {
      if (typeof key !== 'string' || key.length !== 1) return null;
      const ch = key.toUpperCase();
      if (ch < 'A' || ch > 'Z') return null;
      buffer = (buffer + ch).slice(-MAX_BUFFER);
      for (const c of codes) {
        if (buffer.endsWith(c.code)) {
          buffer = '';
          return c;
        }
      }
      return null;
    },
    reset() {
      buffer = '';
    },
    get value() {
      return buffer;
    },
  };
}

/** Perfil do carro especial: mais rápido, arranca mais e segura melhor nas curvas. */
export const SPECIAL_CAR_PROFILE = {
  maxSpeed: 640,
  reverseMax: 200,
  accel: 760,
  brake: 900,
  turnRate: 3.6,
  lateralGrip: 10.5,
  driftGrip: 5.2,
  length: 46,
  width: 24,
  radius: 17,
};

export function turboProfile(base) {
  return {
    ...base,
    maxSpeed: Math.round(base.maxSpeed * 1.45),
    accel: Math.round(base.accel * 1.6),
    brake: Math.round(base.brake * 1.2),
  };
}
