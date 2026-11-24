// Visão 3D completa (Three.js): cidade, veículos e pessoas em 3D com câmera atrás.
// Coordenadas: o jogo usa (x, y) no plano; aqui vira (x, altura, y) — eixo Z do Three = y do jogo.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { blockDecor, buildingHeight } from './webgl-renderer.js?v=51';

const BLOCK_RADIUS = 1500; // distância (em unidades do mundo) em que a cidade é montada

function toColor(c, fallback = '#cccccc') {
  if (Array.isArray(c)) return new THREE.Color(c[0], c[1], c[2]);
  if (typeof c === 'string' && c) {
    try { return new THREE.Color(c); } catch { /* cor inválida */ }
  }
  return new THREE.Color(fallback);
}

function canvasTexture(w, h, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 4;
  return tex;
}

function noise(ctx, w, h, base, n, a) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

export class Renderer3D {
  constructor(hostCanvas, dayCycle) {
    this.host = hostCanvas;
    this.dayCycle = dayCycle;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas-3d';
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;display:none;';
    hostCanvas.insertAdjacentElement('afterend', this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfd8ee, 1100, 3200);

    // reflexos (pintura dos carros, vidros) a partir de um ambiente iluminado
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // céu físico (sol, horizonte, entardecer)
    this.sky = new Sky();
    this.sky.scale.setScalar(4200);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 5;
    su.rayleigh.value = 1.4;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.82;
    this.scene.add(this.sky);
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.3);
    this.camera = new THREE.PerspectiveCamera(58, 1, 2, 9000);
    this.camPos = null;
    this.camLook = new THREE.Vector3();

    // pós-processamento: brilho (bloom) nas luzes + saída com tone mapping
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.5, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x4a4a40, 1.2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -700; sc.right = 700; sc.top = 700; sc.bottom = -700; sc.near = 10; sc.far = 2400;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // farol do carro da protagonista (à noite)
    this.headlight = new THREE.SpotLight(0xfff3c4, 0, 520, 0.5, 0.6, 1.2);
    this.scene.add(this.headlight);
    this.scene.add(this.headlight.target);

