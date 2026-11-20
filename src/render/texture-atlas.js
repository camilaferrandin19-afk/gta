function drawGrain(ctx, x, y, size, baseColor, count, alphaLight, alphaDark) {
  ctx.fillStyle = baseColor;
  ctx.fillRect(x, y, size, size);
  for (let i = 0; i < count; i++) {
    const px = x + ((i * 97 + 13) % size);
    const py = y + ((i * 151 + 29) % size);
    const s = (i % 3 === 0) ? 2 : 1;
    ctx.fillStyle = i % 2 === 0
      ? `rgba(255,255,255,${alphaLight})`
      : `rgba(0,0,0,${alphaDark})`;
    ctx.fillRect(px, py, s, s);
  }
}

export function createTextureAtlas() {
  const size = 1024;
  const tile = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const uvs = {};
  const register = (name, col, row, drawFn) => {
    const x = col * tile;
    const y = row * tile;
    drawFn(ctx, x, y, tile);
    const pad = 1.5 / size;
    uvs[name] = {
      u0: x / size + pad,
      v0: y / size + pad,
      u1: (x + tile) / size - pad,
      v1: (y + tile) / size - pad
    };
  };

  register('solid', 0, 0, (c, x, y, s) => {
    c.fillStyle = '#ffffff';
    c.fillRect(x, y, s, s);
  });

  register('asphalt', 1, 0, (c, x, y, s) => {
    drawGrain(c, x, y, s, '#2b2f38', 650, 0.05, 0.14);
    c.strokeStyle = 'rgba(0,0,0,0.18)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x + 18, y + 36);
    c.lineTo(x + 54, y + 48);
    c.lineTo(x + 76, y + 42);
    c.moveTo(x + 82, y + 92);
    c.lineTo(x + 114, y + 104);
    c.stroke();
  });

  register('sidewalk', 2, 0, (c, x, y, s) => {
    drawGrain(c, x, y, s, '#9aa1ad', 420, 0.08, 0.08);
    c.strokeStyle = 'rgba(40,46,58,0.28)';
    c.lineWidth = 2;
    for (let i = 0; i <= s; i += 32) {
      c.beginPath();
      c.moveTo(x + i, y);
      c.lineTo(x + i, y + s);
      c.stroke();
      c.beginPath();
      c.moveTo(x, y + i);
      c.lineTo(x + s, y + i);
      c.stroke();
    }
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 2;
    c.strokeRect(x + 2, y + 2, s - 4, s - 4);
  });

  register('grass', 3, 0, (c, x, y, s) => {
    drawGrain(c, x, y, s, '#367544', 520, 0.08, 0.12);
    for (let i = 0; i < 40; i++) {
      const gx = x + ((i * 53 + 7) % (s - 8));
      const gy = y + ((i * 89 + 11) % (s - 8));
      c.fillStyle = i % 3 === 0 ? '#4d945b' : '#2a5e36';
      c.fillRect(gx, gy, 4, 3);
    }
    c.fillStyle = '#fde68a';
    c.fillRect(x + 24, y + 38, 3, 3);
    c.fillRect(x + 92, y + 84, 3, 3);
  });

  register('water', 4, 0, (c, x, y, s) => {
    drawGrain(c, x, y, s, '#2186b5', 260, 0.09, 0.07);
    c.strokeStyle = 'rgba(186, 230, 253, 0.45)';
    c.lineWidth = 2;
    for (let wy = 18; wy < s; wy += 26) {
      c.beginPath();
      c.moveTo(x + 12, y + wy);
      c.quadraticCurveTo(x + s * 0.5, y + wy - 6, x + s - 12, y + wy);
      c.stroke();
    }
  });

  register('roof', 5, 0, (c, x, y, s) => {
    drawGrain(c, x, y, s, '#d1d5db', 360, 0.07, 0.08);
    c.strokeStyle = 'rgba(0,0,0,0.22)';
    c.lineWidth = 2;
    for (let gy = 16; gy < s; gy += 16) {
      c.beginPath();
      c.moveTo(x, y + gy);
      c.lineTo(x + s, y + gy);
      c.stroke();
    }
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 4;
    c.strokeRect(x + 2, y + 2, s - 4, s - 4);
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.fillRect(x + 18, y + 18, 28, 20);
  });

  register('floor', 6, 0, (c, x, y, s) => {
    drawGrain(c, x, y, s, '#dfd3be', 280, 0.06, 0.06);
    c.strokeStyle = 'rgba(100,78,52,0.22)';
    c.lineWidth = 2;
    for (let i = 0; i <= s; i += 32) {
      c.beginPath();
      c.moveTo(x, y + i);
      c.lineTo(x + s, y + i);
      c.stroke();
      c.beginPath();
      c.moveTo(x + i, y);
      c.lineTo(x + i, y + s);
      c.stroke();
    }
  });

  register('doormat', 7, 0, (c, x, y, s) => {
    c.fillStyle = 'rgba(26, 30, 38, 0.88)';
    c.fillRect(x + 6, y + 12, s - 12, s - 24);
    c.fillStyle = 'rgba(198, 174, 132, 0.92)';
    c.fillRect(x + 14, y + 22, s - 28, s - 44);
    c.strokeStyle = 'rgba(68, 56, 38, 0.65)';
    c.lineWidth = 4;
    c.strokeRect(x + 20, y + 28, s - 40, s - 56);
  });

  register('car', 0, 1, (c, x, y, s) => {
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(x + 10, y + 20, s - 16, s - 34);
    c.fillStyle = '#111827';
    c.fillRect(x + 18, y + 12, 20, 10);
    c.fillRect(x + s - 38, y + 12, 20, 10);
    c.fillRect(x + 18, y + s - 22, 20, 10);
    c.fillRect(x + s - 38, y + s - 22, 20, 10);

    c.fillStyle = '#ffffff';
    c.fillRect(x + 10, y + 18, s - 20, s - 36);
    c.fillStyle = '#1e293b';
    c.fillRect(x + 34, y + 26, s - 64, s - 52);
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.fillRect(x + 42, y + 30, s - 82, s - 60);
    c.fillStyle = '#fef08a';
    c.fillRect(x + s - 14, y + 24, 6, 14);
    c.fillRect(x + s - 14, y + s - 38, 6, 14);
    c.fillStyle = '#ef4444';
    c.fillRect(x + 8, y + 24, 5, 14);
    c.fillRect(x + 8, y + s - 38, 5, 14);
  });

  register('moto', 1, 1, (c, x, y, s) => {
    c.fillStyle = '#111827';
    c.fillRect(x + 12, y + 48, 28, 32);
    c.fillRect(x + s - 40, y + 48, 28, 32);
    c.fillStyle = '#ffffff';
    c.fillRect(x + 30, y + 38, s - 60, s - 76);
    c.fillStyle = '#1f2937';
    c.fillRect(x + 44, y + 44, 30, s - 88);
    c.fillStyle = '#fef08a';
    c.fillRect(x + s - 16, y + 54, 6, 20);
  });

  register('van', 2, 1, (c, x, y, s) => {
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(x + 8, y + 14, s - 12, s - 22);
    c.fillStyle = '#ffffff';
    c.fillRect(x + 8, y + 12, s - 16, s - 24);
    c.fillStyle = '#1e293b';
    c.fillRect(x + s - 38, y + 22, 20, s - 44);
    c.fillStyle = 'rgba(0,0,0,0.14)';
    c.fillRect(x + 16, y + 22, s - 62, s - 44);
    c.fillStyle = '#fef08a';
    c.fillRect(x + s - 12, y + 18, 5, 16);
    c.fillRect(x + s - 12, y + s - 34, 5, 16);
    c.fillStyle = '#ef4444';
    c.fillRect(x + 7, y + 18, 4, 16);
    c.fillRect(x + 7, y + s - 34, 4, 16);
  });

  register('player', 3, 1, (c, x, y, s) => {
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.arc(x + s / 2 + 4, y + s / 2 + 4, 42, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1f2937';
    c.beginPath();
    c.arc(x + s / 2, y + s / 2, 40, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#f59e0b';
    c.beginPath();
    c.arc(x + s / 2 + 8, y + s / 2, 26, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fde68a';
    c.beginPath();
    c.arc(x + s / 2 + 22, y + s / 2, 13, 0, Math.PI * 2);
    c.fill();
  });

  register('circle', 4, 1, (c, x, y, s) => {
    const cx = x + s / 2;
    const cy = y + s / 2;
    const r = s * 0.48;
    const grad = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.55, 'rgba(255, 255, 255, 0.72)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    c.fillStyle = grad;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
  });

  register('shockwave', 5, 1, (c, x, y, s) => {
    const cx = x + s / 2;
    const cy = y + s / 2;
    const r = s * 0.49;
    const grad = c.createRadialGradient(cx, cy, r * 0.52, cx, cy, r);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.14)');
    grad.addColorStop(0.72, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(0.84, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.95, 'rgba(255, 255, 255, 0.3)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    c.fillStyle = grad;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
  });

  register('trashbin', 6, 1, (c, x, y, s) => {
    c.fillStyle = 'rgba(0,0,0,0.34)';
    c.fillRect(x + 22, y + 24, s - 36, s - 36);
    c.fillStyle = '#334155';
    c.fillRect(x + 18, y + 18, s - 36, s - 36);
    c.strokeStyle = '#64748b';
    c.lineWidth = 6;
    c.strokeRect(x + 20, y + 20, s - 40, s - 40);
    c.fillStyle = '#15803d';
    c.fillRect(x + 28, y + 28, s - 56, s - 56);
    c.fillStyle = '#0f172a';
    c.fillRect(x + 42, y + 54, s - 84, 20);
  });

  register('disc', 7, 1, (c, x, y, s) => {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(x + s / 2, y + s / 2, s * 0.45, 0, Math.PI * 2);
    c.fill();
  });

  register('boat', 0, 2, (c, x, y, s) => {
    // Sombra na água
    c.fillStyle = 'rgba(0, 12, 24, 0.28)';
    c.beginPath();
    c.moveTo(x + s - 8, y + s * 0.5 + 3);
    c.quadraticCurveTo(x + s * 0.65, y + 20, x + 16, y + 24);
    c.lineTo(x + 16, y + s - 18);
    c.quadraticCurveTo(x + s * 0.65, y + s - 14, x + s - 8, y + s * 0.5 + 3);
    c.closePath();
    c.fill();

    // Casco principal (branco para receber tint de cor)
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(x + s - 10, y + s * 0.5);
    c.quadraticCurveTo(x + s * 0.64, y + 18, x + 16, y + 22);
    c.lineTo(x + 16, y + s - 22);
    c.quadraticCurveTo(x + s * 0.64, y + s - 18, x + s - 10, y + s * 0.5);
    c.closePath();
    c.fill();

    // Convés interno
    c.fillStyle = '#e2e8f0';
    c.beginPath();
    c.moveTo(x + s - 24, y + s * 0.5);
    c.quadraticCurveTo(x + s * 0.6, y + 28, x + 26, y + 32);
    c.lineTo(x + 26, y + s - 32);
    c.quadraticCurveTo(x + s * 0.6, y + s - 28, x + s - 24, y + s * 0.5);
    c.closePath();
    c.fill();

    // Para-brisa e cabine
    c.fillStyle = '#1e293b';
    c.fillRect(x + 56, y + 36, 20, s - 72);
    c.fillStyle = 'rgba(255, 255, 255, 0.28)';
    c.fillRect(x + 62, y + 40, 8, s - 80);

    // Motor de popa
    c.fillStyle = '#0f172a';
    c.fillRect(x + 8, y + s * 0.5 - 10, 12, 20);
  });

  // ---- Veículos detalhados (proporção real ~2:1), sobrescrevem car/van/moto ----
  // Corpo em tons claros para receber o tint da cor do veículo; frente = +x.
  const registerRect = (name, x, y, w, h, drawFn) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    drawFn(ctx, x, y, w, h);
    ctx.restore();
    const pad = 1.5 / size;
    uvs[name] = { u0: x / size + pad, v0: y / size + pad, u1: (x + w) / size - pad, v1: (y + h) / size - pad };
  };

  registerRect('car', 0, 384, 256, 128, drawCarTopDown);
  registerRect('van', 256, 384, 256, 128, drawVanTopDown);
  registerRect('moto', 512, 384, 256, 128, drawMotoTopDown);

  // Sombra suave (retângulo arredondado desfocado) para veículos e personagens
  register('softshadow', 6, 3, (c, x, y, s) => {
    c.save();
    c.shadowColor = 'rgba(0,0,0,1)';
    c.shadowBlur = 16;
    c.fillStyle = 'rgba(0,0,0,0.85)';
    roundRect(c, x + 22, y + 22, s - 44, s - 44, 22);
    c.fill();
    c.restore();
  });

  return { canvas, uvs };
}

function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr);
  c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}

function poly(c, pts) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
}

