// Iluminação dinâmica: ciclo dia/noite e texturas de luz.
//
// Parâmetros opcionais na URL (úteis para testar):
//   ?hora=21      → começa às 21h (0–24, aceita decimais)
//   ?ciclo=0      → congela o relógio na hora inicial
//   ?dia=300      → duração de um dia completo, em segundos (padrão 480 = 8 min)

const HORA_PADRAO = 17.5;
const DIA_PADRAO_SEG = 480;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Converte a hora do dia (0–24) no estado do céu.
 * - sun: altura do sol (1 ao meio-dia, -1 à meia-noite)
 * - darkness: opacidade do véu noturno (0 de dia … ~0.72 de madrugada)
 * - lights: intensidade das luzes artificiais (0 de dia … 1 à noite)
 * - golden: tom dourado do nascer/pôr do sol (0 … 1)
 */
export function computeSky(hour) {
  const h = ((hour % 24) + 24) % 24;
  const sun = Math.sin(((h - 6) / 24) * Math.PI * 2);
  const darkness = clamp01((0.12 - sun) / 0.62) * 0.72;
  const lights = clamp01((0.22 - sun) / 0.32);
  const golden = clamp01(1 - Math.abs(sun - 0.05) / 0.32);
  return { hour: h, sun, darkness, lights, golden };
}

export function createDayCycle(search = (typeof window !== 'undefined' ? window.location.search : '')) {
  const params = new URLSearchParams(search || '');
  const horaParam = Number.parseFloat(params.get('hora'));
  const diaParam = Number.parseFloat(params.get('dia'));
  const startHour = Number.isFinite(horaParam) ? horaParam : HORA_PADRAO;
  const daySeconds = Number.isFinite(diaParam) && diaParam > 10 ? diaParam : DIA_PADRAO_SEG;
  const frozen = params.get('ciclo') === '0';

  return {
    startHour,
    daySeconds,
    frozen,
    hourAt(time) {
      const t = frozen ? 0 : Math.max(0, time || 0);
      return (startHour + (t / daySeconds) * 24) % 24;
    },
    sample(time) {
      return computeSky(this.hourAt(time));
    },
  };
}

export function createLightAtlas() {
  const tile = 128;
  const canvas = document.createElement('canvas');
  canvas.width = tile * 4;
  canvas.height = tile;
  const ctx = canvas.getContext('2d');
  const uvs = {};
  const register = (name, col, drawFn) => {
    const x = col * tile;
    drawFn(ctx, x, 0, tile);
    const pad = 1.5 / canvas.width;
    uvs[name] = {
      u0: x / canvas.width + pad,
      v0: 1.5 / tile,
      u1: (x + tile) / canvas.width - pad,
      v1: 1 - 1.5 / tile,
    };
  };

  register('solid', 0, (c, x, y, s) => {
    c.fillStyle = '#ffffff';
    c.fillRect(x, y, s, s);
  });

  // Brilho radial com queda suave (luz de poste, porta, fogo)
  register('glow', 1, (c, x, y, s) => {
    const cx = x + s / 2;
    const cy = y + s / 2;
    const grad = c.createRadialGradient(cx, cy, 0, cx, cy, s * 0.5);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.28)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.07)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = grad;
    c.fillRect(x, y, s, s);
  });

  // Facho de farol: cone que abre para a direita (+x) e esmaece na ponta
  register('beam', 2, (c, x, y, s) => {
    c.save();
    c.beginPath();
    c.moveTo(x + 2, y + s * 0.42);
    c.lineTo(x + s, y + 2);
    c.lineTo(x + s, y + s - 2);
    c.lineTo(x + 2, y + s * 0.58);
    c.closePath();
    c.clip();
    const lin = c.createLinearGradient(x, 0, x + s, 0);
    lin.addColorStop(0, 'rgba(255,255,255,0.95)');
    lin.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    lin.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = lin;
    c.fillRect(x, y, s, s);
    c.restore();
    // suaviza as bordas laterais do cone
    c.globalCompositeOperation = 'destination-out';
    const side = c.createLinearGradient(0, y, 0, y + s);
    side.addColorStop(0, 'rgba(0,0,0,1)');
    side.addColorStop(0.22, 'rgba(0,0,0,0)');
    side.addColorStop(0.78, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = side;
    c.fillRect(x, y, s, s);
    c.globalCompositeOperation = 'source-over';
  });

  // Vinheta: centro transparente, bordas escuras
  register('vignette', 3, (c, x, y, s) => {
    const cx = x + s / 2;
    const cy = y + s / 2;
    const grad = c.createRadialGradient(cx, cy, s * 0.28, cx, cy, s * 0.72);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = grad;
    c.fillRect(x, y, s, s);
  });

  return { canvas, uvs };
}