    this.#buildMaterials();
    // texturas fotográficas (Poly Haven, CC0) — o motor espera isto antes de mostrar o 3D
    this.ready = Promise.all([
      this.#loadPhotoTextures().catch((err) => console.warn('[3D] Texturas fotográficas indisponíveis:', err)),
      this.#loadCarModels().catch((err) => console.warn('[3D] Modelos de carro indisponíveis:', err)),
      this.#loadPeople().catch((err) => console.warn('[3D] Personagens 3D indisponíveis:', err)),
    ]);
    this.blockGroups = new Map();
    this.vehicleMeshes = new Map();
    this.pedMeshes = new Map();
    this.extraFigures = new Map();
    this.groundBuilt = false;
    this.active = false;
    this.lastW = 0;
    this.lastH = 0;
  }

  setActive(on) {
    this.active = on;
    this.canvas.style.display = on ? 'block' : 'none';
    // o canvas 2D continua recebendo o mouse (mira), só fica invisível
    this.host.style.opacity = on ? '0' : '';
  }

  // ---------- materiais e texturas compartilhados ----------
  #buildMaterials() {
    const asphalt = canvasTexture(256, 256, (c, w, h) => noise(c, w, h, '#3b3e45', 2600, 0.18));
    const sidewalk = canvasTexture(256, 256, (c, w, h) => {
      noise(c, w, h, '#b9bcc2', 1800, 0.12);
      c.strokeStyle = 'rgba(0,0,0,0.18)';
      c.lineWidth = 2;
      for (let i = 0; i <= w; i += 64) {
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke();
        c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke();
      }
    });
    const grass = canvasTexture(256, 256, (c, w, h) => {
      noise(c, w, h, '#5f9e45', 3000, 0.2);
      for (let i = 0; i < 400; i++) {
        c.fillStyle = `rgba(${40 + Math.random() * 40},${110 + Math.random() * 60},${30 + Math.random() * 30},0.6)`;
        c.fillRect(Math.random() * w, Math.random() * h, 2, 5);
      }
    });
    const roof = canvasTexture(128, 128, (c, w, h) => {
      noise(c, w, h, '#ffffff', 900, 0.12);
      c.strokeStyle = 'rgba(0,0,0,0.12)';
      for (let y = 16; y < h; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    });
    // célula de fachada: 1 janela por célula (30 x 26 unidades)
    this.wallTex = canvasTexture(64, 56, (c, w, h) => {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(0,0,0,0.06)';
      c.fillRect(0, h - 6, w, 6);
      c.fillStyle = '#3d5a78';
      c.fillRect(18, 14, 28, 26);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(20, 16, 8, 22);
      c.strokeStyle = '#e8e2d6';
      c.lineWidth = 3;
      c.strokeRect(17, 13, 30, 28);
    });
    this.wallLitTex = canvasTexture(64, 56, (c, w, h) => {
      c.fillStyle = '#000000';
      c.fillRect(0, 0, w, h);
      // só parte das janelas acende (o padrão se repete, mas varia por andar com o offset)
      c.fillStyle = '#ffcf7a';
      c.fillRect(18, 14, 28, 26);
    });

    this.mat = {
      asphalt: new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, metalness: 0 }),
      sidewalk: new THREE.MeshStandardMaterial({ map: sidewalk, roughness: 0.85, metalness: 0 }),
      grass: new THREE.MeshLambertMaterial({ map: grass }),
      water: new THREE.MeshPhongMaterial({ color: 0x2e7fb8, shininess: 80, specular: 0x88bbff }),
      stripe: new THREE.MeshBasicMaterial({ color: 0xf2c838 }),
      crosswalk: new THREE.MeshBasicMaterial({ color: 0xf1f3f6 }),
      curb: new THREE.MeshLambertMaterial({ color: 0x8b9098 }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x6b4a2c }),
      leaves: [
        new THREE.MeshLambertMaterial({ color: 0x3f9a42 }),
        new THREE.MeshLambertMaterial({ color: 0x2e8a5f }),
        new THREE.MeshLambertMaterial({ color: 0x55993a }),
      ],
      palm: new THREE.MeshLambertMaterial({ color: 0x3fa84a, side: THREE.DoubleSide }),
      glass: new THREE.MeshStandardMaterial({ color: 0x0f1620, metalness: 0.9, roughness: 0.06, envMapIntensity: 1.6 }),
      tire: new THREE.MeshLambertMaterial({ color: 0x141518 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xc9ced5, metalness: 0.9, roughness: 0.25 }),
      headlight: new THREE.MeshBasicMaterial({ color: 0xfff6cf }),
      taillight: new THREE.MeshBasicMaterial({ color: 0xe0241b }),
      sirenRed: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
      sirenBlue: new THREE.MeshBasicMaterial({ color: 0x2a6bff }),
      door: new THREE.MeshLambertMaterial({ color: 0x5a3a22 }),
      awning: new THREE.MeshLambertMaterial({ color: 0xc8372f }),
      ac: new THREE.MeshLambertMaterial({ color: 0xc9ccd1 }),
      beacon: new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.35, depthWrite: false }),
      beaconRing: new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      bullet: new THREE.MeshBasicMaterial({ color: 0xffe08a }),
      fire: new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.8, depthWrite: false }),
      lampPole: new THREE.MeshLambertMaterial({ color: 0x3a3f47 }),
      lampBulb: new THREE.MeshBasicMaterial({ color: 0xfff1c1 }),
      contact: new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        alphaMap: canvasTexture(64, 64, (c, w, h) => {
          const gr = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
          gr.addColorStop(0, '#ffffff');
          gr.addColorStop(0.55, '#888888');
          gr.addColorStop(1, '#000000');
          c.fillStyle = gr;
          c.fillRect(0, 0, w, h);
        }, false),
      }),
    };
    this.roofTex = roof;

    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      wheel: new THREE.CylinderGeometry(1, 1, 1, 14),
      sphere: new THREE.SphereGeometry(1, 14, 10),
      canopy: new THREE.IcosahedronGeometry(1, 1),
      trunk: new THREE.CylinderGeometry(0.7, 1, 1, 7),
      cone: new THREE.ConeGeometry(1, 1, 8, 1, true),
      beacon: new THREE.CylinderGeometry(1, 1, 1, 24, 1, true),
      ring: new THREE.RingGeometry(0.8, 1, 32),
      gem: new THREE.OctahedronGeometry(1),
      plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    };
  }

  async #loadPhotoTextures() {
    const loader = new THREE.TextureLoader();
    const base = './assets3d/textures/';
    const load = async (name, srgb) => {
      const t = await loader.loadAsync(base + name);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const names = ['asphalt_02', 'concrete_pavement', 'brick_wall_02', 'painted_plaster_wall', 'concrete_floor_02', 'leafy_grass'];
    const tex = {};
    await Promise.all(names.map(async (n) => {
      tex[n] = { diff: await load(`${n}_diff_1k.jpg`, true), nor: await load(`${n}_nor_gl_1k.jpg`, false) };
    }));
    this.photo = tex;

    const setMat = (mat, t, normalScale = 0.8) => {
      mat.map = t.diff;
      mat.normalMap = t.nor;
      mat.normalScale = new THREE.Vector2(normalScale, normalScale);
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    };
    setMat(this.mat.asphalt, tex.asphalt_02, 0.9);
    setMat(this.mat.sidewalk, tex.concrete_pavement, 0.9);
    this.mat.grass = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    setMat(this.mat.grass, tex.leafy_grass, 1);

    // fachada: foto da parede + janela desenhada por cima (1 janela por célula de 30 x 26)
    const compose = (img, glass) => {
      const cv = document.createElement('canvas');
      cv.width = 128;
      cv.height = 112;
      const c = cv.getContext('2d');
      c.drawImage(img, 0, 0, 300, 262, 0, 0, 128, 112);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(30, 84, 72, 6); // sombra do peitoril
      c.fillStyle = '#e9e4da';
      c.fillRect(30, 24, 70, 60); // moldura
      c.fillRect(26, 82, 78, 6); // peitoril
      const gr = c.createLinearGradient(34, 28, 96, 80);
      gr.addColorStop(0, glass[0]);
      gr.addColorStop(1, glass[1]);
      c.fillStyle = gr;
      c.fillRect(34, 28, 62, 52);
      c.fillStyle = 'rgba(255,255,255,0.28)';
      c.beginPath(); c.moveTo(38, 76); c.lineTo(58, 30); c.lineTo(70, 30); c.lineTo(50, 76); c.fill();
      c.fillStyle = '#e9e4da';
      c.fillRect(63, 28, 4, 52); // divisão da janela
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      return t;
    };
    this.wallTexHouse = compose(tex.brick_wall_02.diff.image, ['#2b4561', '#4f7396']);
    this.wallTexShop = compose(tex.painted_plaster_wall.diff.image, ['#24384f', '#5a86ad']);
    // janela acesa à noite na mesma posição da janela desenhada
    this.wallLitTex = canvasTexture(128, 112, (c) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, 128, 112);
      c.fillStyle = '#ffcf7a';
      c.fillRect(34, 28, 62, 52);
    });
  }

  // Carros 3D do Kenney Car Kit (CC0)
  async #loadCarModels() {
    const files = {
      car: 'sedan', 'car-sport': 'sedan-sports', 'car-hatch': 'hatchback-sports', 'car-suv': 'suv',
      'car-pickup': 'suv-luxury', police: 'police', van: 'van', 'van-delivery': 'delivery', special: 'race',
    };
    const img = await new THREE.ImageLoader().loadAsync('./assets3d/cars/Textures/colormap.png');
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const px = cx.getImageData(0, 0, cv.width, cv.height).data;
    const loader = new GLTFLoader();
    const models = {};
    await Promise.all(Object.entries(files).map(async ([key, file]) => {
      const gltf = await loader.loadAsync(`./assets3d/cars/${file}.glb`);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      // cor da carroceria = cor mais usada na malha "body" (para repintar só ela)
      const count = new Map();
      root.traverse((o) => {
        if (!o.isMesh) return;
        const isBody = /body/i.test(o.name) || /body/i.test(o.parent?.name || '');
        const uv = o.geometry.attributes.uv;
        if (!isBody || !uv) return;
        for (let i = 0; i < uv.count; i++) {
          const x = Math.min(cv.width - 1, Math.max(0, Math.floor(uv.getX(i) * cv.width)));
          const y = Math.min(cv.height - 1, Math.max(0, Math.floor(uv.getY(i) * cv.height)));
          const k = (y * cv.width + x) * 4;
          const r = px[k];
          const g = px[k + 1];
          const b = px[k + 2];
          if (r + g + b < 90) continue; // pneus, vidros escuros
          if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue; // cinzas: frisos, vidros, para-choques
          const key2 = (r << 16) | (g << 8) | b;
          count.set(key2, (count.get(key2) || 0) + 1);
        }
      });
      let best = null;
      let bestN = 0;
      for (const [k, n] of count) if (n > bestN) { best = k; bestN = n; }
      const bodyKey = best === null ? null : new THREE.Color().setRGB(((best >> 16) & 255) / 255, ((best >> 8) & 255) / 255, (best & 255) / 255, THREE.SRGBColorSpace);
      models[key] = { root, box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), bodyKey };
    }));
    this.carModels = models;
  }

  // Pessoas animadas (Quaternius, CC0)
  async #loadPeople() {
    const loader = new GLTFLoader();
    const people = {};
    await Promise.all(['woman1', 'woman2', 'man', 'hoodie', 'punk'].map(async (name) => {
      const gltf = await loader.loadAsync(`./assets3d/people/${name}.glb`);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const clips = {};
      for (const clip of gltf.animations) {
        const short = clip.name.split('|').pop().replace(/^Man_/, '');
        clips[short] = clip;
      }
      people[name] = { scene: gltf.scene, clips, height: box.max.y - box.min.y, minY: box.min.y };
    }));
    this.people = people;
  }

  // Cria uma pessoa animada; recolor = { nomeDoMaterial: cor }
  #makeCharacter(name, recolor = {}, height = 34) {
    const M = this.people[name];
    const root = new THREE.Group();
    const inst = cloneSkinned(M.scene);
    const s = height / M.height;
    inst.scale.setScalar(s);
    inst.position.y = -M.minY * s;
    // os modelos olham para +Z; a frente do jogo é +X
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.PI / 2;
    pivot.add(inst);
    root.add(pivot);
    const matCache = new Map();
    inst.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      const swap = (m) => {
        if (!matCache.has(m)) {
          const c = m.clone();
          if (recolor[m.name] !== undefined && recolor[m.name] !== null) c.color.copy(toColor(recolor[m.name]));
          c.roughness = 0.75;
          c.metalness = 0;
          matCache.set(m, c);
        }
        return matCache.get(m);
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    const mixer = new THREE.AnimationMixer(inst);
    const actions = {};
    for (const [k, clip] of Object.entries(M.clips)) actions[k] = mixer.clipAction(clip);
    root.userData = { mixer, actions, current: null, model: name };
    this.scene.add(root);
    return root;
  }

  #playAction(fig, name) {
    const u = fig.userData;
    const next = u.actions[name] ? name : (u.actions.Idle ? 'Idle' : Object.keys(u.actions)[0]);
    if (u.current === next) return u.actions[next];
    const a = u.actions[next];
    a.reset();
    if (next === 'Death') {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    a.fadeIn(0.2).play();
    if (u.current) u.actions[u.current].fadeOut(0.2);
    u.current = next;
    return a;
  }

  // Pessoa: modelo animado quando disponível, senão o boneco de blocos
  #character(kind, colors) {
    if (!this.people) return this.#buildFigure(colors.blocky);
    return this.#makeCharacter(kind, colors.recolor, colors.height || 34);
  }

  // Material do carro: igual ao do modelo, mas a cor da carroceria vira a cor do veículo no jogo
  #carPaintMaterial(base, bodyKey, color) {
    const m = base.clone();
    m.roughness = 0.42;
    m.metalness = 0.25;
    m.envMapIntensity = 1.2;
    const paint = { value: toColor(color) };
    const dim = { value: 1 };
    if (bodyKey) {
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uPaint = paint;
        sh.uniforms.uKey = { value: bodyKey };
        sh.uniforms.uDim = dim;
        sh.fragmentShader = 'uniform vec3 uPaint;\nuniform vec3 uKey;\nuniform float uDim;\n' + sh.fragmentShader.replace(
          '#include <map_fragment>',
          [
            '#include <map_fragment>',
            '{',
            '  vec3 c = diffuseColor.rgb;',
            '  float mx = max(c.r, max(c.g, c.b));',
            '  float mn = min(c.r, min(c.g, c.b));',
            '  float sat = (mx - mn) / max(mx, 1e-4);',
            // mesmo matiz da carroceria (tons claros e escuros dela) vira a cor do veículo
            '  if (sat > 0.35 && distance(normalize(c + 1e-4), normalize(uKey + 1e-4)) < 0.16) {',
            '    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722)) / max(dot(uKey, vec3(0.2126, 0.7152, 0.0722)), 1e-4);',
            '    diffuseColor.rgb = uPaint * clamp(lum, 0.35, 1.6);',
            '  }',
            '}',
            'diffuseColor.rgb *= uDim;',
          ].join('\n'),
        );
      };
      m.customProgramCacheKey = () => 'car-paint';
    }
    return { material: m, paint, dim };
  }

  #carModelKey(v) {
    if (v.police) return 'police';
    if (v.special) return 'special';
    if (v.kind === 'van') return v.model === 'Van de Carga' ? 'van-delivery' : 'van';
    if (v.kind !== 'car') return null;
    return v.texModel || 'car';
  }

  #buildVehicleModel(v, key) {
    const M = this.carModels[key];
    const g = new THREE.Group();
    const inst = M.root.clone(true);
    const alongZ = M.size.z >= M.size.x;
    const len = alongZ ? M.size.z : M.size.x;
    const wid = alongZ ? M.size.x : M.size.z;
    const L = v.length || 60;
    const W = v.width || 28;
    const s = Math.min(L / len, (W * 1.12) / wid);
    const pivot = new THREE.Group();
    inst.scale.setScalar(s);
    inst.position.set(-M.center.x * s, -M.box.min.y * s, -M.center.z * s);
    pivot.add(inst);
    // os modelos do Kenney apontam a frente para +Z: girar para a frente ficar em +X
    pivot.rotation.y = alongZ ? Math.PI / 2 : 0;
    g.add(pivot);

    const recolor = key !== 'police';
    let paintInfo = null;
    const wheels = [];
    inst.traverse((o) => {
      if (/^wheel/i.test(o.name)) wheels.push(o);
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (recolor) {
        if (!paintInfo) paintInfo = this.#carPaintMaterial(o.material, M.bodyKey, v.color);
        o.material = paintInfo.material;
      }
    });
    const topY = M.size.y * s;
    if (v.police) {
      g.userData.sirenR = new THREE.Mesh(this.geo.box, this.mat.sirenRed);
      g.userData.sirenB = new THREE.Mesh(this.geo.box, this.mat.sirenBlue);
      for (const [m, z] of [[g.userData.sirenR, -W * 0.18], [g.userData.sirenB, W * 0.18]]) {
        m.scale.set(4, 2.5, W * 0.28);
        m.position.set(-L * 0.05, topY + 1.2, z);
        g.add(m);
      }
    }
    const contact = new THREE.Mesh(this.geo.plane, this.mat.contact);
    contact.scale.set(L * 1.25, 1, W * 1.45);
    contact.position.y = 0.6;
    g.add(contact);

    g.userData.paint = paintInfo ? { color: paintInfo.paint.value } : { color: new THREE.Color() };
    g.userData.dim = paintInfo?.dim || null;
    g.userData.wheels = wheels;
    g.userData.wheelRadius = Math.max(0.5, 0.3 * s);
    g.userData.odo = 0;
    g.userData.kind = v.kind;
    g.userData.tex = v.texModel || '';
    this.scene.add(g);
    return g;
  }

  // ---------- chão, ilha e mar ----------
  #buildGround(cityMap) {
    this.groundBuilt = true;
    const W = cityMap.worldWidth;
    const H = cityMap.worldHeight;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(W + 12000, H + 12000), this.mat.water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(W / 2, -3, H / 2);
    this.scene.add(sea);

    const asphaltMat = this.mat.asphalt;
    asphaltMat.map.repeat.set(W / 220, H / 220);
    asphaltMat.normalMap?.repeat.set(W / 220, H / 220);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), asphaltMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, H / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const shore = new THREE.Mesh(new THREE.BoxGeometry(W + 40, 4, H + 40), new THREE.MeshLambertMaterial({ color: 0xd8cfa6 }));
    shore.position.set(W / 2, -2.2, H / 2);
    this.scene.add(shore);
  }

  // ---------- quarteirão (calçada, prédios, árvores, faixas) ----------
  #buildBlock(block, cityMap) {
    const g = new THREE.Group();
    const b = block.bounds;

    const curb = new THREE.Mesh(this.geo.box, this.mat.curb);
    curb.scale.set(b.w + 6, 1.5, b.h + 6);
    curb.position.set(b.x + b.w / 2, 0.75, b.y + b.h / 2);
    curb.receiveShadow = true;
    g.add(curb);

    const sideMat = this.mat.sidewalk.clone();
    sideMat.map = this.mat.sidewalk.map.clone();
    sideMat.map.repeat.set(b.w / 90, b.h / 90);
    if (this.mat.sidewalk.normalMap) {
      sideMat.normalMap = this.mat.sidewalk.normalMap.clone();
      sideMat.normalMap.repeat.copy(sideMat.map.repeat);
    }
    const side = new THREE.Mesh(this.geo.box, sideMat);
    side.scale.set(b.w, 3, b.h);
    side.position.set(b.x + b.w / 2, 1.5, b.y + b.h / 2);
    side.receiveShadow = true;
    g.add(side);

    if (block.plaza) {
      const pb = block.plaza.bounds;
      const gm = this.mat.grass.clone();
      gm.map = this.mat.grass.map.clone();
      gm.map.repeat.set(pb.w / 110, pb.h / 110);
      if (this.mat.grass.normalMap) {
        gm.normalMap = this.mat.grass.normalMap.clone();
        gm.normalMap.repeat.copy(gm.map.repeat);
      }
      const grass = new THREE.Mesh(this.geo.box, gm);
      grass.scale.set(pb.w, 1, pb.h);
      grass.position.set(pb.x + pb.w / 2, 3.5, pb.y + pb.h / 2);
      grass.receiveShadow = true;
      g.add(grass);
      for (const prop of block.plaza.props) {
        if (prop.kind === 'fountain') {
          const rim = new THREE.Mesh(this.geo.box, new THREE.MeshLambertMaterial({ color: 0xc0c4ca }));
          rim.scale.set(prop.w + 8, 6, prop.h + 8);
          rim.position.set(prop.x + prop.w / 2, 4, prop.y + prop.h / 2);
          g.add(rim);
          const water = new THREE.Mesh(this.geo.box, this.mat.water);
          water.scale.set(prop.w, 2, prop.h);
          water.position.set(prop.x + prop.w / 2, 6.5, prop.y + prop.h / 2);
          g.add(water);
        } else {
          const bench = new THREE.Mesh(this.geo.box, new THREE.MeshLambertMaterial({ color: 0x8c5a33 }));
          bench.scale.set(prop.w, 5, prop.h);
          bench.position.set(prop.x + prop.w / 2, 5.5, prop.y + prop.h / 2);
          bench.castShadow = true;
          g.add(bench);
        }
      }
    }

    for (const o of block.obstacles || []) {
      const m = new THREE.Mesh(this.geo.box, this.mat.curb);
      m.scale.set(o.w, 10, o.h);
      m.position.set(o.x + o.w / 2, 5, o.y + o.h / 2);
      m.castShadow = true;
      g.add(m);
    }

    // postes nas quinas
    for (const [cx, cy] of [[b.x + 8, b.y + 8], [b.x + b.w - 8, b.y + 8], [b.x + 8, b.y + b.h - 8], [b.x + b.w - 8, b.y + b.h - 8]]) {
      const pole = new THREE.Mesh(this.geo.box, this.mat.lampPole);
      pole.scale.set(2.5, 46, 2.5);
      pole.position.set(cx, 26, cy);
      pole.castShadow = true;
      g.add(pole);
      const bulb = new THREE.Mesh(this.geo.sphere, this.mat.lampBulb);
      bulb.scale.setScalar(3.6);
      bulb.position.set(cx, 50, cy);
      g.add(bulb);
    }

    const buildings = [];
    for (const bd of block.buildings) buildings.push(this.#buildBuilding(bd, g));

    for (const t of blockDecor(block).trees) this.#buildTree(t, g);

    this.scene.add(g);
    return { group: g, buildings };
  }

  #buildBuilding(bd, g) {
    const bb = bd.bounds;
    const H = buildingHeight({ x: bb.x, y: bb.y, type: bd.type, isHospital: bd.type === 'hospital' });
    const roofCol = toColor(bd.roofColor, '#8d5b4c');
    const isHouse = bd.type === 'house';
    const photo = this.photo;
    const facade = photo ? (isHouse ? this.wallTexHouse : this.wallTexShop) : this.wallTex;
    // com foto: tinta clara levemente puxada para a cor do telhado (casas mantêm o tijolo)
    const wallCol = photo
      ? new THREE.Color(1, 1, 1).lerp(roofCol, isHouse ? 0.1 : 0.32)
      : roofCol.clone().lerp(new THREE.Color(0.86, 0.82, 0.75), 0.6);

    const wallMat = (len) => {
      const map = facade.clone();
      map.repeat.set(Math.max(1, Math.round(len / 30)), Math.max(1, Math.round(H / 26)));
      const em = this.wallLitTex.clone();
      em.repeat.copy(map.repeat);
      const mat = new THREE.MeshStandardMaterial({ color: wallCol, map, roughness: 0.85, metalness: 0.02, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: 0 });
      if (photo) {
        mat.normalMap = (isHouse ? photo.brick_wall_02.nor : photo.painted_plaster_wall.nor).clone();
        mat.normalMap.repeat.set(len / 60, H / 52);
        mat.normalScale = new THREE.Vector2(0.7, 0.7);
      }
      return mat;
    };
    const roofMap = (photo ? photo.concrete_floor_02.diff : this.roofTex).clone();
    roofMap.repeat.set(bb.w / 80, bb.h / 80);
    const roofMat = new THREE.MeshStandardMaterial({ color: photo ? new THREE.Color(1, 1, 1).lerp(roofCol, 0.55) : roofCol, map: roofMap, roughness: 0.92 });
    if (photo) {
      roofMat.normalMap = photo.concrete_floor_02.nor.clone();
      roofMat.normalMap.repeat.copy(roofMap.repeat);
    }
    const wx = wallMat(bb.h);
    const wz = wallMat(bb.w);
    // ordem das faces do BoxGeometry: +x, -x, +y(topo), -y, +z, -z
    const mesh = new THREE.Mesh(this.geo.box, [wx, wx, roofMat, roofMat, wz, wz]);
    mesh.scale.set(bb.w, H, bb.h);
    mesh.position.set(bb.x + bb.w / 2, H / 2 + 3, bb.y + bb.h / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);

    const extras = new THREE.Group();
    // mureta do telhado
    const parapetMat = new THREE.MeshLambertMaterial({ color: roofCol.clone().multiplyScalar(0.7) });
    const pt = 4;
    for (const [sx, sz, px, pz] of [
      [bb.w, pt, bb.x + bb.w / 2, bb.y + pt / 2],
      [bb.w, pt, bb.x + bb.w / 2, bb.y + bb.h - pt / 2],
      [pt, bb.h, bb.x + pt / 2, bb.y + bb.h / 2],
      [pt, bb.h, bb.x + bb.w - pt / 2, bb.y + bb.h / 2],
    ]) {
      const p = new THREE.Mesh(this.geo.box, parapetMat);
      p.scale.set(sx, 5, sz);
      p.position.set(px, H + 3 + 2.5, pz);
      p.castShadow = true;
      extras.add(p);
    }
    // ar-condicionado no telhado
    if (bb.w > 70 && bb.h > 60) {
      const ac = new THREE.Mesh(this.geo.box, this.mat.ac);
      ac.scale.set(16, 9, 12);
      ac.position.set(bb.x + bb.w * 0.25, H + 3 + 4.5, bb.y + bb.h * 0.3);
      ac.castShadow = true;
      extras.add(ac);
    }
    // porta e toldo na entrada
    if (bd.doormat) {
      const dm = bd.doormat;
      const vertical = bd.doorSide === 'east' || bd.doorSide === 'west';
      const door = new THREE.Mesh(this.geo.box, this.mat.door);
      const awn = new THREE.Mesh(this.geo.box, this.mat.awning);
      const dw = vertical ? dm.h : dm.w;
      let x = dm.x + dm.w / 2;
      let z = dm.y + dm.h / 2;
      if (bd.doorSide === 'south') z = bb.y + bb.h + 0.6;
      if (bd.doorSide === 'north') z = bb.y - 0.6;
      if (bd.doorSide === 'east') x = bb.x + bb.w + 0.6;
      if (bd.doorSide === 'west') x = bb.x - 0.6;
      door.scale.set(vertical ? 1.5 : dw, 22, vertical ? dw : 1.5);
      door.position.set(x, 14, z);
      awn.scale.set(vertical ? 10 : dw + 8, 2, vertical ? dw + 8 : 10);
      const off = 5;
      awn.position.set(
        x + (bd.doorSide === 'east' ? off : bd.doorSide === 'west' ? -off : 0),
        28,
        z + (bd.doorSide === 'south' ? off : bd.doorSide === 'north' ? -off : 0),
      );
      awn.castShadow = true;
      extras.add(door, awn);
    }
    g.add(extras);
    const mats = [wx, wz, roofMat, parapetMat];
    for (const m of mats) m.transparent = true;
    return { code: bd.code, mesh, extras, roofMat, walls: [wx, wz], mats, bounds: bb, faded: false };
  }

  #buildTree(t, g) {
    const z = t.bush ? 0 : 1;
    if (t.uv === 'tree3') {
      const trunk = new THREE.Mesh(this.geo.trunk, this.mat.trunk);
      trunk.scale.set(2.2, 52, 2.2);
      trunk.position.set(t.x, 29, t.y);
      trunk.castShadow = true;
      g.add(trunk);
      for (let i = 0; i < 7; i++) {
        const f = new THREE.Mesh(this.geo.box, this.mat.palm);
        const a = (i / 7) * Math.PI * 2;
        f.scale.set(t.r * 1.1, 1, 6);
        f.position.set(t.x + Math.cos(a) * t.r * 0.5, 53, t.y + Math.sin(a) * t.r * 0.5);
        f.rotation.set(0, -a, -0.35);
        f.castShadow = true;
        g.add(f);
      }
      return;
    }
    const leaves = this.mat.leaves[Math.abs(Math.round(t.x + t.y)) % this.mat.leaves.length];
    if (z) {
      const trunk = new THREE.Mesh(this.geo.trunk, this.mat.trunk);
      trunk.scale.set(2.6, 26, 2.6);
      trunk.position.set(t.x, 16, t.y);
      trunk.castShadow = true;
      g.add(trunk);
    }
    const c = new THREE.Mesh(this.geo.canopy, t.bush ? this.mat.leaves[2] : leaves);
    const r = t.r * (t.bush ? 0.9 : 1.05);
    c.scale.set(r, r * (t.bush ? 0.7 : 0.9), r);
    c.position.set(t.x, t.bush ? 3 + r * 0.6 : 28 + r * 0.6, t.y);
    c.rotation.y = t.rot;
    c.castShadow = true;
    c.receiveShadow = true;
    g.add(c);
  }

  #buildRoadMarks(cityMap) {
    // faixas amarelas e de pedestre: geometria única para a cidade toda
    const stripes = [];
    const cross = [];
    const W = cityMap.worldWidth;
    const H = cityMap.worldHeight;
    for (const ry of cityMap.roadYOffsets) {
      const y = ry + cityMap.roadWidth / 2;
      for (let x = 0; x < W - 34; x += 64) stripes.push([x + 17, y, 34, 4]);
    }
    for (const rx of cityMap.roadXOffsets) {
      const x = rx + cityMap.roadWidth / 2;
      for (let y = 0; y < H - 34; y += 64) stripes.push([x, y + 17, 4, 34]);
    }
    for (const cw of cityMap.crosswalks || []) {
      if (cw.axis === 'h') {
        for (let sx = cw.x + 4; sx <= cw.x + cw.w - 10; sx += 14) cross.push([sx + 3.5, cw.y + cw.h / 2, 7, cw.h]);
      } else {
        for (let sy = cw.y + 4; sy <= cw.y + cw.h - 10; sy += 14) cross.push([cw.x + cw.w / 2, sy + 3.5, cw.w, 7]);
      }
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const mk = (list, mat) => {
      const im = new THREE.InstancedMesh(plane, mat, list.length);
      const m = new THREE.Matrix4();
      list.forEach(([x, y, w, h], i) => {
        m.makeScale(w, 1, h);
        m.setPosition(x, 0.4, y);
        im.setMatrixAt(i, m);
      });
      im.receiveShadow = true;
      this.scene.add(im);
    };
    if (stripes.length) mk(stripes, this.mat.stripe);
    if (cross.length) mk(cross, this.mat.crosswalk);
  }

  // ---------- veículos ----------
  #buildVehicle(v) {
    const modelKey = this.carModels ? this.#carModelKey(v) : null;
    if (modelKey && this.carModels[modelKey]) return this.#buildVehicleModel(v, modelKey);
    const g = new THREE.Group();
    const L = v.length || 60;
    const W = v.width || 28;
    const paint = new THREE.MeshPhysicalMaterial({ color: toColor(v.police ? '#f4f4f4' : v.color), metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.4, roughness: 0.5 });
    const add = (geo, mat, sx, sy, sz, x, y, z, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      g.add(m);
      return m;
    };
    const tex = v.texModel || '';
    const wheels = (r, w, xs) => {
      for (const x of xs) for (const z of [-W / 2 + 1, W / 2 - 1]) {
        const wh = add(this.geo.wheel, this.mat.tire, r, w, r, x, r, z);
        wh.rotation.x = Math.PI / 2;
      }
    };

    if (v.kind === 'moto') {
      add(this.geo.box, paint, L * 0.7, 8, W * 0.35, 0, 12, 0);
      add(this.geo.box, dark, L * 0.3, 4, W * 0.3, -L * 0.1, 18, 0);
      for (const x of [L * 0.35, -L * 0.35]) {
        const wh = add(this.geo.wheel, this.mat.tire, 8, 4, 8, x, 8, 0);
        wh.rotation.x = Math.PI / 2;
      }
      add(this.geo.box, this.mat.headlight, 2, 3, 4, L * 0.42, 16, 0, false);
    } else if (v.kind === 'van') {
      add(this.geo.box, paint, L, 30, W, 0, 20, 0);
      add(this.geo.box, this.mat.glass, 2, 10, W * 0.86, L / 2 - 0.5, 26, 0, false);
      add(this.geo.box, this.mat.glass, L * 0.3, 8, W + 0.4, L * 0.25, 27, 0, false);
      wheels(7, 5, [L * 0.32, -L * 0.32]);
      add(this.geo.box, this.mat.headlight, 1, 4, 5, L / 2, 14, -W * 0.33, false);
      add(this.geo.box, this.mat.headlight, 1, 4, 5, L / 2, 14, W * 0.33, false);
      add(this.geo.box, this.mat.taillight, 1, 5, 4, -L / 2, 14, -W * 0.38, false);
      add(this.geo.box, this.mat.taillight, 1, 5, 4, -L / 2, 14, W * 0.38, false);
    } else {
      // carro: proporções por modelo
      const P = {
        'car-sport': { bodyH: 9, cab: [0.06, 0.4], cabH: 7, wheel: 7 },
        'car-hatch': { bodyH: 11, cab: [-0.3, 0.55], cabH: 9, wheel: 6.5, short: 0.84 },
        'car-suv': { bodyH: 15, cab: [-0.42, 0.66], cabH: 11, wheel: 8 },
        'car-pickup': { bodyH: 13, cab: [0.05, 0.5], cabH: 10, wheel: 8, bed: true },
      }[tex] || { bodyH: 11, cab: [-0.15, 0.62], cabH: 9, wheel: 7 };
      const Ls = L * (P.short || 1);
      const base = P.wheel * 0.9;
      // carroceria com capô e porta-malas inclinados (perfil extrudado na largura)
      const top = base + P.bodyH;
      const body = profileMesh([
        [-Ls / 2, base], [Ls / 2, base], [Ls / 2, base + P.bodyH * 0.62], [Ls / 2 - 7, top],
        [-Ls / 2 + 5, top], [-Ls / 2, base + P.bodyH * 0.72],
      ], W - 3, paint);
      g.add(body);
      const c0 = P.cab[0] * Ls;
      const c1 = (P.cab[0] + P.cab[1]) * Ls;
      const cabLen = c1 - c0;
      const slopeF = cabLen * (tex === 'car-sport' ? 0.42 : 0.3);
      const slopeB = cabLen * (tex === 'car-suv' || tex === 'car-hatch' ? 0.06 : 0.2);
      // cabine de vidro (para-brisa e vidro traseiro inclinados)
      const cab = profileMesh([
        [c0, top - 0.5], [c1, top - 0.5], [c1 - slopeF, top + P.cabH], [c0 + slopeB, top + P.cabH],
      ], W * 0.8, this.mat.glass);
      g.add(cab);
      // teto pintado e colunas
      add(this.geo.box, paint, cabLen - slopeF - slopeB, 1.6, W * 0.82, (c0 + slopeB + c1 - slopeF) / 2, top + P.cabH + 0.6, 0);
      add(this.geo.box, paint, cabLen * 0.6, P.cabH * 0.9, 1.2, (c0 + c1) / 2, top + P.cabH * 0.45, -W * 0.405, false);
      add(this.geo.box, paint, cabLen * 0.6, P.cabH * 0.9, 1.2, (c0 + c1) / 2, top + P.cabH * 0.45, W * 0.405, false);
      if (P.bed) add(this.geo.box, dark, Ls * 0.38, 1, W * 0.78, -Ls * 0.28, top + 0.3, 0, false);
      if (tex === 'car-sport') add(this.geo.box, dark, 4, 2, W * 0.9, -Ls / 2 + 3, top + 5, 0);
      if (tex === 'car-suv') {
        add(this.geo.box, dark, cabLen * 0.8, 1.2, 2, (c0 + c1) / 2, top + P.cabH + 1.8, -W * 0.3);
        add(this.geo.box, dark, cabLen * 0.8, 1.2, 2, (c0 + c1) / 2, top + P.cabH + 1.8, W * 0.3);
      }
      wheels(P.wheel, 5, [Ls * 0.32, -Ls * 0.32]);
      add(this.geo.box, this.mat.chrome, 1.5, 3, W * 0.8, Ls / 2 + 0.5, base + 3, 0, false);
      add(this.geo.box, this.mat.headlight, 1, 3, 6, Ls / 2 + 0.2, base + P.bodyH * 0.6, -W * 0.32, false);
      add(this.geo.box, this.mat.headlight, 1, 3, 6, Ls / 2 + 0.2, base + P.bodyH * 0.6, W * 0.32, false);
      add(this.geo.box, this.mat.taillight, 1, 3, 6, -Ls / 2 - 0.2, base + P.bodyH * 0.6, -W * 0.32, false);
      add(this.geo.box, this.mat.taillight, 1, 3, 6, -Ls / 2 - 0.2, base + P.bodyH * 0.6, W * 0.32, false);
      if (v.police) {
        add(this.geo.box, dark, Ls * 0.24, P.bodyH + 0.4, W - 1.6, Ls * 0.36, base + P.bodyH / 2, 0);
        g.userData.sirenR = add(this.geo.box, this.mat.sirenRed, 4, 3, W * 0.3, (c0 + c1) / 2, top + P.cabH + 2.4, -W * 0.18, false);
        g.userData.sirenB = add(this.geo.box, this.mat.sirenBlue, 4, 3, W * 0.3, (c0 + c1) / 2, top + P.cabH + 2.4, W * 0.18, false);
      }
    }
    const contact = new THREE.Mesh(this.geo.plane, this.mat.contact);
    contact.scale.set(L * 1.25, 1, W * 1.45);
    contact.position.y = 0.6;
    contact.renderOrder = -1;
    g.add(contact);
    g.userData.paint = paint;
    g.userData.kind = v.kind;
    g.userData.tex = tex;
    this.scene.add(g);
    return g;
  }

  // ---------- pessoas ----------
  #buildFigure({ shirt, pants, skin, hair, longHair = false, shoes = 0x2b2b30, sleeve = null }) {
    const g = new THREE.Group();
    const m = (c) => new THREE.MeshLambertMaterial({ color: toColor(c) });
    const shirtM = m(shirt);
    const sleeveM = sleeve ? m(sleeve) : shirtM;
    const pantsM = m(pants);
    const skinM = m(skin);
    const hairM = m(hair);
    const shoeM = m(shoes);
    const part = (mat, sx, sy, sz, x, y, z, parent = g) => {
      const p = new THREE.Mesh(this.geo.box, mat);
      p.scale.set(sx, sy, sz);
      p.position.set(x, y, z);
      p.castShadow = true;
      parent.add(p);
      return p;
    };
    const pivot = (x, y, z) => {
      const p = new THREE.Group();
      p.position.set(x, y, z);
      g.add(p);
      return p;
    };
    // pernas e braços giram a partir de pivôs (quadril e ombro); frente = +x
    const legL = pivot(0, 11, -2.2);
    const legR = pivot(0, 11, 2.2);
    part(pantsM, 3.4, 10, 3.4, 0, -5, 0, legL);
    part(pantsM, 3.4, 10, 3.4, 0, -5, 0, legR);
    part(shoeM, 4.6, 1.6, 3.6, 0.6, -10.2, 0, legL);
    part(shoeM, 4.6, 1.6, 3.6, 0.6, -10.2, 0, legR);
    part(shirtM, 4.6, 9, 8.2, 0, 15.5, 0);
    const armL = pivot(0, 19.5, -5.3);
    const armR = pivot(0, 19.5, 5.3);
    part(sleeveM, 2.8, 8.5, 2.8, 0, -4, 0, armL);
    part(sleeveM, 2.8, 8.5, 2.8, 0, -4, 0, armR);
    part(skinM, 2.4, 2.4, 2.4, 0, -9, 0, armL);
    part(skinM, 2.4, 2.4, 2.4, 0, -9, 0, armR);
    const head = new THREE.Mesh(this.geo.sphere, skinM);
    head.scale.set(3.4, 3.8, 3.4);
    head.position.set(0, 24, 0);
    head.castShadow = true;
    g.add(head);
    const hairTop = new THREE.Mesh(this.geo.sphere, hairM);
    hairTop.scale.set(3.7, 2.6, 3.7);
    hairTop.position.set(-0.4, 25.8, 0);
    g.add(hairTop);
    if (longHair) part(hairM, 2.2, 11, 7.2, -2.6, 20, 0);
    g.userData = { legL, legR, armL, armR };
    this.scene.add(g);
    return g;
  }

  #animateFigure(fig, x, y, angle, walkPhase, moving, lift = 0, opts = {}) {
    fig.position.set(x, 3 + lift, y);
    fig.rotation.y = -angle;
    if (fig.userData.mixer) {
      const spd = opts.speed ?? (moving ? 50 : 0);
      let want = 'Idle';
      if (opts.dead) want = 'Death';
      else if (lift > 0) want = 'Idle';
      else if (spd > 140) want = 'Run';
      else if (spd > 6) want = 'Walk';
      else if (opts.armed) want = 'Idle_Gun';
      const a = this.#playAction(fig, want);
      if (want === 'Walk') a.timeScale = Math.min(1.8, Math.max(0.6, spd / 60));
      else if (want === 'Run') a.timeScale = Math.min(1.5, Math.max(0.8, spd / 200));
      else a.timeScale = 1;
      fig.userData.mixer.update(this.frameDt || 1 / 60);
      return;
    }
    fig.scale.setScalar(1.2);
    const s = moving ? Math.sin(walkPhase * 0.18) * 0.6 : 0;
    const u = fig.userData;
    u.legL.rotation.z = s;
    u.legR.rotation.z = -s;
    u.armL.rotation.z = -s * 0.8;
    u.armR.rotation.z = s * 0.8;
  }

  #pedFigure(ped) {
    let fig = this.pedMeshes.get(ped.id);
    if (!fig) {
      const blocky = {
        shirt: ped.color,
        pants: ped.pantsColor || '#2d3748',
        skin: ped.skinColor || '#e0b48c',
        hair: ped.hairColor || '#2b1d14',
      };
      const models = ['man', 'hoodie', 'punk', 'woman1', 'woman2', 'man'];
      const id = String(ped.id);
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      const kind = models[h % models.length];
      const shirtMat = { man: 'Shirt', hoodie: 'Purple', punk: 'Red', woman1: 'White', woman2: 'Red' }[kind];
      const recolor = { [shirtMat]: ped.color, Skin: ped.skinColor || null, Pants: ped.pantsColor || null, Hair: ped.hairColor || null };
      fig = this.#character(kind, { blocky, recolor, height: 31 + (h % 5) });
      this.pedMeshes.set(ped.id, fig);
    }
    fig.userData.seen = this.frameId;
    return fig;
  }

  // ---------- quadro ----------
  render(p) {
    const { cityMap, player, vehicles, pedestrians, partner, time, dt = 1 / 60 } = p;
    this.frameDt = dt;
    this.frameId = (this.frameId || 0) + 1;
    if (!this.groundBuilt) {
      this.#buildGround(cityMap);
      this.#buildRoadMarks(cityMap);
    }
    this.#resize();

    const playerVehicle = player.inVehicleId ? vehicles.find((v) => v.id === player.inVehicleId) : null;
    const focus = playerVehicle || player;

    // --- cidade ao redor ---
    const blocks = cityMap.getVisibleBlocks(focus.x - BLOCK_RADIUS, focus.y - BLOCK_RADIUS, focus.x + BLOCK_RADIUS, focus.y + BLOCK_RADIUS);
    const seen = new Set();
    for (const block of blocks) {
      let entry = this.blockGroups.get(block);
      if (!entry) {
        entry = this.#buildBlock(block, cityMap);
        this.blockGroups.set(block, entry);
      }
      entry.group.visible = true;
      seen.add(block);
    }
    for (const [block, entry] of this.blockGroups) if (!seen.has(block)) entry.group.visible = false;

    // --- dia e noite ---
    const sky = this.dayCycle.sample(time);
    const dark = sky.darkness;
    const hour = sky.hour ?? 12;
    // sol nasce às 6h a leste e se põe às 18h a oeste
    const dayT = (hour - 6) / 12;
    const elev = Math.sin(dayT * Math.PI) * 0.95;
    const az = Math.PI * (0.15 + dayT * 0.7);
    this.sunDir.set(Math.cos(az) * Math.cos(Math.asin(Math.max(-1, Math.min(1, elev)))), elev, -0.45).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.sky.position.copy(this.camera.position);
    const horizon = new THREE.Color(0xc9ddef).lerp(new THREE.Color(0xf2a46b), sky.golden * 0.6).lerp(new THREE.Color(0x0b1226), Math.min(1, dark * 1.1));
    this.scene.fog.color.copy(horizon);
    this.scene.background = horizon;
    this.scene.environmentIntensity = 0.38 - dark * 0.3;
    this.hemi.intensity = 0.62 - dark * 0.45;
    this.sun.intensity = 2.4 * (1 - dark) + 0.08;
    this.sun.color.set(sky.golden > 0.2 ? 0xffc08a : 0xfff4e0);
    const lightDir = elev > 0.08 ? this.sunDir : new THREE.Vector3(-0.3, 0.9, -0.3); // à noite: luar de cima
    this.sun.position.set(focus.x + lightDir.x * 900, Math.max(260, lightDir.y * 900), focus.y + lightDir.z * 900);
    this.sun.target.position.set(focus.x, 0, focus.y);
    this.bloom.strength = 0.08 + dark * 0.85;
    this.bloom.threshold = dark > 0.3 ? 0.6 : 0.97;
    this.mat.lampBulb.color.set(dark > 0.3 ? 0xffe7a8 : 0xd8d8d0);
    const insideCode = player.insideLocationCode;
    for (const entry of this.blockGroups.values()) {
      if (!entry.group.visible) continue;
      for (const b of entry.buildings) {
        for (const w of b.walls) w.emissiveIntensity = dark > 0.25 ? dark * 0.9 : 0;
        // dentro de um prédio: some o prédio para ver o interior
        const hide = insideCode && b.code === insideCode;
        b.mesh.visible = !hide;
        b.extras.visible = !hide;
        // prédio entre a câmera e a protagonista fica transparente
        const fade = this.camPos && segmentHitsRect(this.camPos.x, this.camPos.z, focus.x, focus.y, b.bounds, 10);
        if (fade !== b.faded) {
          b.faded = fade;
          for (const m of b.mats) {
            m.opacity = fade ? 0.28 : 1;
            m.depthWrite = !fade;
          }
          b.mesh.castShadow = !fade;
        }
      }
    }

    // --- veículos ---
    const vSeen = new Set();
    for (const v of vehicles) {
      if (Math.abs(v.x - focus.x) > BLOCK_RADIUS || Math.abs(v.y - focus.y) > BLOCK_RADIUS) continue;
      let mesh = this.vehicleMeshes.get(v.id);
      if (mesh && (mesh.userData.tex !== (v.texModel || '') || mesh.userData.police !== Boolean(v.police))) {
        this.scene.remove(mesh);
        mesh = null;
      }
      if (!mesh) {
        if (v.kind === 'car' && !v.texModel) v.texModel = pickCarModel(v);
        mesh = this.#buildVehicle(v);
        mesh.userData.police = Boolean(v.police);
        this.vehicleMeshes.set(v.id, mesh);
      }
      vSeen.add(v.id);
      mesh.visible = (v.sinkAlpha ?? 1) > 0.05;
      mesh.position.set(v.x, v.sinking ? -8 * (v.sinkProgress || 0) : 0, v.y);
      mesh.rotation.y = -v.angle;
      const paint = mesh.userData.paint;
      if (v.destroyed) paint.color.set(0x2a2a2a);
      else if (!v.police) paint.color.copy(toColor(v.color));
      if (mesh.userData.dim) mesh.userData.dim.value = v.destroyed ? 0.25 : 1;
      // rodas girando conforme a distância percorrida
      if (mesh.userData.wheels?.length) {
        mesh.userData.odo += (v.speed || 0) * dt;
        const rot = mesh.userData.odo / mesh.userData.wheelRadius;
        for (const w of mesh.userData.wheels) w.rotation.x = -rot;
      }
      if (mesh.userData.sirenR) {
        const on = Math.floor(time * 6) % 2 === 0;
        mesh.userData.sirenR.visible = on;
        mesh.userData.sirenB.visible = !on;
      }
    }
    for (const [id, mesh] of this.vehicleMeshes) {
      if (!vSeen.has(id)) {
        this.scene.remove(mesh);
        this.vehicleMeshes.delete(id);
      }
    }

    // --- pedestres ---
    for (const ped of pedestrians) {
      if (Math.abs(ped.x - focus.x) > 1100 || Math.abs(ped.y - focus.y) > 1100) continue;
      if (ped.state === 'inside') continue;
      const fig = this.#pedFigure(ped);
      fig.visible = true;
      const down = (ped.health ?? 1) <= 0;
      this.#animateFigure(fig, ped.x, ped.y, ped.angle || 0, ped.walkPhase || 0, (ped.speed || 0) > 1, 0, { speed: ped.speed || 0, dead: down });
      if (!fig.userData.mixer) fig.rotation.z = down ? Math.PI / 2 : 0;
    }
    for (const [id, fig] of this.pedMeshes) {
      if (fig.userData.seen !== this.frameId) {
        this.scene.remove(fig);
        this.pedMeshes.delete(id);
      }
    }

    // --- protagonista e parceira ---
    if (!this.playerFig) {
      const c = p.protagonistColors || {};
      this.playerFig = this.#character('woman1', {
        blocky: { shirt: c.shirt || '#1e1e23', sleeve: c.sleeve, pants: c.pants || '#1e1e23', skin: c.skin || '#f3cda6', hair: '#6b3f22', longHair: true, shoes: c.shoes || '#f3f2ee' },
        // Ana Laura: camiseta preta, calça escura, tênis claro, cabelo castanho comprido
        recolor: { White: c.shirt || '#1e1e23', Grey: '#2a2a31', Brown: c.shoes || '#f3f2ee', Orange: c.pants || '#1e1e23', Skin: c.skin || '#f3cda6', Hair_Brown: '#6b3f22', Hair_Blond: '#6b3f22' },
        height: 34,
      });
    }
    const onMoto = playerVehicle?.kind === 'moto';
    this.playerFig.visible = (!playerVehicle || onMoto) && !player.isDead;
    if (this.playerFig.visible) {
      const px = onMoto ? playerVehicle.x : player.x;
      const py = onMoto ? playerVehicle.y : player.y;
      this.#animateFigure(this.playerFig, px, py, onMoto ? playerVehicle.angle : player.angle, player.walkPhase || 0, !onMoto && (player.speed || 0) > 5, onMoto ? 6 : 0, {
        speed: onMoto ? 0 : Math.abs(player.speed || 0),
        armed: Boolean(player.weaponId && player.weaponId !== 'punhos'),
      });
    }
    if (partner && partner.visible !== false && partner.state !== 'unplaced') {
      if (!this.partnerFig) {
        const c = p.partnerColors || {};
        this.partnerFig = this.#character('woman2', {
          blocky: { shirt: c.shirt || '#2c6a43', sleeve: c.sleeve, pants: c.pants || '#1e1e23', skin: c.skin || '#f3cda6', hair: '#3a2416', longHair: true, shoes: c.shoes || '#3a3a42' },
          // Camila: jaqueta verde, calça escura
          recolor: { Red: '#3a2416', LimeGreen: c.sleeve || '#2c6a43', Skin: c.skin || '#f3cda6' },
          height: 34,
        });
      }
      const riding = partner.state === 'riding';
      const rv = riding ? vehicles.find((v) => v.id === partner.vehicleId) : null;
      this.partnerFig.visible = !riding || rv?.kind === 'moto';
      if (this.partnerFig.visible) {
        const bx = rv ? rv.x - Math.cos(rv.angle) * 10 : partner.x;
        const by = rv ? rv.y - Math.sin(rv.angle) * 10 : partner.y;
        this.#animateFigure(this.partnerFig, bx, by, rv ? rv.angle : partner.angle || 0, partner.walkPhase || 0, !rv && (partner.speed || 0) > 5, rv ? 6 : 0, {
          speed: rv ? 0 : Math.abs(partner.speed || 0),
        });
      }
    } else if (this.partnerFig) {
      this.partnerFig.visible = false;
    }

    // --- NPCs de missão e encontros ---
    const npcSeen = new Set();
    const npcList = [...(p.completedNpcPoints || [])];
    if (p.objectiveNpcPoint) npcList.push(p.objectiveNpcPoint);
    for (const n of npcList) {
      const key = `${Math.round(n.x)}:${Math.round(n.y)}`;
      let fig = this.extraFigures.get(key);
      if (!fig) {
        fig = this.#character('man', {
          blocky: { shirt: '#c2410c', pants: '#334155', skin: '#e0b48c', hair: '#2b1d14' },
          recolor: { Shirt: '#c2410c', Pants: '#334155' },
        });
        this.extraFigures.set(key, fig);
      }
      npcSeen.add(key);
      this.#animateFigure(fig, n.x, n.y, n.angle ?? Math.PI / 2, 0, false);
    }
    for (const [k, fig] of this.extraFigures) {
      if (!npcSeen.has(k)) {
        this.scene.remove(fig);
        this.extraFigures.delete(k);
      }
    }

    // --- marcador do objetivo (coluna de luz, estilo GTA) ---
    const target = p.gpsPoint || p.objectivePoint || p.objectiveNpcPoint;
    if (!this.beacon) {
      this.beacon = new THREE.Group();
      const col = new THREE.Mesh(this.geo.beacon, this.mat.beacon);
      col.scale.set(16, 260, 16);
      col.position.y = 130;
      const ring = new THREE.Mesh(this.geo.ring, this.mat.beaconRing);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(26);
      ring.position.y = 4;
      this.beacon.add(col, ring);
      this.beacon.userData.ring = ring;
      this.scene.add(this.beacon);
    }
    this.beacon.visible = Boolean(target);
    if (target) {
      this.beacon.position.set(target.x, 0, target.y);
      this.beacon.userData.ring.scale.setScalar(22 + Math.sin(time * 4) * 4);
    }

    // --- colecionáveis (gemas girando) ---
    if (!this.gems) this.gems = new Map();
    const gemSeen = new Set();
    for (const c of p.worldCollectibles || []) {
      if (c.collected) continue;
      if (Math.abs(c.x - focus.x) > 1100 || Math.abs(c.y - focus.y) > 1100) continue;
      if (c.kind === 'interior' && player.insideLocationCode !== c.locationCode) continue;
      const key = c.id || `${c.x}:${c.y}`;
      let gem = this.gems.get(key);
      if (!gem) {
        const col = c.rarity === 'lendario' ? 0xfacc15 : c.rarity === 'especial' ? 0xb066ff : 0x38d1fb;
        gem = new THREE.Mesh(this.geo.gem, new THREE.MeshBasicMaterial({ color: col }));
        gem.scale.set(6, 9, 6);
        this.scene.add(gem);
        this.gems.set(key, gem);
      }
      gemSeen.add(key);
      gem.position.set(c.x, 14 + Math.sin(time * 3 + c.x) * 3, c.y);
      gem.rotation.y = time * 2;
    }
    for (const [k, gem] of this.gems) {
      if (!gemSeen.has(k)) {
        this.scene.remove(gem);
        this.gems.delete(k);
      }
    }

    // --- balas e explosões ---
    if (!this.fxGroup) {
      this.fxGroup = new THREE.Group();
      this.scene.add(this.fxGroup);
    }
    this.fxGroup.clear();
    for (const b of p.bullets || []) {
      if (!b.alive) continue;
      const m = new THREE.Mesh(this.geo.box, this.mat.bullet);
      m.scale.set(8, 1.2, 1.2);
      m.position.set(b.x, 14, b.y);
      m.rotation.y = -Math.atan2(b.vy, b.vx);
      this.fxGroup.add(m);
    }
    for (const e of p.explosions || []) {
      const k = Math.min(1, (e.age ?? e.timer ?? 0) / (e.duration || 0.8));
      const m = new THREE.Mesh(this.geo.sphere, this.mat.fire);
      m.scale.setScalar(20 + k * 50);
      m.position.set(e.x, 18, e.y);
      this.fxGroup.add(m);
    }

    // --- farol do carro à noite ---
    if (playerVehicle && dark > 0.3) {
      const fx = Math.cos(playerVehicle.angle);
      const fy = Math.sin(playerVehicle.angle);
      this.headlight.intensity = 900 * dark;
      this.headlight.position.set(playerVehicle.x + fx * 30, 16, playerVehicle.y + fy * 30);
      this.headlight.target.position.set(playerVehicle.x + fx * 260, 0, playerVehicle.y + fy * 260);
    } else {
      this.headlight.intensity = 0;
    }

    // --- câmera ---
    this.#updateCamera(player, playerVehicle, dt);
    this.composer.render();
  }

  #updateCamera(player, vehicle, dt) {
    let pos;
    let look;
    if (vehicle) {
      // atrás do veículo, afastando com a velocidade
      const spd = Math.abs(vehicle.speed || 0);
      const dist = 110 + Math.min(120, spd * 0.18);
      const fx = Math.cos(vehicle.angle);
      const fy = Math.sin(vehicle.angle);
      pos = new THREE.Vector3(vehicle.x - fx * dist, 62 + Math.min(40, spd * 0.05), vehicle.y - fy * dist);
      look = new THREE.Vector3(vehicle.x + fx * 60, 12, vehicle.y + fy * 60);
    } else {
      // a pé: câmera alta olhando para o "norte", assim W/A/S/D continuam iguais
      pos = new THREE.Vector3(player.x, 112, player.y + 128);
      look = new THREE.Vector3(player.x, 16, player.y - 22);
    }
    if (!this.camPos) {
      this.camPos = pos.clone();
      this.camLook.copy(look);
    }
    const k = 1 - Math.exp(-dt * (vehicle ? 4.5 : 6));
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  #resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w;
    this.lastH = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Mundo (x, y, altura) → pixels na tela (para balões, nomes e avisos do HUD). */
  worldToScreen(x, y, z = 30) {
    const v = new THREE.Vector3(x, z, y).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.lastW, y: (-v.y * 0.5 + 0.5) * this.lastH, behind: v.z > 1 };
  }

  /** Pixels na tela → ponto no chão do mundo (para a mira do mouse). */
  screenToWorld(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.lastW) * 2 - 1, -(sy / this.lastH) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -12);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x, y: hit.z };
  }
}