// Pintura "curva": clara no meio do teto/capô, mais escura nas laterais
function bodyGradient(c, y, h) {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#b9bec7');
  g.addColorStop(0.18, '#e9ecf0');
  g.addColorStop(0.5, '#ffffff');
  g.addColorStop(0.82, '#e3e6eb');
  g.addColorStop(1, '#aeb4be');
  return g;
}

function glassGradient(c, x0, x1) {
  const g = c.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, '#1a2433');
  g.addColorStop(1, '#3a4d66');
  return g;
}

function glassShine(c, x, y, w, h) {
  c.save();
  c.globalAlpha = 0.28;
  c.fillStyle = '#ffffff';
  poly(c, [[x + w * 0.2, y], [x + w * 0.45, y], [x + w * 0.15, y + h], [x - w * 0.1, y + h]]);
  c.fill();
  c.restore();
}

function wheel(c, x, y, w, h) {
  c.fillStyle = '#101114';
  roundRect(c, x, y, w, h, 4);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.fillRect(x + 4, y + 2, w - 8, 2);
}

function drawCarTopDown(c, x, y, W, H) {
  // Rodas aparecendo nas laterais
  wheel(c, x + 38, y + 6, 46, 14);
  wheel(c, x + 38, y + H - 20, 46, 14);
  wheel(c, x + 170, y + 6, 46, 14);
  wheel(c, x + 170, y + H - 20, 46, 14);

  // Retrovisores
  c.fillStyle = '#d4d8de';
  c.strokeStyle = '#5b6270';
  c.lineWidth = 2;
  for (const my of [y + 6, y + H - 6]) {
    c.beginPath();
    c.ellipse(x + 160, my, 8, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }

  // Carroceria
  c.fillStyle = bodyGradient(c, y + 12, H - 24);
  roundRect(c, x + 8, y + 12, W - 16, H - 24, 30);
  c.fill();
  c.strokeStyle = '#555c68';
  c.lineWidth = 2.5;
  c.stroke();

  // Para-choques
  c.fillStyle = '#8d939d';
  roundRect(c, x + W - 14, y + 30, 8, H - 60, 3);
  c.fill();
  roundRect(c, x + 6, y + 32, 7, H - 64, 3);
  c.fill();

  // Vincos do capô e porta-malas
  c.strokeStyle = 'rgba(0,0,0,0.13)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x + 186, y + 44); c.lineTo(x + 238, y + 48);
  c.moveTo(x + 186, y + H - 44); c.lineTo(x + 238, y + H - 48);
  c.moveTo(x + 20, y + 46); c.lineTo(x + 54, y + 44);
  c.moveTo(x + 20, y + H - 46); c.lineTo(x + 54, y + H - 44);
  c.stroke();

  // Para-brisa (inclinado)
  c.fillStyle = glassGradient(c, x + 150, x + 186);
  poly(c, [[x + 150, y + 22], [x + 184, y + 32], [x + 184, y + H - 32], [x + 150, y + H - 22]]);
  c.fill();
  glassShine(c, x + 156, y + 26, 22, H - 52);

  // Vidro traseiro
  c.fillStyle = glassGradient(c, x + 78, x + 56);
  poly(c, [[x + 56, y + 32], [x + 80, y + 24], [x + 80, y + H - 24], [x + 56, y + H - 32]]);
  c.fill();

  // Teto
  const roof = c.createLinearGradient(0, y + 24, 0, y + H - 24);
  roof.addColorStop(0, '#dfe3e8');
  roof.addColorStop(0.5, '#ffffff');
  roof.addColorStop(1, '#d6dae0');
  c.fillStyle = roof;
  roundRect(c, x + 80, y + 24, 70, H - 48, 12);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.18)';
  c.lineWidth = 1.5;
  c.stroke();

  // Vidros laterais e colunas
  c.fillStyle = 'rgba(20,28,40,0.85)';
  c.fillRect(x + 84, y + 15, 62, 8);
  c.fillRect(x + 84, y + H - 23, 62, 8);
  c.fillStyle = '#c9ced5';
  c.fillRect(x + 113, y + 15, 4, 8);
  c.fillRect(x + 113, y + H - 23, 4, 8);

  // Frisos das portas
  c.strokeStyle = 'rgba(0,0,0,0.22)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x + 115, y + 12); c.lineTo(x + 115, y + 15);
  c.moveTo(x + 115, y + H - 12); c.lineTo(x + 115, y + H - 15);
  c.moveTo(x + 84, y + 12); c.lineTo(x + 84, y + 15);
  c.moveTo(x + 146, y + 12); c.lineTo(x + 146, y + 15);
  c.stroke();

  // Faróis e lanternas
  c.fillStyle = '#fff6cf';
  roundRect(c, x + W - 22, y + 18, 10, 20, 4); c.fill();
  roundRect(c, x + W - 22, y + H - 38, 10, 20, 4); c.fill();
  c.fillStyle = '#e0241b';
  roundRect(c, x + 12, y + 20, 8, 18, 3); c.fill();
  roundRect(c, x + 12, y + H - 38, 8, 18, 3); c.fill();
}

