import { createTextureAtlas } from './texture-atlas.js?v=19';
import { createLightAtlas, createDayCycle } from './lighting.js?v=2';

const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  attribute vec4 a_color;

  uniform vec2 u_resolution;
  uniform vec2 u_camera;
  uniform float u_zoom;

  varying vec2 v_texCoord;
  varying vec4 v_color;

  void main() {
    vec2 screenPos = (a_position - u_camera) * u_zoom + u_resolution * 0.5;
    vec2 clipSpace = (screenPos / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
    v_texCoord = a_texCoord;
    v_color = a_color;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D u_image;
  varying vec2 v_texCoord;
  varying vec4 v_color;

  void main() {
    gl_FragColor = texture2D(u_image, v_texCoord) * v_color;
  }
`;

function hexToRgba(hex = '#ffffff', alpha = 1) {
  const clean = String(hex || '#ffffff').replace('#', '');
  const num = parseInt(clean, 16) || 0;
  return [
    ((num >> 16) & 255) / 255,
    ((num >> 8) & 255) / 255,
    (num & 255) / 255,
    alpha
  ];
}

function hexToRgb01(hex, fallback = [0.945, 0.761, 0.49]) {
  if (typeof hex !== 'string') return fallback;
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

export class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true }) ||
               canvas.getContext('experimental-webgl', { alpha: false, antialias: true });

    if (!gl) {
      throw new Error('[WebGL] WebGL não está disponível neste navegador ou dispositivo.');
    }

    this.gl = gl;
    this.maxQuads = 12000;
    this.floatsPerVertex = 8;
    this.vertexData = new Float32Array(this.maxQuads * 6 * this.floatsPerVertex);
    this.quadCount = 0;

    this.#initShaders();
    this.#initBuffers();
    this.#initAtlas();
    this.#initLightAtlas();
    this.dayCycle = createDayCycle();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  #compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`[WebGL] Falha ao compilar shader: ${info}`);
    }
    return shader;
  }

  #initShaders() {
    const gl = this.gl;
    const vs = this.#compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.#compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`[WebGL] Falha ao linkar programa: ${gl.getProgramInfoLog(program)}`);
    }

    gl.useProgram(program);
    this.program = program;
    this.locPos = gl.getAttribLocation(program, 'a_position');
    this.locTex = gl.getAttribLocation(program, 'a_texCoord');
    this.locCol = gl.getAttribLocation(program, 'a_color');
    this.locResolution = gl.getUniformLocation(program, 'u_resolution');
    this.locCamera = gl.getUniformLocation(program, 'u_camera');
    this.locZoom = gl.getUniformLocation(program, 'u_zoom');
    this.zoom = 1.22;
    // Visão 2.5D (prédios em 3D); a tecla V alterna
    this.view3d = true;
    try { this.view3d = localStorage.getItem('gta-visao-3d') !== '0'; } catch { /* sem storage */ }
  }

  #initBuffers() {
    const gl = this.gl;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);

    const stride = this.floatsPerVertex * 4;
    gl.enableVertexAttribArray(this.locPos);
    gl.vertexAttribPointer(this.locPos, 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(this.locTex);
    gl.vertexAttribPointer(this.locTex, 2, gl.FLOAT, false, stride, 8);

    gl.enableVertexAttribArray(this.locCol);
    gl.vertexAttribPointer(this.locCol, 4, gl.FLOAT, false, stride, 16);
  }

  #initAtlas() {
    const gl = this.gl;
    const atlas = createTextureAtlas();
    this.uvs = atlas.uvs;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    this.customTextures = new Map();
  }

  // Texturas de luz (brilho, facho de farol, vinheta) com filtro LINEAR para
  // gradientes suaves mesmo esticados na tela inteira.
  #initLightAtlas() {
    const gl = this.gl;
    const { canvas, uvs } = createLightAtlas();
    this.lightUvs = uvs;
    this.lightTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.lightTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
  }

  // Passe de iluminação: escurece a cena conforme a hora do dia e soma as luzes
  // (faróis, postes, portas acesas, fogo) com blend aditivo. Por fim, vinheta.
  #renderLighting({ camera, cityMap, vehicles, boats, explosions, player, visibleBlocks, time, weaponFx = [] }) {
    const gl = this.gl;
    const sky = this.dayCycle.sample(time);
    const insideFactor = player.insideLocationCode ? 0.35 : 1;
    const darkness = sky.darkness * insideFactor;
    this.lastDarkness = darkness;
    const lights = sky.lights;

    const viewW = (this.viewWidth || 800) / this.zoom;
    const viewH = (this.viewHeight || 600) / this.zoom;
    const vx = camera.x - viewW * 0.5 - 4;
    const vy = camera.y - viewH * 0.5 - 4;
    const vw = viewW + 8;
    const vh = viewH + 8;

    const mainUvs = this.uvs;
    this.uvs = this.lightUvs;
    gl.bindTexture(gl.TEXTURE_2D, this.lightTexture);

    const flush = () => {
      if (this.quadCount === 0) return;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData.subarray(0, this.quadCount * 6 * this.floatsPerVertex));
      gl.drawArrays(gl.TRIANGLES, 0, this.quadCount * 6);
      this.quadCount = 0;
    };

    // 1) Tom do céu: dourado no nascer/pôr do sol, azul-escuro à noite
    this.quadCount = 0;
    if (sky.golden > 0.01) {
      this.#pushQuad(vx, vy, vw, vh, 0, 'solid', [1, 0.5, 0.18, 0.13 * sky.golden]);
    }
    if (darkness > 0.01) {
      this.#pushQuad(vx, vy, vw, vh, 0, 'solid', [0.03, 0.05, 0.16, darkness]);
    }
    flush();

    // 2) Luzes somadas (aditivo)
    if (lights > 0.01) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      const inView = (x, y, m = 160) => x > vx - m && x < vx + vw + m && y > vy - m && y < vy + vh + m;
      const glow = (x, y, size, rgb, a, tex = 'glow') => {
        this.#pushQuad(x - size * 0.5, y - size * 0.5, size, size, 0, tex, [rgb[0], rgb[1], rgb[2], a * lights]);
      };

      // Janelas acesas dos prédios em 3D
      for (const wl of this.windowLights || []) {
        if (inView(wl.x, wl.y, 40)) glow(wl.x, wl.y, 38, [1, 0.78, 0.42], 0.95);
      }

      // Postes nas esquinas dos quarteirões e luz das portas
      const lamp = [1, 0.8, 0.48];
      const seenLamps = new Set();
      for (const block of visibleBlocks) {
        const b = block.bounds;
        const corners = [[b.x - 6, b.y - 6], [b.x + b.w + 6, b.y - 6], [b.x - 6, b.y + b.h + 6], [b.x + b.w + 6, b.y + b.h + 6]];
        for (const [lx, ly] of corners) {
          const key = `${Math.round(lx / 8)}:${Math.round(ly / 8)}`;
          if (seenLamps.has(key) || !inView(lx, ly)) continue;
          seenLamps.add(key);
          const flicker = 0.94 + Math.sin(time * 3.1 + lx * 0.07 + ly * 0.11) * 0.03;
          glow(lx, ly, 150, lamp, 0.34 * flicker);
          glow(lx, ly, 18, [1, 0.95, 0.8], 0.9);
        }
        for (const building of block.buildings) {
          const dm = building.doormat;
          if (!dm) continue;
          const dx = dm.x + dm.w * 0.5;
          const dy = dm.y + dm.h * 0.5;
          if (!inView(dx, dy)) continue;
          glow(dx, dy, 70, [1, 0.72, 0.38], 0.32);
        }
      }

      // Faróis (facho em cone) e lanternas traseiras
      for (const v of vehicles) {
        if (v.destroyed || (v.sinkProgress ?? 0) > 0.3 || !inView(v.x, v.y, 220)) continue;
        const cos = Math.cos(v.angle);
        const sin = Math.sin(v.angle);
        const half = v.length * 0.5;
        const beamLen = v.kind === 'moto' ? 120 : 165;
        const beamW = v.kind === 'moto' ? 62 : 92;
        const bcx = v.x + cos * (half + beamLen * 0.5 - 4);
        const bcy = v.y + sin * (half + beamLen * 0.5 - 4);
        this.#pushQuad(bcx - beamLen * 0.5, bcy - beamW * 0.5, beamLen, beamW, v.angle, 'beam', [1, 0.95, 0.78, 0.42 * lights]);
        const spread = v.kind === 'moto' ? [0] : [-0.28, 0.28];
        for (const s of spread) {
          const hx = v.x + cos * half - sin * v.width * s;
          const hy = v.y + sin * half + cos * v.width * s;
          glow(hx, hy, 16, [1, 0.97, 0.85], 0.85);
        }
        if (v.kind !== 'moto') {
          const braking = (v.speed ?? 0) < 8 ? 1.35 : 1;
          for (const s of [-0.3, 0.3]) {
            const tx = v.x - cos * half - sin * v.width * s;
            const ty = v.y - sin * half + cos * v.width * s;
            glow(tx, ty, 26, [1, 0.12, 0.08], 0.5 * braking);
          }
        }
      }

      // Giroflex ilumina a rua em vermelho e azul
      for (const v of vehicles) {
        if (!v.police || !v.sirenOn || v.destroyed || !inView(v.x, v.y, 300)) continue;
        const red = Math.floor(time * 6) % 2 === 0;
        glow(v.x, v.y, 300, red ? [1, 0.1, 0.1] : [0.2, 0.4, 1], 0.55);
      }

      for (const v of vehicles) {
        if (!(v.special || v.neon) || v.destroyed || !inView(v.x, v.y)) continue;
        this.#pushQuad(v.x - v.length, v.y - v.width * 1.3, v.length * 2, v.width * 2.6, v.angle, 'glow', [1, 0.25, 0.7, 0.6 * lights]);
      }

      for (const boat of boats) {
        if (!inView(boat.x, boat.y)) continue;
        glow(boat.x, boat.y, 46, [0.6, 0.85, 1], 0.4);
      }

      // Fogo e explosões iluminam os arredores
      for (const v of vehicles) {
        if (!(v.destroyed && v.burning) || !inView(v.x, v.y)) continue;
        glow(v.x, v.y, 230 + Math.sin(time * 12 + v.x) * 18, [1, 0.42, 0.1], 0.55);
      }
      for (const ex of explosions) {
        const p = Math.min(1, ex.timer / ex.duration);
        glow(ex.x, ex.y, ex.radius * 5, [1, 0.6, 0.2], (1 - p) * 0.9);
      }

      // Clarão dos tiros ilumina a rua
      for (const fx of weaponFx) {
        if (fx.kind !== 'muzzle') continue;
        glow(fx.x, fx.y, 130, [1, 0.8, 0.4], 0.7 * (1 - fx.life / fx.maxLife));
      }

      // Halo discreto ao redor do jogador para não sumir no escuro
      glow(player.x, player.y, 120, [0.85, 0.88, 1], 0.16);

      flush();
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    // 3) Vinheta cinematográfica (mais forte à noite)
    this.#pushQuad(vx, vy, vw, vh, 0, 'vignette', [0, 0, 0.02, 0.38 + darkness * 0.3]);
    flush();

    this.uvs = mainUvs;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
  }

  /** Estado atual do céu (para HUD/depuração). */
  getSkyState(time) {
    return this.dayCycle.sample(time);
  }

  #getOrLoadLogoTexture(url) {
    if (!url) return null;
    const existing = this.customTextures.get(url);
    if (existing) return existing;
    const gl = this.gl;
    const entry = { texture: null, loaded: false, failed: false, width: 1, height: 1 };
    this.customTextures.set(url, entry);
    const img = new Image();
    img.onload = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const natW = img.naturalWidth || img.width || 256;
      const natH = img.naturalHeight || img.height || 256;
      let uploadSource = img;
      if (/\.svg(\?|$)/i.test(url) && typeof document !== 'undefined') {
        const aspect = natW / Math.max(1, natH);
        const targetW = 256;
        const targetH = Math.max(1, Math.round(256 / Math.max(0.1, aspect)));
        const raster = document.createElement('canvas');
        raster.width = targetW;
        raster.height = targetH;
        const ctx = raster.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, targetW, targetH);
          uploadSource = raster;
        }
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, uploadSource);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      entry.texture = tex;
      entry.width = natW;
      entry.height = natH;
      entry.loaded = true;
    };
    img.onerror = () => {
      entry.failed = true;
    };
    img.src = url;
    return entry;
  }

  resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    this.viewWidth = width;
    this.viewHeight = height;
  }

  // ---- Visão 2.5D (estilo GTA 2) ----
  // Um ponto a uma altura z "sobe" em direção à câmera: afasta-se do centro da tela.
  #project(x, y, z, camera) {
    const s = CAMERA_HEIGHT / (CAMERA_HEIGHT - z);
    return [camera.x + (x - camera.x) * s, camera.y + (y - camera.y) * s];
  }

  // Quadrilátero livre (4 cantos) com uma região do atlas
  #pushQuadPts(p0, p1, p2, p3, uvName, rgba) {
    if (this.quadCount >= this.maxQuads) return;
    const uv = this.uvs[uvName] || this.uvs.solid;
    const [r, g, b, a] = rgba;
    const d = this.vertexData;
    let i = this.quadCount * 6 * this.floatsPerVertex;
    const w = (p, u, v) => {
      d[i++] = p[0]; d[i++] = p[1];
      d[i++] = u; d[i++] = v;
      d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = a;
    };
    w(p0, uv.u0, uv.v0); w(p1, uv.u1, uv.v0); w(p2, uv.u1, uv.v1);
    w(p0, uv.u0, uv.v0); w(p2, uv.u1, uv.v1); w(p3, uv.u0, uv.v1);
    this.quadCount++;
  }

  // Desenha as fachadas visíveis do prédio e devolve o telhado já projetado na altura certa
  #drawBuildingWalls(roof, camera, ra) {
    const H = buildingHeight(roof);
    const x0 = roof.x;
    const y0 = roof.y;
    const x1 = roof.x + roof.w;
    const y1 = roof.y + roof.h;
    const [rr, rg, rb] = roof.color;
    // fachada: mistura a cor do telhado com um tom de reboco claro
    const base = [rr * 0.45 + 0.86 * 0.55, rg * 0.45 + 0.82 * 0.55, rb * 0.45 + 0.75 * 0.55];
    const night = this.lastDarkness || 0;
    const faces = [];
    if (camera.y > y1) faces.push({ a: [x0, y1], b: [x1, y1], shade: 0.97, side: 'south' });
    if (camera.y < y0) faces.push({ a: [x1, y0], b: [x0, y0], shade: 0.68, side: 'north' });
    if (camera.x > x1) faces.push({ a: [x1, y1], b: [x1, y0], shade: 0.82, side: 'east' });
    if (camera.x < x0) faces.push({ a: [x0, y0], b: [x0, y1], shade: 0.9, side: 'west' });

    const at = (f, t, z) => this.#project(f.a[0] + (f.b[0] - f.a[0]) * t, f.a[1] + (f.b[1] - f.a[1]) * t, z, camera);
    for (const f of faces) {
      const col = [base[0] * f.shade, base[1] * f.shade, base[2] * f.shade, ra];
      this.#pushQuadPts(at(f, 0, 0), at(f, 1, 0), at(f, 1, H), at(f, 0, H), 'solid', col);
      // faixa escura no pé da parede (sombra de contato) e friso no topo
      this.#pushQuadPts(at(f, 0, 0), at(f, 1, 0), at(f, 1, 4), at(f, 0, 4), 'solid', [0, 0, 0, 0.28 * ra]);
      const trim = [rr * 0.7, rg * 0.7, rb * 0.7, ra];
      this.#pushQuadPts(at(f, 0, H - 5), at(f, 1, H - 5), at(f, 1, H), at(f, 0, H), 'solid', trim);

      // janelas por andar (acendem à noite)
      const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
      const floors = Math.max(1, Math.floor((H - 8) / 26));
      const cols = Math.max(1, Math.floor((len - 12) / 30));
      const winW = 12 / len;
      for (let fl = 0; fl < floors; fl++) {
        const z0 = 9 + fl * 26;
        const z1 = z0 + 13;
        for (let c = 0; c < cols; c++) {
          const tc = (c + 0.5) / cols;
          const t0 = tc - winW / 2;
          const t1 = tc + winW / 2;
          const lit = night > 0.25 && hash2(roof.x + c * 13, roof.y + fl * 7 + f.shade * 100) > 0.45;
          if (lit && ra > 0.5) {
            const [wx, wy] = at(f, tc, (z0 + z1) / 2);
            this.windowLights.push({ x: wx, y: wy });
          }
          const glass = lit
            ? [1, 0.84, 0.48, ra]
            : [0.2 * f.shade + 0.08, 0.3 * f.shade + 0.1, 0.42 * f.shade + 0.12, ra];
          this.#pushQuadPts(at(f, t0, z0), at(f, t1, z0), at(f, t1, z1), at(f, t0, z1), 'solid', glass);
          if (!lit) {
            // reflexo no vidro
            this.#pushQuadPts(at(f, t0, z1 - 4), at(f, t0 + winW * 0.45, z1 - 4), at(f, t0 + winW * 0.45, z1), at(f, t0, z1), 'solid', [1, 1, 1, 0.22 * ra]);
          }
        }
      }

      // porta na fachada de entrada
      if (roof.doormat && roof.doorSide === f.side) {
        const dm = roof.doormat;
        const vertical = f.side === 'east' || f.side === 'west';
        const d0 = vertical ? dm.y : dm.x;
        const d1 = vertical ? dm.y + dm.h : dm.x + dm.w;
        const e0 = vertical ? f.a[1] : f.a[0];
        const e1 = vertical ? f.b[1] : f.b[0];
        const ta = (d0 - e0) / (e1 - e0);
        const tb = (d1 - e0) / (e1 - e0);
        const t0 = Math.max(0, Math.min(ta, tb));
        const t1 = Math.min(1, Math.max(ta, tb));
        this.#pushQuadPts(at(f, t0, 0), at(f, t1, 0), at(f, t1, 22), at(f, t0, 22), 'solid', [0.3, 0.2, 0.12, ra]);
        this.#pushQuadPts(at(f, t0 - 0.02, 22), at(f, t1 + 0.02, 22), at(f, t1 + 0.02, 27), at(f, t0 - 0.02, 27), 'solid', [0.85, 0.2, 0.2, ra]);
      }
    }

    const [px0, py0] = this.#project(x0, y0, H, camera);
    const [px1, py1] = this.#project(x1, y1, H, camera);
    return { ...roof, x: px0, y: py0, w: px1 - px0, h: py1 - py0 };
  }

  // Mureta (platibanda) com luz e sombra + caixas de ar-condicionado, claraboias e caixa d'água
  #drawRoofDetails(roof, ra) {
    const [r, g, b] = roof.color;
    const dark = [r * 0.62, g * 0.62, b * 0.62, ra];
    const light = [Math.min(1, r * 1.25 + 0.08), Math.min(1, g * 1.25 + 0.08), Math.min(1, b * 1.25 + 0.08), ra * 0.85];
    const e = 5;
    // borda escura em volta e brilho nas bordas de cima/esquerda (luz vindo do noroeste)
    this.#pushQuad(roof.x, roof.y + roof.h - e, roof.w, e, 0, 'solid', dark);
    this.#pushQuad(roof.x + roof.w - e, roof.y, e, roof.h, 0, 'solid', dark);
    this.#pushQuad(roof.x, roof.y, roof.w, e, 0, 'solid', dark);
    this.#pushQuad(roof.x, roof.y, e, roof.h, 0, 'solid', dark);
    this.#pushQuad(roof.x + e, roof.y + e, roof.w - 2 * e, 2, 0, 'solid', light);
    this.#pushQuad(roof.x + e, roof.y + e, 2, roof.h - 2 * e, 0, 'solid', light);

    if (roof.isHospital || roof.isEncounter || roof.w < 70 || roof.h < 60) return;
    let seed = (Math.round(roof.x) * 73856093) ^ (Math.round(roof.y) * 19349663);
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const count = 1 + Math.floor(rnd() * 3);
    const corners = [[0.18, 0.22], [0.82, 0.22], [0.18, 0.78], [0.82, 0.78]];
    for (let i = 0; i < count; i++) {
      const [fx, fy] = corners.splice(Math.floor(rnd() * corners.length), 1)[0];
      const cx = roof.x + roof.w * fx;
      const cy = roof.y + roof.h * fy;
      const kind = rnd();
      if (kind < 0.5) {
        // ar-condicionado
        this.#pushQuad(cx - 8 + 3, cy - 6 + 4, 16, 12, 0, 'solid', [0, 0, 0, 0.3 * ra]);
        this.#pushQuad(cx - 8, cy - 6, 16, 12, 0, 'solid', [0.78, 0.8, 0.83, ra]);
        this.#pushQuad(cx - 5, cy - 4, 10, 8, 0, 'disc', [0.35, 0.38, 0.42, ra]);
        this.#pushQuad(cx - 1.5, cy - 1.5, 3, 3, 0, 'disc', [0.75, 0.78, 0.8, ra]);
      } else if (kind < 0.8) {
        // claraboia de vidro
        this.#pushQuad(cx - 12, cy - 8, 24, 16, 0, 'solid', [0.22, 0.25, 0.3, ra]);
        this.#pushQuad(cx - 10, cy - 6, 20, 12, 0, 'solid', [0.45, 0.66, 0.82, ra]);
        this.#pushQuad(cx - 8, cy - 5, 6, 10, 0.5, 'solid', [1, 1, 1, 0.35 * ra]);
      } else {
        // caixa d'água
        this.#pushQuad(cx - 9 + 3, cy - 9 + 4, 18, 18, 0, 'disc', [0, 0, 0, 0.3 * ra]);
        this.#pushQuad(cx - 9, cy - 9, 18, 18, 0, 'disc', [0.24, 0.42, 0.72, ra]);
        this.#pushQuad(cx - 6, cy - 6, 12, 12, 0, 'disc', [0.36, 0.56, 0.86, ra]);
      }
    }
  }

  #pushQuad(x, y, w, h, angle, uvName, rgba) {
    if (this.quadCount >= this.maxQuads) {
      return;
    }
    const uv = this.uvs[uvName] || this.uvs.solid;
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const hw = w * 0.5;
    const hh = h * 0.5;
    const cos = angle ? Math.cos(angle) : 1;
    const sin = angle ? Math.sin(angle) : 0;

    const p0x = cx + (-hw * cos - -hh * sin);
    const p0y = cy + (-hw * sin + -hh * cos);
    const p1x = cx + (hw * cos - -hh * sin);
    const p1y = cy + (hw * sin + -hh * cos);
    const p2x = cx + (hw * cos - hh * sin);
    const p2y = cy + (hw * sin + hh * cos);
    const p3x = cx + (-hw * cos - hh * sin);
    const p3y = cy + (-hw * sin + hh * cos);

    const [r, g, b, a] = rgba;
    const d = this.vertexData;
    let i = this.quadCount * 6 * this.floatsPerVertex;

    const writeVert = (vx, vy, u, v) => {
      d[i++] = vx; d[i++] = vy;
      d[i++] = u; d[i++] = v;
      d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = a;
    };

    writeVert(p0x, p0y, uv.u0, uv.v0);
    writeVert(p1x, p1y, uv.u1, uv.v0);
    writeVert(p2x, p2y, uv.u1, uv.v1);

    writeVert(p0x, p0y, uv.u0, uv.v0);
    writeVert(p2x, p2y, uv.u1, uv.v1);
    writeVert(p3x, p3y, uv.u0, uv.v1);

    this.quadCount++;
  }

  #drawNpcWaves(x, y, time) {
    const cycle = 1.9;
    for (let i = 0; i < 3; i++) {
      const phase = ((time / cycle) + i / 3) % 1;
      const waveSize = 32 + phase * 156;
      const alpha = (1 - phase) * (1 - phase) * 0.72;
      this.#pushQuad(
        x - waveSize * 0.5,
        y - waveSize * 0.5,
        waveSize,
        waveSize,
        0,
        'shockwave',
        [0.98, 0.78, 0.2, alpha]
      );
    }
  }

  #drawStoryNpc(x, y, time, withHalo = false, spriteTop = '', angle = Math.PI * 0.5, customQuads = null, isCovered = false) {
    if (withHalo) {
      const pulse = 1 + Math.sin(time * 5) * 0.14;
      const ringSize = 36 * pulse;
      this.#pushQuad(
        x - ringSize * 0.5,
        y - ringSize * 0.5,
        ringSize,
        ringSize,
        0,
        'circle',
        [0.98, 0.78, 0.18, 0.75]
      );
    }
    const entry = spriteTop ? this.#getOrLoadLogoTexture(spriteTop) : null;
    if (entry && entry.loaded && entry.texture && customQuads && !isCovered) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const drawArm = (fwd, side) => {
        const ax = x + (cos * fwd - sin * side);
        const ay = y + (sin * fwd + cos * side);
        this.#pushQuad(ax - 4, ay - 2.5, 8, 5, angle, 'solid', [0.92, 0.72, 0.52, 1]);
      };
      drawArm(2, -11);
      drawArm(2, 11);
      const aspect = entry.width / Math.max(1, entry.height);
      const boxH = 56;
      customQuads.push({
        cx: x,
        cy: y,
        w: boxH * aspect,
        h: boxH,
        angle: angle - Math.PI * 0.5,
        entry,
        alpha: 1,
      });
      return;
    }
    // Braços e sombra no chão
    this.#pushQuad(x - 13, y - 2, 6, 7, 0, 'solid', [0.95, 0.78, 0.65, 1]);
    this.#pushQuad(x + 7, y - 2, 6, 7, 0, 'solid', [0.95, 0.78, 0.65, 1]);
    this.#pushQuad(x - 10, y - 9, 22, 22, 0, 'disc', [0, 0, 0, 0.35]);
    // Ombros, camisa, rosto e cabelo nítidos
    this.#pushQuad(x - 11, y - 11, 22, 22, 0, 'disc', [0.12, 0.16, 0.22, 1]);
    this.#pushQuad(x - 8, y - 7, 16, 16, 0, 'disc', [0.92, 0.25, 0.25, 1]);
    this.#pushQuad(x - 5, y + 1, 10, 10, 0, 'disc', [0.95, 0.78, 0.65, 1]);
    this.#pushQuad(x - 4.5, y - 2, 9, 9, 0, 'disc', [0.22, 0.14, 0.08, 1]);
  }

  renderFrame({ camera, cityMap, vehicles, boats = [], trashBins = [], pedestrians = [], player, playerSprites = null, partner = null, bullets = [], weaponFx = [], skidMarks, bloodMarks = [], smokeParticles = [], explosions = [], worldCollectibles = [], objectivePoint, objectiveNpcPoint, gpsPoint = null, completedNpcPoints = [], encounterLocations = null, emitNpcWaves = false, time }) {
    const gl = this.gl;
    this.quadCount = 0;

    const halfW = ((this.viewWidth || 800) * 0.5) / this.zoom + 140;
    const halfH = ((this.viewHeight || 600) * 0.5) / this.zoom + 140;
    const minX = camera.x - halfW;
    const maxX = camera.x + halfW;
    const minY = camera.y - halfH;
    const maxY = camera.y + halfH;

    // Mar ao redor da ilha e asfalto apenas dentro dos limites da cidade
    const tileStep = 128;
    const tx0 = Math.floor(minX / tileStep) * tileStep;
    const ty0 = Math.floor(minY / tileStep) * tileStep;
    for (let ty = ty0; ty < maxY; ty += tileStep) {
      for (let tx = tx0; tx < maxX; tx += tileStep) {
        const insideIsland =
          tx + tileStep > 0 &&
          ty + tileStep > 0 &&
          tx < cityMap.worldWidth &&
          ty < cityMap.worldHeight;
        this.#pushQuad(tx, ty, tileStep, tileStep, 0, insideIsland ? 'asphalt' : 'water', [1, 1, 1, 1]);
      }
    }

    // Borda costeira (areia/cais) ao redor da ilha quando visível
    const shore = 18;
    if (minX < shore) {
      this.#pushQuad(-shore, Math.max(0, minY), shore, Math.min(cityMap.worldHeight, maxY) - Math.max(0, minY), 0, 'sidewalk', [0.85, 0.8, 0.65, 1]);
    }
    if (maxX > cityMap.worldWidth - shore) {
      this.#pushQuad(cityMap.worldWidth, Math.max(0, minY), shore, Math.min(cityMap.worldHeight, maxY) - Math.max(0, minY), 0, 'sidewalk', [0.85, 0.8, 0.65, 1]);
    }
    if (minY < shore) {
      this.#pushQuad(Math.max(-shore, minX), -shore, Math.min(cityMap.worldWidth + shore, maxX) - Math.max(-shore, minX), shore, 0, 'sidewalk', [0.85, 0.8, 0.65, 1]);
    }
    if (maxY > cityMap.worldHeight - shore) {
      this.#pushQuad(Math.max(-shore, minX), cityMap.worldHeight, Math.min(cityMap.worldWidth + shore, maxX) - Math.max(-shore, minX), shore, 0, 'sidewalk', [0.85, 0.8, 0.65, 1]);
    }

    // Chunks visíveis na área da câmera (evita varrer o mapa inteiro por frame)
    const activeChunks = typeof cityMap.getActiveChunks === 'function'
      ? cityMap.getActiveChunks(minX, minY, maxX, maxY, 0)
      : [];
    const seenRoadY = new Set();
    const seenRoadX = new Set();
    const seenCrosswalks = new Set();
    const visibleBlocks = [];

    if (activeChunks.length > 0) {
      for (const chunk of activeChunks) {
        for (const ryIdx of chunk.roadYIndices) seenRoadY.add(ryIdx);
        for (const rxIdx of chunk.roadXIndices) seenRoadX.add(rxIdx);
        for (const cw of chunk.crosswalks) seenCrosswalks.add(cw);
        for (const block of chunk.blocks) {
          const b = block.bounds;
          if (b.x + b.w < minX || b.x > maxX || b.y + b.h < minY || b.y > maxY) continue;
          visibleBlocks.push(block);
        }
      }
    } else {
      for (let i = 0; i < cityMap.roadYOffsets.length; i += 1) seenRoadY.add(i);
      for (let i = 0; i < cityMap.roadXOffsets.length; i += 1) seenRoadX.add(i);
      for (const cw of cityMap.crosswalks || []) seenCrosswalks.add(cw);
      visibleBlocks.push(...cityMap.getVisibleBlocks(minX, minY, maxX, maxY));
    }

    // Faixas amarelas nas ruas dos chunks visíveis
    const stripeColor = [0.95, 0.78, 0.22, 0.85];
    const clampMinX = Math.max(0, Math.floor(minX / 64) * 64);
    const clampMaxX = Math.min(cityMap.worldWidth - 34, maxX);
    for (const ryIdx of seenRoadY) {
      const roadY = cityMap.roadYOffsets[ryIdx];
      if (roadY + cityMap.roadWidth < minY || roadY > maxY) continue;
      const ry = roadY + cityMap.roadWidth * 0.5 - 2;
      for (let sx = clampMinX; sx < clampMaxX; sx += 64) {
        this.#pushQuad(sx, ry, 34, 4, 0, 'solid', stripeColor);
      }
    }
    const clampMinY = Math.max(0, Math.floor(minY / 64) * 64);
    const clampMaxY = Math.min(cityMap.worldHeight - 34, maxY);
    for (const rxIdx of seenRoadX) {
      const roadX = cityMap.roadXOffsets[rxIdx];
      if (roadX + cityMap.roadWidth < minX || roadX > maxX) continue;
      const rx = roadX + cityMap.roadWidth * 0.5 - 2;
      for (let sy = clampMinY; sy < clampMaxY; sy += 64) {
        this.#pushQuad(rx, sy, 4, 34, 0, 'solid', stripeColor);
      }
    }

    // Faixas de pedestre nos cruzamentos dos chunks visíveis
    if (seenCrosswalks.size > 0) {
      const cwColor = [0.94, 0.95, 0.97, 0.86];
      for (const cw of seenCrosswalks) {
        if (cw.x + cw.w < minX || cw.x > maxX || cw.y + cw.h < minY || cw.y > maxY) continue;
        if (cw.axis === 'h') {
          for (let sx = cw.x + 4; sx <= cw.x + cw.w - 10; sx += 14) {
            this.#pushQuad(sx, cw.y, 7, cw.h, 0, 'solid', cwColor);
          }
        } else {
          for (let sy = cw.y + 4; sy <= cw.y + cw.h - 10; sy += 14) {
            this.#pushQuad(cw.x, sy, cw.w, 7, 0, 'solid', cwColor);
          }
        }
      }
    }

    // Quarteirões visíveis: primeiro o piso (calçadas e gramado das praças)
    const closedRoofs = [];
    for (const block of visibleBlocks) {
      const b = block.bounds;
      // Sombra de meio-fio e calçada
      this.#pushQuad(b.x - 4, b.y - 4, b.w + 8, b.h + 8, 0, 'solid', [0.16, 0.18, 0.22, 1]);
      this.#pushQuad(b.x, b.y, b.w, b.h, 0, 'sidewalk', [1, 1, 1, 1]);

      if (block.plaza) {
        const pb = block.plaza.bounds;
        this.#pushQuad(pb.x, pb.y, pb.w, pb.h, 0, 'grass', [1, 1, 1, 1]);
      }
    }

    // Árvores: canteiro de terra e sombra no chão (a copa é desenhada por cima das pessoas)
    const visibleTrees = [];
    for (const block of visibleBlocks) {
      for (const t of blockDecor(block).trees) {
        if (t.x < minX - 40 || t.x > maxX + 40 || t.y < minY - 40 || t.y > maxY + 40) continue;
        visibleTrees.push(t);
        if (!t.bush) {
          this.#pushQuad(t.x - 7, t.y - 7, 14, 14, 0, 'disc', [0.36, 0.26, 0.16, 0.9]);
        }
        const sh = t.r * 2.5;
        this.#pushQuad(t.x + t.r * 0.35 - sh * 0.5, t.y + t.r * 0.45 - sh * 0.5, sh, sh, 0, 'softshadow', [0, 0, 0, 0.32]);
      }
    }

    // Marcas de drift (sobre asfalto, calçada e gramado)
    for (const mark of skidMarks) {
      if (mark.x < minX || mark.x > maxX || mark.y < minY || mark.y > maxY) continue;
      const len = mark.length || 8;
      const wid = (mark.width || 5) + (mark.surface === 'grass' ? 1.5 : 0);
      const color = mark.surface === 'grass'
        ? [0.28, 0.19, 0.09, Math.min(0.85, mark.alpha * 1.35)]
        : mark.surface === 'sidewalk'
          ? [0.18, 0.17, 0.16, mark.alpha * 0.85]
          : [0.04, 0.04, 0.05, mark.alpha];
      this.#pushQuad(mark.x - len * 0.5, mark.y - wid * 0.5, len, wid, mark.angle, 'solid', color);
    }

    // Marcas de sangue de arrasto e impacto (sobre asfalto, calçada e gramado)
    for (const mark of bloodMarks) {
      if (mark.x < minX || mark.x > maxX || mark.y < minY || mark.y > maxY) continue;
      const len = mark.length || mark.size || 8;
      const wid = mark.width || mark.size || 8;
      this.#pushQuad(mark.x - len * 0.5, mark.y - wid * 0.5, len, wid, mark.angle || 0, 'solid', [0.58, 0.04, 0.05, mark.alpha]);
    }

    // Mobiliário de praça, obstáculos e edificações
    for (const block of visibleBlocks) {
      if (block.plaza) {
        for (const prop of block.plaza.props) {
          if (prop.kind === 'fountain') {
            this.#pushQuad(prop.x - 4, prop.y - 4, prop.w + 8, prop.h + 8, 0, 'solid', [0.75, 0.77, 0.8, 1]);
            this.#pushQuad(prop.x, prop.y, prop.w, prop.h, 0, 'water', [1, 1, 1, 1]);
          } else {
            this.#pushQuad(prop.x, prop.y, prop.w, prop.h, 0, 'solid', [0.55, 0.36, 0.2, 1]);
          }
        }
      }

      for (const obs of block.obstacles) {
        this.#pushQuad(obs.x, obs.y, obs.w, obs.h, 0, 'solid', [0.22, 0.24, 0.28, 1]);
      }

      for (const building of block.buildings) {
        const bb = building.bounds;
        const isInside = player.insideLocationCode === building.code;

        // Sombra suave da edificação
        // Sombra em duas camadas: projeta o "volume" do prédio para baixo/direita
        this.#pushQuad(bb.x + 12, bb.y + 14, bb.w, bb.h, 0, 'solid', [0, 0, 0, 0.12]);
        this.#pushQuad(bb.x + 6, bb.y + 7, bb.w, bb.h, 0, 'solid', [0, 0, 0, 0.24]);

        // Interior sempre desenhado por baixo
        this.#pushQuad(bb.x, bb.y, bb.w, bb.h, 0, 'floor', hexToRgba(building.floorColor));
        for (const wall of building.interior.walls) {
          this.#pushQuad(wall.x, wall.y, wall.w, wall.h, 0, 'solid', [0.2, 0.22, 0.26, 1]);
        }
        for (const prop of building.interior.props) {
          const pCol = prop.kind === 'counter' ? [0.45, 0.28, 0.16, 1] : [0.6, 0.45, 0.3, 1];
          this.#pushQuad(prop.x, prop.y, prop.w, prop.h, 0, 'solid', pCol);
        }

        // Cobertura superior com fade suave ao entrar/sair (desenhada após pedestres)
        const roofAlpha = building.roofAlpha ?? (isInside ? 0 : 1);
        if (roofAlpha > 0.01) {
          const encounterMeta = encounterLocations instanceof Map
            ? encounterLocations.get(building.code)
            : (encounterLocations?.has?.(building.code) ? {} : null);
          const isEncounter = Boolean(encounterMeta);
          const baseRoofColor = isEncounter
            ? hexToRgba(encounterMeta.roofColor || '#d6282e')
            : hexToRgba(building.roofColor);
          closedRoofs.push({
            x: bb.x,
            y: bb.y,
            w: bb.w,
            h: bb.h,
            color: [baseRoofColor[0], baseRoofColor[1], baseRoofColor[2], baseRoofColor[3] * roofAlpha],
            alpha: roofAlpha,
            isHospital: building.type === 'hospital',
            code: building.code,
            type: building.type,
            doorSide: building.doorSide,
            doormat: building.doormat,
            isEncounter,
            roofLogo: encounterMeta?.roofLogo || '',
          });
        }

        // Indicação discreta da porta de entrada (soleira) e folha da porta animada
        if (building.doormat) {
          const dm = building.doormat;
          const isVertical = building.doorSide === 'west' || building.doorSide === 'east';
          const matAngle = isVertical ? Math.PI * 0.5 : 0;
          const matW = isVertical ? Math.max(dm.h, 46) : Math.max(dm.w, 46);
          const matH = isVertical ? Math.max(dm.w, 18) : Math.max(dm.h, 18);
          this.#pushQuad(
            dm.x + dm.w * 0.5 - matW * 0.5,
            dm.y + dm.h * 0.5 - matH * 0.5,
            matW,
            matH,
            matAngle,
            'doormat',
            [1, 1, 1, 0.92],
          );
        }

        const ent = building.entrance;
        const openAmt = building.doorOpen || 0;
        const doorLen = 42;
        const doorThick = 6;
        let baseAngle = 0;
        let hingeX = ent.x;
        let hingeY = ent.y;
        let swingDir = 1;

        if (building.doorSide === 'south') {
          hingeX = ent.x + 2;
          hingeY = bb.y + bb.h - 7;
          baseAngle = 0;
          swingDir = -1;
        } else if (building.doorSide === 'north') {
          hingeX = ent.x + 2;
          hingeY = bb.y + 7;
          baseAngle = 0;
          swingDir = 1;
        } else if (building.doorSide === 'west') {
          hingeX = bb.x + 7;
          hingeY = ent.y + 2;
          baseAngle = Math.PI * 0.5;
          swingDir = -1;
        } else {
          hingeX = bb.x + bb.w - 7;
          hingeY = ent.y + 2;
          baseAngle = Math.PI * 0.5;
          swingDir = 1;
        }

        const doorAngle = baseAngle + swingDir * openAmt * 1.45;
        const doorCenterX = hingeX + Math.cos(doorAngle) * (doorLen * 0.5);
        const doorCenterY = hingeY + Math.sin(doorAngle) * (doorLen * 0.5);
        this.#pushQuad(
          doorCenterX - doorLen * 0.5,
          doorCenterY - doorThick * 0.5,
          doorLen,
          doorThick,
          doorAngle,
          'solid',
          [0.45, 0.28, 0.14, 1]
        );
      }
    }

    // Seta grossa vermelha no chão apontando diretamente para a entrada do destino
    if (objectivePoint) {
      let angle = Math.PI * 0.5;
      if (objectivePoint.doorSide === 'south') angle = -Math.PI * 0.5;
      else if (objectivePoint.doorSide === 'north') angle = Math.PI * 0.5;
      else if (objectivePoint.doorSide === 'west') angle = 0;
      else if (objectivePoint.doorSide === 'east') angle = Math.PI;

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const bounce = Math.sin(time * 6) * 4;
      const cx = objectivePoint.x + cos * bounce;
      const cy = objectivePoint.y + sin * bounce;
      const arrowColor = [0.94, 0.16, 0.16, 0.62];

      const pushArrowPart = (lx, ly, w, h, rotOffset) => {
        const wx = cx + lx * cos - ly * sin;
        const wy = cy + lx * sin + ly * cos;
        this.#pushQuad(wx - w * 0.5, wy - h * 0.5, w, h, angle + rotOffset, 'solid', arrowColor);
      };

      pushArrowPart(-8, 0, 26, 13, 0);
      pushArrowPart(5, -7, 22, 10, 0.68);
      pushArrowPart(5, 7, 22, 10, -0.68);
      pushArrowPart(10, 0, 12, 12, Math.PI * 0.25);
    }

    // Aura luminosa sob itens colecionáveis espalhados pelo mapa (cor por raridade)
    for (const c of worldCollectibles) {
      if (c.collected) continue;
      if (c.kind === 'interior' && player.insideLocationCode !== c.locationCode) continue;
      if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) continue;
      const ringSize = 36 + Math.sin(time * 4 + c.x) * 4;
      const auraColor = c.rarity === 'lendario'
        ? [0.98, 0.78, 0.16, 0.36]
        : c.rarity === 'especial'
          ? [0.72, 0.38, 0.98, 0.32]
          : [0.22, 0.82, 0.98, 0.28];
      this.#pushQuad(
        c.x - ringSize * 0.5,
        c.y - ringSize * 0.5,
        ringSize,
        ringSize,
        0,
        'circle',
        auraColor
      );
    }

    // Lixeiras dinâmicas nas esquinas (podem ser arremessadas e rebater)
    for (const bin of trashBins) {
      if (bin.x < minX || bin.x > maxX || bin.y < minY || bin.y > maxY) continue;
      const sz = bin.size || 14;
      this.#pushQuad(bin.x - sz * 0.5, bin.y - sz * 0.5, sz, sz, bin.angle || 0, 'trashbin', [1, 1, 1, 1]);
    }

    // Barcos decorativos circulando ao redor da ilha (sempre na água)
    for (const boat of boats) {
      if (boat.x < minX - 40 || boat.x > maxX + 40 || boat.y < minY - 40 || boat.y > maxY + 40) continue;
      const cos = Math.cos(boat.angle);
      const sin = Math.sin(boat.angle);
      const wakePulse = 0.85 + Math.sin(time * 7 + boat.distance * 0.05) * 0.15;
      const wakeX = boat.x - cos * (boat.length * 0.58);
      const wakeY = boat.y - sin * (boat.length * 0.58);
      this.#pushQuad(
        wakeX - 12 * wakePulse,
        wakeY - 5 * wakePulse,
        24 * wakePulse,
        10 * wakePulse,
        boat.angle,
        'solid',
        [0.85, 0.95, 1, 0.32]
      );
      this.#pushQuad(
        boat.x - boat.length * 0.5,
        boat.y - boat.width * 0.5,
        boat.length,
        boat.width,
        boat.angle,
        'boat',
        hexToRgba(boat.color || '#f8fafc', 1)
      );
    }

    // Veículos visíveis (com escala/transparência ao afundar na água)
    for (const v of vehicles) {
      if (v.x < minX || v.x > maxX || v.y < minY || v.y > maxY) continue;
      const sinkScale = v.sinkScale ?? 1;
      const entryPulse = v.entryPulseTimer > 0 ? Math.sin((v.entryPulseTimer / 0.28) * Math.PI) : 0;
      const pulseScale = sinkScale * (1 + entryPulse * 0.06);
      const vHealth = v.health ?? 100;
      const baseRgba = hexToRgba(v.color, v.sinkAlpha ?? 1);
      const shade = v.destroyed ? 0.22 : 0.45 + 0.55 * (vHealth / 100);
      const rgba = [baseRgba[0] * shade, baseRgba[1] * shade, baseRgba[2] * shade, baseRgba[3]];
      if (v.sinkProgress > 0) {
        const ring = 24 + v.sinkProgress * 34;
        this.#pushQuad(v.x - ring * 0.5, v.y - ring * 0.5, ring, ring, 0, 'solid', [0.75, 0.92, 1, (1 - v.sinkProgress) * 0.45]);
      }
      const dentWidth = vHealth < 75 ? v.width * (0.9 + 0.1 * (vHealth / 100)) : v.width;
      const dentLength = vHealth < 75 ? v.length * (0.93 + 0.07 * (vHealth / 100)) : v.length;
      if (entryPulse > 0.02 && !v.destroyed) {
        const cos = Math.cos(v.angle);
        const sin = Math.sin(v.angle);
        const frontOffset = dentLength * 0.5 + 10;
        const sideSpread = dentWidth * 0.28;
        for (const side of [-1, 1]) {
          const hx = v.x + cos * frontOffset - sin * sideSpread * side;
          const hy = v.y + sin * frontOffset + cos * sideSpread * side;
          this.#pushQuad(hx - 12, hy - 5, 24, 10, v.angle, 'circle', [1.0, 0.94, 0.55, entryPulse * 0.7]);
        }
      }
      // Neon rosa embaixo do carro especial (ou com neon da oficina)
      if ((v.special || v.neon) && !v.destroyed) {
        const pulse = 0.85 + Math.sin(time * 4 + v.x * 0.01) * 0.15;
        const gl = dentLength * 1.7 * pulseScale;
        const gw = dentWidth * 2.3 * pulseScale;
        this.#pushQuad(v.x - gl * 0.5, v.y - gw * 0.5, gl, gw, v.angle, 'circle', [1, 0.25, 0.7, 0.55 * pulse]);
      }
      // Chamas do escapamento (turbo / especial acelerando)
      if ((v.special || v.turbo) && !v.destroyed && v.driver === 'player' && (v.accelHoldTime || 0) > 0.05 && v.speed > 60) {
        const cosA = Math.cos(v.angle);
        const sinA = Math.sin(v.angle);
        const flick = 0.75 + Math.random() * 0.5;
        for (const s of [-0.25, 0.25]) {
          const fx = v.x - cosA * (dentLength * 0.5 + 6) - sinA * dentWidth * s;
          const fy = v.y - sinA * (dentLength * 0.5 + 6) + cosA * dentWidth * s;
          this.#pushQuad(fx - 9 * flick, fy - 4, 18 * flick, 8, v.angle, 'circle', [0.35, 0.6, 1, 0.85]);
          this.#pushQuad(fx - 5, fy - 2.5, 10, 5, v.angle, 'circle', [1, 0.95, 0.8, 0.9]);
        }
      }
      // Sombra suave projetada (luz vindo de cima-esquerda)
      {
        const shL = dentLength * 1.42 * pulseScale;
        const shW = dentWidth * 1.48 * pulseScale;
        this.#pushQuad(v.x + 3 - shL * 0.5, v.y + 5 - shW * 0.5, shL, shW, v.angle, 'softshadow', [0, 0, 0, 0.34 * (v.sinkAlpha ?? 1)]);
      }
      this.#pushQuad(
        v.x - dentLength * 0.5 * pulseScale,
        v.y - dentWidth * 0.5 * pulseScale,
        dentLength * pulseScale,
        dentWidth * pulseScale,
        v.angle,
        vehicleUv(v),
        rgba
      );
      // Viatura: capô e porta-malas pretos, giroflex no teto
      if (v.police && !v.destroyed) {
        const cosA = Math.cos(v.angle);
        const sinA = Math.sin(v.angle);
        const L = dentLength * pulseScale;
        const W = dentWidth * pulseScale;
        for (const f of [0.34, -0.36]) {
          const cx = v.x + cosA * L * f;
          const cy = v.y + sinA * L * f;
          this.#pushQuad(cx - L * 0.13, cy - W * 0.41, L * 0.26, W * 0.82, v.angle, 'solid', [0.06, 0.07, 0.09, 0.92]);
        }
        const flash = v.sirenOn ? Math.floor(time * 6) % 2 : -1;
        const red = flash === 0 ? [1, 0.15, 0.12, 1] : [0.45, 0.06, 0.06, 1];
        const blue = flash === 1 ? [0.25, 0.5, 1, 1] : [0.06, 0.12, 0.4, 1];
        for (const [side, col] of [[-1, red], [1, blue]]) {
          const bx = v.x - sinA * W * 0.19 * side - cosA * L * 0.04;
          const by = v.y + cosA * W * 0.19 * side - sinA * L * 0.04;
          this.#pushQuad(bx - 2.5, by - W * 0.18, 5, W * 0.36, v.angle, 'solid', col);
          if (v.sirenOn && ((side < 0 && flash === 0) || (side > 0 && flash === 1))) {
            this.#pushQuad(bx - 16, by - 16, 32, 32, 0, 'circle', [col[0], col[1], col[2], 0.55]);
          }
        }
      }
      // Faixas de corrida douradas no carro especial
      if (v.special && !v.destroyed) {
        const cosA = Math.cos(v.angle);
        const sinA = Math.sin(v.angle);
        for (const s of [-2.6, 2.6]) {
          const sx = v.x - sinA * s * pulseScale;
          const sy = v.y + cosA * s * pulseScale;
          const sl = dentLength * 0.92 * pulseScale;
          this.#pushQuad(sx - sl * 0.5, sy - 1.1, sl, 2.2, v.angle, 'solid', [1, 0.84, 0.3, 0.9]);
        }
      }
      if (vHealth < 75 && !v.destroyed) {
        const cos = Math.cos(v.angle);
        const sin = Math.sin(v.angle);
        const fx = v.x + cos * (v.length * 0.26);
        const fy = v.y + sin * (v.length * 0.26);
        this.#pushQuad(fx - 6, fy - 4, 12, 8, v.angle + 0.25, 'solid', [0.1, 0.1, 0.12, 0.55]);
        if (vHealth < 40) {
          const rx = v.x - cos * (v.length * 0.22);
          const ry = v.y - sin * (v.length * 0.22);
          this.#pushQuad(rx - 7, ry - 4, 14, 8, v.angle - 0.3, 'solid', [0.08, 0.08, 0.1, 0.65]);
        }
      }
      if (v.destroyed && v.burning) {
        const cos = Math.cos(v.angle);
        const sin = Math.sin(v.angle);
        const glowSize = Math.max(v.length, v.width) * (1.34 + Math.sin(time * 11 + v.x) * 0.12);
        this.#pushQuad(
          v.x - glowSize * 0.5,
          v.y - glowSize * 0.5,
          glowSize,
          glowSize,
          0,
          'circle',
          [0.95, 0.14, 0.04, 0.52]
        );
        const offsets = [-0.26, 0.0, 0.25];
        for (let fi = 0; fi < offsets.length; fi++) {
          const dist = v.length * offsets[fi];
          const wobble = Math.sin(time * 15 + fi * 2.1 + v.y) * 3.5;
          const fx = v.x + cos * dist - sin * wobble;
          const fy = v.y + sin * dist + cos * wobble;
          const outerSize = (22 + Math.sin(time * 16 + fi * 1.7) * 5) * sinkScale;
          const midSize = outerSize * 0.76;
          const coreSize = outerSize * 0.48;
          this.#pushQuad(fx - outerSize * 0.5, fy - outerSize * 0.5, outerSize, outerSize, 0, 'circle', [0.96, 0.16, 0.04, 0.9]);
          this.#pushQuad(fx - midSize * 0.5, fy - midSize * 0.5, midSize, midSize, 0, 'circle', [1, 0.48, 0.05, 0.94]);
          this.#pushQuad(fx - coreSize * 0.5, fy - coreSize * 0.5, coreSize, coreSize, 0, 'circle', [1, 0.92, 0.22, 0.96]);
        }
      }
      if (v.kind === 'moto' && v.driver === 'npc') {
        const riderScale = sinkScale;
        const riderAlpha = v.sinkAlpha ?? 1;
        const cos = Math.cos(v.angle);
        const sin = Math.sin(v.angle);
        const seed = (v.id?.charCodeAt(v.id.length - 1) || 0) + (v.id?.charCodeAt(v.id.length - 2) || 0);
        const jacketPalette = [
          [0.14, 0.16, 0.2, riderAlpha],
          [0.52, 0.14, 0.16, riderAlpha],
          [0.18, 0.34, 0.56, riderAlpha],
          [0.24, 0.32, 0.22, riderAlpha],
          [0.42, 0.26, 0.14, riderAlpha]
        ];
        const helmetPalette = [
          [0.92, 0.94, 0.97, riderAlpha],
          [0.12, 0.13, 0.16, riderAlpha],
          [0.88, 0.2, 0.18, riderAlpha],
          [0.95, 0.74, 0.16, riderAlpha],
          [0.2, 0.56, 0.88, riderAlpha]
        ];
        const jacketColor = jacketPalette[seed % jacketPalette.length];
        const helmetColor = helmetPalette[(seed * 3) % helmetPalette.length];
        const drawRiderPart = (fwd, side, w, h, tex, col) => {
          const px = v.x + (cos * fwd - sin * side) * riderScale;
          const py = v.y + (sin * fwd + cos * side) * riderScale;
          this.#pushQuad(px - w * 0.5 * riderScale, py - h * 0.5 * riderScale, w * riderScale, h * riderScale, v.angle, tex, col);
        };

        // Farol dianteiro sutil
        drawRiderPart(v.length * 0.52, 0, 12, 10, 'circle', [1, 0.94, 0.72, 0.28 * riderAlpha]);
        // Pernas apoiadas nas laterais da moto
        drawRiderPart(1, -6.5, 9, 4.5, 'solid', [0.12, 0.15, 0.22, riderAlpha]);
        drawRiderPart(1, 6.5, 9, 4.5, 'solid', [0.12, 0.15, 0.22, riderAlpha]);
        // Braços estendidos até o guidão
        drawRiderPart(6.5, -6, 9, 3.8, 'solid', jacketColor);
        drawRiderPart(6.5, 6, 9, 3.8, 'solid', jacketColor);
        // Luvas no guidão
        drawRiderPart(10.5, -6.2, 4, 3.8, 'disc', [0.1, 0.1, 0.12, riderAlpha]);
        drawRiderPart(10.5, 6.2, 4, 3.8, 'disc', [0.1, 0.1, 0.12, riderAlpha]);
        // Tronco e ombros arredondados (jaqueta)
        drawRiderPart(-1.5, 0, 14, 17, 'disc', jacketColor);
        // Capacete e viseira frontal escura
        drawRiderPart(1.5, 0, 11.5, 11.5, 'disc', helmetColor);
        drawRiderPart(5.2, 0, 4.5, 8.2, 'disc', [0.08, 0.11, 0.16, riderAlpha]);
      }
    }

    // Pedestres NPC (mesma silhueta do jogador com braços/pernas animados e cores variadas)
    for (const ped of pedestrians) {
      if (ped.x < minX || ped.x > maxX || ped.y < minY || ped.y > maxY) continue;
      const skin = ped.skinColor || [0.92, 0.72, 0.52, 1];
      const hair = ped.hairColor || [0.16, 0.12, 0.1, 1];
      const pants = ped.pantsColor || [0.15, 0.22, 0.35, 1];
      const cos = Math.cos(ped.angle);
      const sin = Math.sin(ped.angle);
      if (ped.state === 'downed') {
        const drawDownedPart = (fwd, side, w, h, rotOffset, tex, col) => {
          const px = ped.x + cos * fwd - sin * side;
          const py = ped.y + sin * fwd + cos * side;
          this.#pushQuad(px - w * 0.5, py - h * 0.5, w, h, ped.angle + rotOffset, tex, col);
        };
        const shoeCol = [0.1, 0.1, 0.12, 1];
        const outlineCol = [0.12, 0.16, 0.22, 1];
        // Sombra suave no chão
        drawDownedPart(-1, 0, 34, 18, 0, 'circle', [0, 0, 0, 0.28]);
        // Pernas levemente abertas e sapatos
        drawDownedPart(-8.5, -3.4, 12, 4.8, 0.18, 'solid', pants);
        drawDownedPart(-14.2, -4.4, 4.8, 4.2, 0.18, 'disc', shoeCol);
        drawDownedPart(-8.2, 3.6, 12, 4.8, -0.22, 'solid', pants);
        drawDownedPart(-13.8, 4.8, 4.8, 4.2, -0.22, 'disc', shoeCol);
        // Braços esparramados nas laterais com mãos
        drawDownedPart(3.5, -7.8, 9.5, 3.8, -0.65, 'solid', skin);
        drawDownedPart(6.5, -10.6, 4.2, 4.2, 0, 'disc', skin);
        drawDownedPart(2.0, 8.0, 9.5, 3.8, 0.55, 'solid', skin);
        drawDownedPart(5.2, 10.6, 4.2, 4.2, 0, 'disc', skin);
        // Tronco (camisa) com contorno
        drawDownedPart(0.8, 0, 14.5, 13.5, 0, 'disc', outlineCol);
        drawDownedPart(0.8, 0, 12.5, 11.5, 0, 'disc', ped.color);
        // Cabeça tombada e cabelo
        drawDownedPart(9.8, 0.4, 9.6, 9.6, 0, 'disc', outlineCol);
        drawDownedPart(10.0, 0.4, 8.2, 8.2, 0, 'disc', skin);
        drawDownedPart(8.6, -0.6, 7.2, 7.0, 0, 'disc', hair);
      } else {
        const swing = Math.sin(ped.walkPhase || 0) * 6;
        const drawPedLimb = (forwardOffset, sideOffset, w, h, col) => {
          const lx = ped.x + (cos * forwardOffset - sin * sideOffset);
          const ly = ped.y + (sin * forwardOffset + cos * sideOffset);
          this.#pushQuad(lx - w * 0.5, ly - h * 0.5, w, h, ped.angle, 'solid', col);
        };
        // Pernas alternadas
        drawPedLimb(swing, -5, 9, 6, pants);
        drawPedLimb(-swing, 5, 9, 6, pants);
        // Braços alternados (opostos às pernas)
        drawPedLimb(-swing * 0.85 + 2, -11, 8, 5, skin);
        drawPedLimb(swing * 0.85 + 2, 11, 8, 5, skin);
        const hs = ped.hopScale ?? 1;
        // Sombra, contorno dos ombros, camisa, rosto e cabelo
        this.#pushQuad(ped.x - 9, ped.y - 9, 20, 20, 0, 'circle', [0, 0, 0, 0.35]);
        this.#pushQuad(ped.x - 9.5 * hs, ped.y - 9.5 * hs, 19 * hs, 19 * hs, 0, 'circle', [0.12, 0.16, 0.22, 1]);
        this.#pushQuad(ped.x + cos * 2 - 6.5 * hs, ped.y + sin * 2 - 6.5 * hs, 13 * hs, 13 * hs, 0, 'circle', ped.color);
        this.#pushQuad(ped.x + cos * 5.2 - 3.8 * hs, ped.y + sin * 5.2 - 3.8 * hs, 7.6 * hs, 7.6 * hs, 0, 'circle', skin);
        this.#pushQuad(ped.x + cos * 4.0 - 3.6 * hs, ped.y + sin * 4.0 - 3.6 * hs, 7.2 * hs, 7.2 * hs, 0, 'circle', hair);
      }
    }

    const pendingCustomQuads = [];
    const isCoveredByClosedRoof = (px, py) => closedRoofs.some(
      (r) => (r.alpha ?? 1) > 0.5 && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
    );

    // Personagens de missões já concluídas e NPCs fixos de encontros extras
    for (const pt of completedNpcPoints) {
      if (pt.x < minX || pt.x > maxX || pt.y < minY || pt.y > maxY) continue;
      const isPlayerInsideEncounter = Boolean(
        !player.inVehicleId && pt.location && player.insideLocationCode === pt.location,
      );
      this.#drawStoryNpc(
        pt.x,
        pt.y,
        time,
        isPlayerInsideEncounter,
        pt.spriteTop || '',
        pt.angle ?? Math.PI * 0.5,
        pendingCustomQuads,
        isCoveredByClosedRoof(pt.x, pt.y)
      );
      if (isPlayerInsideEncounter) {
        this.#drawNpcWaves(pt.x, pt.y, time);
      }
    }

    // Boneco do personagem de destino (dentro do estabelecimento ou no ponto de encontro)
    const npcMarker = objectiveNpcPoint || objectivePoint;
    if (npcMarker) {
      this.#drawStoryNpc(
        npcMarker.x,
        npcMarker.y,
        time,
        true,
        npcMarker.spriteTop || '',
        npcMarker.angle ?? Math.PI * 0.5,
        pendingCustomQuads,
        isCoveredByClosedRoof(npcMarker.x, npcMarker.y)
      );
    }

    // Telhados fechados cobrem pessoas dentro dos prédios quando o jogador está fora
    // Copas das árvores por cima das pessoas (ficam transparentes quando a protagonista passa embaixo)
    for (const t of visibleTrees) {
      const d = Math.hypot(player.x - t.x, player.y - t.y);
      const alpha = d < t.r + 16 ? 0.38 : 1;
      const sway = Math.sin(time * 1.3 + t.x * 0.05) * 0.04;
      if (this.view3d) {
        // copa no alto: tronco ligando o chão até a copa projetada
        const z = t.bush ? 10 : 34;
        const [cx, cy] = this.#project(t.x, t.y, z, camera);
        const k = CAMERA_HEIGHT / (CAMERA_HEIGHT - z);
        if (!t.bush) {
          const ang = Math.atan2(cy - t.y, cx - t.x);
          const len = Math.hypot(cx - t.x, cy - t.y);
          if (len > 1) this.#pushQuad((t.x + cx) / 2 - len / 2, (t.y + cy) / 2 - 3, len, 6, ang, 'solid', [0.4, 0.27, 0.15, alpha]);
        }
        const s = t.r * 2.3 * k;
        this.#pushQuad(cx - s * 0.5, cy - s * 0.5, s, s, t.rot + sway, t.uv, [1, 1, 1, alpha]);
      } else {
        const s = t.r * 2.3;
        this.#pushQuad(t.x - s * 0.5, t.y - s * 0.5, s, s, t.rot + sway, t.uv, [1, 1, 1, alpha]);
      }
    }

    this.windowLights = [];
    // Visão 2.5D: prédios mais distantes da câmera primeiro, para os mais perto ficarem na frente
    const roofOrder = this.view3d
      ? [...closedRoofs].sort((a, b) =>
        Math.hypot(b.x + b.w / 2 - camera.x, b.y + b.h / 2 - camera.y) -
        Math.hypot(a.x + a.w / 2 - camera.x, a.y + a.h / 2 - camera.y))
      : closedRoofs;
    for (const flatRoof of roofOrder) {
      const ra = flatRoof.alpha ?? 1;
      const roof = this.view3d ? this.#drawBuildingWalls(flatRoof, camera, ra) : flatRoof;
      this.#pushQuad(roof.x, roof.y, roof.w, roof.h, 0, 'roof', roof.color);
      this.#drawRoofDetails(roof, ra);
      if (roof.isHospital) {
        const crossLen = Math.min(roof.w, roof.h) * 0.56;
        const armThick = Math.max(10, Math.round(crossLen * 0.3));
        const cx = roof.x + roof.w * 0.5;
        const cy = roof.y + roof.h * 0.5;
        const red = [0.88, 0.14, 0.18, ra];
        this.#pushQuad(cx - armThick * 0.5, cy - crossLen * 0.5, armThick, crossLen, 0, 'solid', red);
        this.#pushQuad(cx - crossLen * 0.5, cy - armThick * 0.5, crossLen, armThick, 0, 'solid', red);
      } else if (roof.isEncounter) {
        const logoEntry = roof.roofLogo ? this.#getOrLoadLogoTexture(roof.roofLogo) : null;
        if (logoEntry && logoEntry.loaded && logoEntry.texture) {
          const maxBox = Math.min(roof.w, roof.h) * 0.62;
          const aspect = logoEntry.width / Math.max(1, logoEntry.height);
          const lw = aspect >= 1 ? maxBox : maxBox * aspect;
          const lh = aspect >= 1 ? maxBox / aspect : maxBox;
          pendingCustomQuads.push({
            cx: roof.x + roof.w * 0.5,
            cy: roof.y + roof.h * 0.5,
            w: lw,
            h: lh,
            angle: 0,
            entry: logoEntry,
            alpha: ra,
          });
        } else {
          const cx = roof.x + roof.w * 0.5;
          const cy = roof.y + roof.h * 0.5;
          const markH = Math.min(roof.w, roof.h) * 0.52;
          const thick = Math.max(8, Math.round(markH * 0.22));
          const barH = Math.max(12, Math.round(markH * 0.62));
          const dotSize = Math.max(8, Math.round(thick * 1.05));
          const gap = Math.max(5, Math.round(markH * 0.1));
          const totalH = barH + gap + dotSize;
          const topY = cy - totalH * 0.5;
          const white = [1, 1, 1, ra];
          this.#pushQuad(cx - thick * 0.5, topY, thick, barH, 0, 'solid', white);
          this.#pushQuad(cx - dotSize * 0.5, topY + barH + gap, dotSize, dotSize, 0, 'disc', white);
        }
      }
    }

    // Ondas circulares estilo sinal Wi-Fi ao redor do personagem de destino (visíveis mesmo com teto fechado)
    if (npcMarker && emitNpcWaves) {
      this.#drawNpcWaves(npcMarker.x, npcMarker.y, time);
    }

    // GPS: seta amarela girando em volta da protagonista, apontando para o objetivo
    const gpsTarget = gpsPoint || objectivePoint || objectiveNpcPoint;
    if (gpsTarget && this.showGpsArrow !== false) {
      const dx = gpsTarget.x - camera.x;
      const dy = gpsTarget.y - camera.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 220) {
        const angle = Math.atan2(dy, dx);
        const radius = (player.inVehicleId ? 62 : 44) + Math.sin(time * 5) * 3;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const ax = camera.x + cos * radius;
        const ay = camera.y + sin * radius;
        const fade = Math.min(1, (dist - 220) / 160);
        const gpsColor = [1, 0.8, 0.12, 0.85 * fade];
        const gpsOutline = [0.08, 0.06, 0.02, 0.55 * fade];
        const part = (lx, ly, w, h, rot, color) => {
          const wx = ax + cos * lx - sin * ly;
          const wy = ay + sin * lx + cos * ly;
          this.#pushQuad(wx - w * 0.5, wy - h * 0.5, w, h, angle + rot, 'solid', color);
        };
        // contorno escuro (um pouco maior) e depois a seta
        part(-4, 0, 16, 9, 0, gpsOutline);
        part(5, -5, 16, 8, 0.75, gpsOutline);
        part(5, 5, 16, 8, -0.75, gpsOutline);
        part(-4, 0, 13, 6, 0, gpsColor);
        part(5, -5, 13, 5, 0.75, gpsColor);
        part(5, 5, 13, 5, -0.75, gpsColor);
      }
    }

    // Jogador a pé ou montado em moto (que não possui teto)
    const playerVehicle = player.inVehicleId ? vehicles.find((v) => v.id === player.inVehicleId) : null;
    const ridingMoto = Boolean(playerVehicle && playerVehicle.kind === 'moto');

    // Parceira: a pé ao lado da protagonista ou na garupa da moto
    if (partner && partner.visible) {
      const onMoto = partner.state === 'riding' && ridingMoto;
      const ang = onMoto ? playerVehicle.angle : partner.angle;
      const cx = onMoto ? playerVehicle.x - Math.cos(ang) * 10 : partner.x;
      const cy = onMoto ? playerVehicle.y - Math.sin(ang) * 10 : partner.y;
      if (cx > minX && cx < maxX && cy > minY && cy < maxY && !isCoveredByClosedRoof(cx, cy)) {
        const ps = partner.sprites || {};
        const skin = hexToRgb01(ps.skinColor);
        const sleeve = hexToRgb01(ps.sleeveColor, skin);
        const pants = hexToRgb01(ps.pantsColor, [0.16, 0.23, 0.36]);
        const shoes = hexToRgb01(ps.shoeColor, [0.88, 0.91, 0.96]);
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const limb = (fwd, side, w, h, col, rot = 0) => {
          const lx = cx + cos * fwd - sin * side;
          const ly = cy + sin * fwd + cos * side;
          this.#pushQuad(lx - w * 0.5, ly - h * 0.5, w, h, ang + rot, 'disc', [col[0], col[1], col[2], 1]);
        };
        if (!onMoto) {
          this.#pushQuad(cx + 3 - 21, cy + 5 - 21, 42, 42, 0, 'softshadow', [0, 0, 0, 0.32]);
        }
        const swing = !onMoto && partner.speed > 5 ? Math.sin(partner.walkPhase || 0) * 6 : 0;
        if (onMoto) {
          limb(1, -7, 8.2, 5.4, pants); limb(1, 7, 8.2, 5.4, pants);
          limb(4, -9, 7.5, 4.4, sleeve, 0.5); limb(4, 9, 7.5, 4.4, sleeve, -0.5);
        } else {
          limb(swing, -5, 8.2, 5.4, pants); limb(swing + 3.8, -5, 5.2, 4.6, shoes);
          limb(-swing, 5, 8.2, 5.4, pants); limb(-swing + 3.8, 5, 5.2, 4.6, shoes);
          limb(-swing * 0.85 + 2, -11, 7.5, 4.4, sleeve); limb(-swing * 0.85 + 5.6, -11, 4.8, 4.8, skin);
          limb(swing * 0.85 + 2, 11, 7.5, 4.4, sleeve); limb(swing * 0.85 + 5.6, 11, 4.8, 4.8, skin);
        }
        const entry = ps.top ? this.#getOrLoadLogoTexture(ps.top) : null;
        if (entry && entry.loaded && entry.texture) {
          const aspect = entry.width / Math.max(1, entry.height);
          pendingCustomQuads.push({ cx, cy, w: 56 * aspect, h: 56, angle: ang - Math.PI * 0.5, entry, alpha: 1 });
        } else {
          this.#pushQuad(cx - 9, cy - 9, 18, 18, 0, 'disc', [0.17, 0.42, 0.26, 1]);
          this.#pushQuad(cx - 5, cy - 5, 10, 10, 0, 'disc', [0.5, 0.37, 0.22, 1]);
        }
      }
    }

    if (!player.inVehicleId || ridingMoto) {
      const pScale = ridingMoto
        ? (playerVehicle.sinkScale ?? 1)
        : (player.sinkScale ?? 1) * (player.entryScale ?? 1);
      const pAlpha = ridingMoto
        ? (playerVehicle.sinkAlpha ?? 1)
        : (player.sinkAlpha ?? 1) * (player.entryAlpha ?? 1);
      if (!ridingMoto && player.sinkProgress > 0) {
        const ring = 20 + player.sinkProgress * 28;
        this.#pushQuad(player.x - ring * 0.5, player.y - ring * 0.5, ring, ring, 0, 'solid', [0.75, 0.92, 1, (1 - player.sinkProgress) * 0.5]);
      }
      const swing = !ridingMoto && player.speed > 5 && !player.ejected?.active ? Math.sin(player.walkPhase || 0) * 6 : 0;
      const cos = Math.cos(player.angle);
      const sin = Math.sin(player.angle);
      const skinRgb = hexToRgb01(playerSprites?.skinColor);
      const sleeveRgb = hexToRgb01(playerSprites?.sleeveColor, skinRgb);
      const pantsRgb = hexToRgb01(playerSprites?.pantsColor, [0.16, 0.23, 0.36]);
      const shoeRgb = hexToRgb01(playerSprites?.shoeColor, [0.88, 0.91, 0.96]);
      // Sombra suave sob o personagem a pé
      if (!ridingMoto && !(player.sinkProgress > 0)) {
        this.#pushQuad(player.x + 3 - 21 * pScale, player.y + 5 - 21 * pScale, 42 * pScale, 42 * pScale, 0, 'softshadow', [0, 0, 0, 0.32 * pAlpha]);
      }
      const drawLimb = (forwardOffset, sideOffset, w, h, color, rotOffset = 0, tex = 'solid') => {
        const lx = player.x + (cos * forwardOffset - sin * sideOffset) * pScale;
        const ly = player.y + (sin * forwardOffset + cos * sideOffset) * pScale;
        this.#pushQuad(lx - w * 0.5 * pScale, ly - h * 0.5 * pScale, w * pScale, h * pScale, player.angle + rotOffset, tex, [color[0], color[1], color[2], pAlpha]);
      };
      const drawArm = (fwd, side, rotOffset = 0) => {
        const aCos = Math.cos(rotOffset);
        const aSin = Math.sin(rotOffset);
        drawLimb(fwd, side, 7.5, 4.4, sleeveRgb, rotOffset, 'disc');
        drawLimb(fwd + 3.6 * aCos, side + 3.6 * aSin, 4.8, 4.8, skinRgb, rotOffset, 'disc');
      };
      const drawLeg = (fwd, side, rotOffset = 0) => {
        const aCos = Math.cos(rotOffset);
        const aSin = Math.sin(rotOffset);
        drawLimb(fwd, side, 8.2, 5.4, pantsRgb, rotOffset, 'disc');
        drawLimb(fwd + 3.8 * aCos, side + 3.8 * aSin, 5.2, 4.6, shoeRgb, rotOffset, 'disc');
      };

      const isFallen = Boolean((player.isDead || (player.knockdownTimer || 0) > 0) && !ridingMoto);
      const wantFallenFront = Boolean(isFallen && playerSprites?.front);
      const customSpriteUrl = wantFallenFront ? playerSprites.front : (playerSprites?.top || '');
      const customSpriteEntry = customSpriteUrl ? this.#getOrLoadLogoTexture(customSpriteUrl) : null;
      const hasCustomSprite = Boolean(customSpriteEntry && customSpriteEntry.loaded && customSpriteEntry.texture);

      if (ridingMoto) {
        // Braços estendidos segurando o guidão
        drawArm(7.5, -7.2, 0.15);
        drawArm(7.5, 7.2, -0.15);
      } else if (isFallen) {
        // Braços e pernas padrão esparramados ao cair no chão
        drawLeg(-9.5, -4.5, 2.85);
        drawLeg(-9.5, 4.5, -2.85);
        drawArm(3.0, -10.5, -0.65);
        drawArm(2.2, 10.5, 0.6);
      } else {
        // Pernas alternadas com calça arredondada e tênis
        drawLeg(swing, -5.0, 0);
        drawLeg(-swing, 5.0, 0);
        const armedWith = player.weaponId && player.weaponId !== 'punhos' ? player.weaponId : null;
        if (armedWith) {
          // Pose de mira: braços para a frente segurando a arma
          const gunLen = armedWith === 'escopeta' ? 19 : armedWith === 'submetralhadora' ? 14 : 9;
          drawLimb(15 + gunLen * 0.5, 3, gunLen, 3.4, [0.1, 0.1, 0.12], 0, 'solid');
          if (armedWith !== 'pistola') drawLimb(13, 3, 5, 4.6, [0.16, 0.16, 0.19], 0, 'solid');
          drawArm(7, -6.5, 0.55);
          drawArm(8, 7.5, -0.35);
        } else {
          // Braços alternados (opostos às pernas) com antebraço e mão na cor da pele
          drawArm(-swing * 0.85 + 2.0, -11.0, 0);
          drawArm(swing * 0.85 + 2.0, 11.0, 0);
        }
      }

      if (hasCustomSprite) {
        const aspect = customSpriteEntry.width / Math.max(1, customSpriteEntry.height);
        const boxH = (wantFallenFront ? 48 : 56) * pScale;
        const boxW = boxH * aspect;
        pendingCustomQuads.push({
          cx: player.x,
          cy: player.y,
          w: boxW,
          h: boxH,
          angle: player.angle - Math.PI * 0.5,
          entry: customSpriteEntry,
          alpha: pAlpha,
        });
      } else {
        this.#pushQuad(player.x - 14 * pScale, player.y - 14 * pScale, 28 * pScale, 28 * pScale, player.angle, 'player', [1, 1, 1, pAlpha]);
      }
    }

    // Semáforos com luz sutil verde/vermelha emanando dos dois lados
    if (cityMap.trafficLights) {
      for (const light of cityMap.trafficLights) {
        if (light.x + 24 < minX || light.x - 24 > maxX || light.y + 24 < minY || light.y - 24 > maxY) continue;
        const state = cityMap.getTrafficLightState(light, time);
        const isGreen = state === 'green';
        const glowColor = isGreen ? [0.18, 0.95, 0.42, 0.22] : [0.98, 0.22, 0.18, 0.22];
        const coreColor = isGreen ? [0.32, 1.0, 0.52, 0.72] : [1.0, 0.32, 0.26, 0.72];

        // Luz sutil saindo dos dois lados do semáforo
        if (light.axis === 'v') {
          this.#pushQuad(light.x - 9, light.y - 19, 18, 18, 0, 'circle', glowColor);
          this.#pushQuad(light.x - 9, light.y + 1, 18, 18, 0, 'circle', glowColor);
          this.#pushQuad(light.x - 2, light.y - 7, 4, 4, 0, 'circle', coreColor);
          this.#pushQuad(light.x - 2, light.y + 3, 4, 4, 0, 'circle', coreColor);
          this.#pushQuad(light.x - 5, light.y - 4, 10, 8, 0, 'solid', [0.14, 0.16, 0.2, 1]);
        } else {
          this.#pushQuad(light.x - 19, light.y - 9, 18, 18, 0, 'circle', glowColor);
          this.#pushQuad(light.x + 1, light.y - 9, 18, 18, 0, 'circle', glowColor);
          this.#pushQuad(light.x - 7, light.y - 2, 4, 4, 0, 'circle', coreColor);
          this.#pushQuad(light.x + 3, light.y - 2, 4, 4, 0, 'circle', coreColor);
          this.#pushQuad(light.x - 4, light.y - 5, 8, 10, 0, 'solid', [0.14, 0.16, 0.2, 1]);
        }
      }
    }

    // Fumaça (cinza/preta) e partículas de fogo (amarelo/laranja/vermelho)
    for (const p of smokeParticles) {
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      const fade = 1 - p.life / p.maxLife;
      const rgba = p.color
        ? [p.color[0], p.color[1], p.color[2], p.alpha * fade]
        : [p.dark, p.dark, p.dark, p.alpha * fade];
      this.#pushQuad(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size, p.life * 2, 'circle', rgba);
    }

    for (const ex of explosions) {
      const progress = Math.min(1, ex.timer / ex.duration);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const alpha = 1 - progress;

      // Círculo de deslocamento de ar (onda de choque que se expande e se desfaz)
      const shockDuration = ex.shockDuration || ex.duration * 0.65;
      const shockProgress = Math.min(1, ex.timer / shockDuration);
      if (shockProgress < 1) {
        const shockRadius = ex.shockRadius || (ex.shockMaxRadius || ex.radius * 1.6) * (1 - Math.pow(1 - shockProgress, 2.2));
        const shockDiameter = shockRadius * 2;
        const shockAlpha = Math.pow(1 - shockProgress, 1.35) * 0.88;
        this.#pushQuad(
          ex.x - shockRadius,
          ex.y - shockRadius,
          shockDiameter,
          shockDiameter,
          0,
          'shockwave',
          [1, 0.92, 0.78, shockAlpha]
        );
        // Anel interno de pressão secundário
        if (shockProgress > 0.08) {
          const innerR = shockRadius * 0.74;
          this.#pushQuad(
            ex.x - innerR,
            ex.y - innerR,
            innerR * 2,
            innerR * 2,
            0,
            'shockwave',
            [1, 0.68, 0.3, shockAlpha * 0.52]
          );
        }
      }

      // Clarão inicial quente
      if (progress < 0.32) {
        const flashAlpha = (1 - progress / 0.32) * 0.78;
        const flashSize = ex.radius * (0.9 + progress * 2.2);
        this.#pushQuad(
          ex.x - flashSize * 0.5,
          ex.y - flashSize * 0.5,
          flashSize,
          flashSize,
          0,
          'circle',
          [1, 0.88, 0.45, flashAlpha]
        );
      }

      // Bolas de fogo dinâmicas que se expandem e esfriam para fumaça escura
      const lobes = ex.lobes || [
        { angle: 0.2, distScale: 0.35, sizeScale: 0.85, delay: 0 },
        { angle: 1.7, distScale: 0.38, sizeScale: 0.8, delay: 0.04 },
        { angle: 3.3, distScale: 0.34, sizeScale: 0.85, delay: 0.08 },
        { angle: 4.9, distScale: 0.4, sizeScale: 0.75, delay: 0.03 }
      ];
      for (const lobe of lobes) {
        const lp = Math.max(0, Math.min(1, (progress - lobe.delay) / (1 - lobe.delay)));
        if (lp <= 0 || lp >= 1) continue;
        const lEase = 1 - Math.pow(1 - lp, 2.4);
        const offset = ex.radius * lobe.distScale * lEase;
        const fx = ex.x + Math.cos(lobe.angle) * offset;
        const fy = ex.y + Math.sin(lobe.angle) * offset;
        const lobeSize = ex.radius * lobe.sizeScale * Math.sin(lp * Math.PI);
        if (lobeSize > 2) {
          const cool = Math.min(1, lp * 1.25);
          const rCol = 0.98 * (1 - cool * 0.72);
          const gCol = 0.55 * (1 - cool * 0.85);
          const bCol = 0.1 * (1 - cool * 0.4);
          this.#pushQuad(
            fx - lobeSize * 0.5,
            fy - lobeSize * 0.5,
            lobeSize,
            lobeSize,
            lobe.angle,
            'circle',
            [rCol, gCol, bCol, (1 - lp) * 0.88]
          );
        }
      }

      // Núcleo branco-amarelado brilhante
      const coreSize = ex.radius * 0.92 * Math.sin(Math.min(1, progress * 1.55) * Math.PI);
      if (coreSize > 2 && progress < 0.65) {
        const coreAlpha = (1 - progress / 0.65) * 0.95;
        this.#pushQuad(ex.x - coreSize * 0.5, ex.y - coreSize * 0.5, coreSize, coreSize, 0, 'circle', [1, 0.95, 0.58, coreAlpha]);
      }

      // Faíscas radiantes de alta velocidade
      if (progress < 0.78) {
        const sparks = ex.sparks || [];
        const spAlpha = (1 - progress / 0.78) * 0.95;
        for (const sp of sparks) {
          const dist = ex.radius * (0.14 + easeOut * 1.35 * sp.speed);
          const sx = ex.x + Math.cos(sp.angle) * dist;
          const sy = ex.y + Math.sin(sp.angle) * dist;
          const sz = sp.size * (1 - progress * 0.65);
          this.#pushQuad(sx - sz * 0.5, sy - sz * 0.5, sz, sz, sp.angle, 'circle', [1, 0.84, 0.25, spAlpha]);
        }
      }
    }

    // Rastros das balas, clarão do cano e faíscas de impacto
    for (const b of bullets) {
      const dx = b.x - (b.prevX ?? b.x);
      const dy = b.y - (b.prevY ?? b.y);
      const len = Math.max(6, Math.hypot(dx, dy));
      const mx = b.x - dx * 0.5;
      const my = b.y - dy * 0.5;
      this.#pushQuad(mx - len * 0.5, my - 1.1, len, 2.2, Math.atan2(dy, dx), 'solid', [1, 0.9, 0.55, 0.9]);
    }
    for (const fx of weaponFx) {
      const t = fx.life / fx.maxLife;
      if (fx.kind === 'muzzle') {
        const s = 16 * (1 - t * 0.4);
        this.#pushQuad(fx.x - s * 0.5, fx.y - s * 0.3, s, s * 0.6, fx.angle, 'circle', [1, 0.85, 0.4, 0.95 * (1 - t)]);
        this.#pushQuad(fx.x - 4, fx.y - 4, 8, 8, 0, 'circle', [1, 1, 0.9, 1 - t]);
      } else {
        const s = (fx.kind === 'hit' ? 12 : 9) * (0.6 + t);
        const col = fx.kind === 'hit' ? [1, 1, 1, 0.8 * (1 - t)] : [1, 0.8, 0.3, 0.9 * (1 - t)];
        this.#pushQuad(fx.x - s * 0.5, fx.y - s * 0.5, s, s, 0, 'circle', col);
      }
    }

    gl.clearColor(0.08, 0.09, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform2f(this.locResolution, this.viewWidth || 800, this.viewHeight || 600);
    gl.uniform2f(this.locCamera, camera.x, camera.y);
    gl.uniform1f(this.locZoom, this.zoom);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData.subarray(0, this.quadCount * 6 * this.floatsPerVertex));
    gl.drawArrays(gl.TRIANGLES, 0, this.quadCount * 6);

    if (pendingCustomQuads.length > 0) {
      const quadVerts = new Float32Array(6 * 8);
      for (const { cx, cy, w, h, angle, entry, alpha } of pendingCustomQuads) {
        const hw = w * 0.5;
        const hh = h * 0.5;
        const cos = Math.cos(angle || 0);
        const sin = Math.sin(angle || 0);
        const p0x = cx + (-hw * cos - -hh * sin);
        const p0y = cy + (-hw * sin + -hh * cos);
        const p1x = cx + (hw * cos - -hh * sin);
        const p1y = cy + (hw * sin + -hh * cos);
        const p2x = cx + (hw * cos - hh * sin);
        const p2y = cy + (hw * sin + hh * cos);
        const p3x = cx + (-hw * cos - hh * sin);
        const p3y = cy + (-hw * sin + hh * cos);
        const verts = [
          p0x, p0y, 0, 0, 1, 1, 1, alpha,
          p1x, p1y, 1, 0, 1, 1, 1, alpha,
          p2x, p2y, 1, 1, 1, 1, 1, alpha,
          p0x, p0y, 0, 0, 1, 1, 1, alpha,
          p2x, p2y, 1, 1, 1, 1, 1, alpha,
          p3x, p3y, 0, 1, 1, 1, 1, alpha,
        ];
        quadVerts.set(verts);
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, quadVerts);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
    }

    this.#renderLighting({ camera, cityMap, vehicles, boats, explosions, player, visibleBlocks, time, weaponFx });
  }
}

// Modelo do carro (sedan, hatch, SUV, picape, esportivo), fixo por veículo.
// v.model é o nome exibido ("Cupê Esportivo"...); a textura escolhida fica em v.texModel.
const CAR_BY_NAME = { 'Cupê Esportivo': 'car-sport', 'Compacto Retrô': 'car-hatch' };
const SEDAN_VARIANTS = ['car', 'car', 'car-suv', 'car-pickup'];
function vehicleUv(v) {
  if (v.kind !== 'car') return v.kind;
  if (v.texModel) return v.texModel;
  if (v.police) return 'car';
  if (v.special) return (v.texModel = 'car-sport');
  let tex = CAR_BY_NAME[v.model];
  if (!tex) {
    const id = String(v.id || '');
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    tex = SEDAN_VARIANTS[h % SEDAN_VARIANTS.length];
  }
  v.texModel = tex;
  return tex;
}

// Árvores e arbustos de cada quarteirão (posição fixa, calculada uma vez)
const decorCache = new WeakMap();
const TREE_UVS = ['tree1', 'tree2', 'tree1', 'tree2', 'tree3'];
function blockDecor(block) {
  let decor = decorCache.get(block);
  if (decor) return decor;
  const b = block.bounds;
  let seed = (Math.round(b.x) * 2654435761) ^ (Math.round(b.y) * 40503);
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const blockers = [];
  for (const bd of block.buildings || []) {
    blockers.push({ ...bd.bounds, pad: 4 });
    if (bd.doormat) blockers.push({ ...bd.doormat, pad: 34 });
  }
  for (const o of block.obstacles || []) blockers.push({ ...o, pad: 4 });
  for (const p of block.plaza?.props || []) blockers.push({ ...p, pad: 10 });
  const clearance = (x, y) => {
    let best = Math.min(x - b.x, b.x + b.w - x, y - b.y, b.y + b.h - y) + 6;
    for (const k of blockers) {
      const dx = Math.max(k.x - k.pad - x, 0, x - (k.x + k.w + k.pad));
      const dy = Math.max(k.y - k.pad - y, 0, y - (k.y + k.h + k.pad));
      const inside = dx === 0 && dy === 0;
      best = Math.min(best, inside ? -1 : Math.hypot(dx, dy));
    }
    return best;
  };
  const trees = [];
  const pb = block.plaza?.bounds;
  const step = 46;
  for (let y = b.y + 16; y < b.y + b.h - 8; y += step) {
    for (let x = b.x + 16; x < b.x + b.w - 8; x += step) {
      const px = x + (rnd() - 0.5) * 12;
      const py = y + (rnd() - 0.5) * 12;
      // deixa livres as esquinas (faixas de pedestre)
      const nearCornerX = px - b.x < 40 || b.x + b.w - px < 40;
      const nearCornerY = py - b.y < 40 || b.y + b.h - py < 40;
      if (nearCornerX && nearCornerY) continue;
      const inPlaza = pb && px > pb.x && px < pb.x + pb.w && py > pb.y && py < pb.y + pb.h;
      if (rnd() > (inPlaza ? 0.8 : 0.42)) continue;
      const cl = clearance(px, py);
      if (cl < 9) continue;
      const bush = cl < 14 || rnd() < 0.18;
      const r = bush ? Math.min(10, cl - 1) : Math.min(22, Math.max(14, cl - 2));
      if (trees.some((t) => Math.hypot(t.x - px, t.y - py) < (t.r + r) * 0.9)) continue;
      trees.push({
        x: px,
        y: py,
        r,
        bush,
        uv: bush ? 'bush' : TREE_UVS[Math.floor(rnd() * TREE_UVS.length)],
        rot: rnd() * Math.PI * 2,
      });
    }
  }
  decor = { trees };
  decorCache.set(block, decor);
  return decor;
}

// ---- Altura dos prédios na visão 2.5D ----
const CAMERA_HEIGHT = 470;
function hash2(a, b) {
  let h = (Math.round(a) * 374761393 + Math.round(b) * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) / 4294967296;
}
function buildingHeight(roof) {
  const r = hash2(roof.x, roof.y);
  if (roof.isHospital || roof.type === 'hospital') return 120;
  if (roof.type === 'house') return 40 + Math.round(r * 2) * 24; // 1 a 3 andares
  return 66 + Math.round(r * 3) * 26; // comércio: 2 a 5 andares
}