// mesmo sorteio de modelo usado na visão 2D
const CAR_BY_NAME = { 'Cupê Esportivo': 'car-sport', 'Compacto Retrô': 'car-hatch' };
const SEDAN_VARIANTS = ['car', 'car', 'car-suv', 'car-pickup'];
function pickCarModel(v) {
  if (v.police) return 'car';
  if (v.special) return 'car-sport';
  if (CAR_BY_NAME[v.model]) return CAR_BY_NAME[v.model];
  const id = String(v.id || '');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SEDAN_VARIANTS[h % SEDAN_VARIANTS.length];
}

// Peça com perfil lateral (pontos x,y) extrudada na largura (eixo z), centrada
function profileMesh(points, depth, material) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, bevelSegments: 2 });
  geo.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// O segmento (x0,y0)→(x1,y1) passa pelo retângulo (com folga)?
function segmentHitsRect(x0, y0, x1, y1, r, pad = 0) {
  const minX = r.x - pad;
  const maxX = r.x + r.w + pad;
  const minY = r.y - pad;
  const maxY = r.y + r.h + pad;
  // dentro do prédio (protagonista lá dentro) não conta: o prédio já some
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, x0 - minX) && clip(dx, maxX - x0) && clip(-dy, y0 - minY) && clip(dy, maxY - y0) && t0 <= t1;
}