function drawVanTopDown(c, x, y, W, H) {
  wheel(c, x + 30, y + 4, 46, 14);
  wheel(c, x + 30, y + H - 18, 46, 14);
  wheel(c, x + 182, y + 4, 46, 14);
  wheel(c, x + 182, y + H - 18, 46, 14);

  c.fillStyle = '#d4d8de';
  c.strokeStyle = '#5b6270';
  c.lineWidth = 2;
  for (const my of [y + 6, y + H - 6]) {
    c.beginPath();
    c.ellipse(x + 204, my, 8, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }

  c.fillStyle = bodyGradient(c, y + 10, H - 20);
  roundRect(c, x + 6, y + 10, W - 12, H - 20, 14);
  c.fill();
  c.strokeStyle = '#555c68';
  c.lineWidth = 2.5;
  c.stroke();

  // Capô curto
  c.fillStyle = 'rgba(0,0,0,0.06)';
  roundRect(c, x + 222, y + 16, 26, H - 32, 10);
  c.fill();

  // Para-brisa
  c.fillStyle = glassGradient(c, x + 200, x + 224);
  poly(c, [[x + 200, y + 16], [x + 224, y + 24], [x + 224, y + H - 24], [x + 200, y + H - 16]]);
  c.fill();
  glassShine(c, x + 204, y + 20, 16, H - 40);

  // Baú de carga com nervuras
  const roof = c.createLinearGradient(0, y + 14, 0, y + H - 14);
  roof.addColorStop(0, '#e2e5ea');
  roof.addColorStop(0.5, '#ffffff');
  roof.addColorStop(1, '#d9dde3');
  c.fillStyle = roof;
  roundRect(c, x + 12, y + 14, 186, H - 28, 8);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.12)';
  c.lineWidth = 2;
  c.beginPath();
  for (let rx = x + 30; rx < x + 196; rx += 22) {
    c.moveTo(rx, y + 18);
    c.lineTo(rx, y + H - 18);
  }
  c.stroke();
  c.fillStyle = 'rgba(0,0,0,0.18)';
  roundRect(c, x + 100, y + H / 2 - 9, 18, 18, 3);
  c.fill();

  c.fillStyle = '#8d939d';
  roundRect(c, x + W - 12, y + 26, 7, H - 52, 3); c.fill();
  roundRect(c, x + 4, y + 26, 6, H - 52, 3); c.fill();

  c.fillStyle = '#fff6cf';
  roundRect(c, x + W - 20, y + 14, 9, 20, 4); c.fill();
  roundRect(c, x + W - 20, y + H - 34, 9, 20, 4); c.fill();
  c.fillStyle = '#e0241b';
  roundRect(c, x + 8, y + 14, 7, 20, 3); c.fill();
  roundRect(c, x + 8, y + H - 34, 7, 20, 3); c.fill();
}

function drawMotoTopDown(c, x, y, W, H) {
  const cy = y + H / 2;
  // Pneus
  c.fillStyle = '#101114';
  roundRect(c, x + 186, cy - 12, 64, 24, 12); c.fill();
  roundRect(c, x + 6, cy - 14, 70, 28, 14); c.fill();

  // Escapamento
  c.strokeStyle = '#c3c8cf';
  c.lineWidth = 7;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x + 40, cy + 26); c.lineTo(x + 130, cy + 22);
  c.stroke();

  // Garfo e guidão
  c.strokeStyle = '#2a2d33';
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(x + 176, cy - 50); c.lineTo(x + 170, cy); c.lineTo(x + 176, cy + 50);
  c.stroke();
  c.fillStyle = '#18191c';
  roundRect(c, x + 168, cy - 58, 14, 14, 4); c.fill();
  roundRect(c, x + 168, cy + 44, 14, 14, 4); c.fill();

  // Carenagem / tanque
  c.fillStyle = bodyGradient(c, cy - 30, 60);
  c.beginPath();
  c.ellipse(x + 140, cy, 52, 30, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#555c68';
  c.lineWidth = 2.5;
  c.stroke();
  c.fillStyle = bodyGradient(c, cy - 18, 36);
  roundRect(c, x + 184, cy - 18, 40, 36, 14);
  c.fill();
  c.stroke();

  // Banco
  const seat = c.createLinearGradient(0, cy - 20, 0, cy + 20);
  seat.addColorStop(0, '#2b2d33');
  seat.addColorStop(0.5, '#4a4d55');
  seat.addColorStop(1, '#22242a');
  c.fillStyle = seat;
  roundRect(c, x + 62, cy - 20, 58, 40, 16);
  c.fill();

  // Farol
  c.fillStyle = '#fff6cf';
  roundRect(c, x + 222, cy - 9, 12, 18, 5); c.fill();
  c.fillStyle = '#e0241b';
  roundRect(c, x + 6, cy - 6, 8, 12, 3); c.fill();
}
