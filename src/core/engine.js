import { CityMap } from '../world/city-map.js?v=30';
import { RoadPathfinder } from '../world/pathfinding.js';
import { TrafficManager } from '../world/traffic-manager.js?v=24';
import { BoatManager } from '../world/boat-manager.js?v=17';
import { InputManager } from '../input/input-manager.js?v=21';
import { WebGLRenderer } from '../render/webgl-renderer.js?v=51';
import { isInWater, resolveCircleStaticObstacle, resolveEntityCollisions, resolveVehiclePairCollision } from '../physics/collision.js?v=11';
import {
  applyPedestrianDamage,
  applyVehicleDamage,
  computeShockwaveDamage,
  computeShockwaveFalloff,
  createTrashBinEntity,
  createVehicleEntity,
  evaluateVehicleImpact,
  findNearestVehicle,
  findSafeExitPosition,
  hitTrashBin,
  isTouchingVehicle,
  resolvePedestrianEnvironmentCollisions,
  updateEjectedPlayer,
  updatePedestrian,
  updateTrashBin,
  updateVehicle,
  updateVehicleCriticalState,
  VEHICLE_PROFILES
} from '../physics/vehicle-physics.js?v=20';
import { Minimap } from '../ui/minimap.js?v=27';
import { Inventory } from './inventory.js?v=20';
import { createSaveSnapshot, saveGameState } from './save-state.js?v=2';
import { getPendingMissionAssetUrls, preloadMissionAssets } from '../story/story-loader.js';
import { createPartner, pickLine, updatePartner } from '../world/partner.js?v=3';
import { createCheatBuffer, SPECIAL_CAR_PROFILE, turboProfile } from './cheats.js?v=3';
import {
  createArsenal, cycleWeapon, giveAllWeapons, giveWeapon, selectWeapon, startReload, stepBullets, tickArsenal, tryFire, WEAPONS, WEAPON_ORDER,
} from './weapons.js?v=1';
import {
  clearWanted, createWanted, CRIMES, desiredPoliceCars, driveToward, gridRoute, POLICE_PROFILE, reportCrime, stars as wantedStars, tickWanted,
} from './police.js?v=2';
import {
  addMoney, collectibleReward, comboActive, createWallet, GARAGE_SHOP, GUN_SHOP, missionReward, multiplierFor, PAINT_COLORS, REWARDS, spend, tickCombo,
} from './economy.js?v=2';
import { getDifficulty, loadDifficultyId, policeCarsFor, saveDifficultyId } from './difficulty.js?v=1';

// Logos dos telhados das lojas (SVG embutido)
const svgData = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const SHOP_LOGOS = {
  gun: svgData('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="#fff" stroke="#111" stroke-width="3"/><path d="M12 26h30l4-4h6v10H40l-3 3h-7l-2 9h-8l2-9h-10z" fill="#111"/><circle cx="32" cy="32" r="22" fill="none" stroke="#b91c1c" stroke-width="3" stroke-dasharray="4 5"/></svg>'),
  garage: svgData('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="#fff" stroke="#111" stroke-width="3"/><path d="M41 14a10 10 0 0 0-9 13L15 44l5 5 17-17a10 10 0 0 0 13-9l-6 4-5-2-2-5z" fill="#1d4ed8" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>'),
};

const PEDESTRIAN_CHAT_LINES = [
  'Opa! Cuidado com o trânsito por aqui!',
  'Você viu onde deixei a chave do meu carro?',
  'Dia bonito para dar uma volta na praça, né?',
  'Dizem que o Empório São Jorge tem as melhores entregas!',
  'Ei, você parece com pressa! Tá fazendo alguma missão?',
  'Se acelerar demais nas curvas vai sair derrapando!',
  'Tô só dando uma caminhada tranquila na calçada.',
  'Hoje a cidade está bem movimentada!',
  'Cuidado para não cair na água nas bordas da ilha!',
  'Se precisar de carona, tem vários carros estacionados por aí.'
];

export class Engine {
  constructor(canvas, minimapCanvas, touchControlsEl, hud, options = {}) {
    this.canvas = canvas;
    this.hud = hud;
    this.renderer = new WebGLRenderer(canvas);
    // Visão: '2d' (de cima), '25d' (prédios com altura) ou '3d' (3D completo, câmera atrás)
    this.viewMode = '25d';
    try {
      const saved = localStorage.getItem('gta-visao');
      if (saved === '2d' || saved === '25d' || saved === '3d') this.viewMode = saved;
      else if (localStorage.getItem('gta-visao-3d') === '0') this.viewMode = '2d';
    } catch { /* sem storage */ }
    this.renderer3d = null;
    this.#applyViewMode(false);
    // botão de câmera no HUD e escolha no menu de pausa
    this.onCameraButton = () => this.setViewMode({ '2d': '25d', '25d': '3d', '3d': '2d' }[this.viewMode] || '25d');
    document.getElementById('camera-button')?.addEventListener('click', this.onCameraButton);
    this.onViewPicker = (ev) => {
      const btn = ev.target.closest('[data-view]');
      if (btn) this.setViewMode(btn.dataset.view);
    };
    document.querySelector('[data-view-picker]')?.addEventListener('click', this.onViewPicker);
    this.minimap = new Minimap(minimapCanvas);
    this.input = new InputManager(touchControlsEl);

    this.cityMap = options.cityMap || null;
    this.storyPackage = options.storyPackage || null;
    this.storyKey = options.storyKey || this.storyPackage?.title || 'default';
    this.locationNames = this.storyPackage?.locationNames || new Map();
    this.#initCameraZoom(canvas);
    this.#initProtagonistHud();
    this.#initPartner();
    this.cheatBuffer = createCheatBuffer();
    this.#initWeapons(canvas);
    this.#initEconomy();
    this.#initPolice();
    // Modo de depuração: ?debug=1 expõe o motor no console (window.gta)
    try {
      if (new URLSearchParams(window.location.search).get('debug') === '1') window.gta = this;
    } catch { /* sem window */ }
    this.cutscene = options.cutscene || null;
    this.pauseMenu = options.pauseMenu || null;
    this.inventoryController = options.inventoryController || null;
    this.preloadedUrls = options.preloadedUrls || new Set();
    this.onExitToTitle = options.onExitToTitle || null;
    this.onChangeStory = options.onChangeStory || null;
    this.onNewGame = options.onNewGame || null;
    this.onRefreshAssets = options.onRefreshAssets || null;
    this.onResetGame = options.onResetGame || null;

    this.inventory = new Inventory();
    this.awaitingExitTarget = false;
    this.currentMissionIndex = 0;
    this.freeRoamMode = !this.storyPackage;
    this.missionOutTriggered = false;
    this.completedNpcPoints = [];
    this.encounterNpcs = [];
    this.encounterLocationCodes = new Map();
    this.paused = false;
    this.hudDisplayHealth = 100;
    this.wasInsideHospital = false;
    this.collectibleFullToastCooldown = 0;
    this.worldCollectibles = [];
    this.collectedExtraIds = new Set();
    this.unlockedMissionIndices = new Set([0]);

    this.pathfinder = null;
    this.trafficManager = null;
    this.vehicles = [];
    this.activeChunkKeys = new Set();
    this.lastVehicleChunkKey = null;
    this.skidMarks = [];
    this.bloodMarks = [];
    this.smokeParticles = [];
    this.explosions = [];
    this.routePoints = [];
    this.objectiveCode = null;
    this.objectivePoint = null;
    this.objectiveNpcPoint = null;
    this.completedNpcPoints = [];
    this.objectiveLocationType = null;
    this.routeTimer = 0;
    this.elapsedTime = 0;
    this.lastTimestamp = 0;
    this.running = false;

    this.player = {
      x: 0,
      y: 0,
      angle: 0,
      speed: 0,
      walkPhase: 0,
      radius: 11,
      health: 100,
      isDead: false,
      deathReason: null,
      inVehicleId: null,
      insideLocationCode: null,
      currentLocationCode: null,
      sinkScale: 1,
      sinkAlpha: 1,
      sinkProgress: 0,
      knockdownTimer: 0,
      ejected: { active: false, vx: 0, vy: 0, hitCooldown: 0, graceTimer: 0, sourceVehicleId: null },
      sinking: { active: false, timer: 0, duration: 1.35, vehicleId: null, vx: 0, vy: 0 }
    };

    this.camera = { x: 0, y: 0 };
    this.hud.onRestartClick(() => {
      if (this.storyPackage && !this.freeRoamMode) {
        this.startMission(this.currentMissionIndex, { skipIntro: true });
      } else {
        this.resetMatch();
      }
    });

    this.hud.onInventoryClick(() => {
      if (!this.running || this.player.isDead || this.deathSequence || this.cutscene?.active || this.hud.isMissionCompleteOpen() || this.paused) {
        return;
      }
      if (this.inventoryController?.isOpen) {
        if (this.inventoryController.mode === 'browse') this.inventoryController.close();
      } else {
        this.openInventory();
      }
    });
    this.#syncInventoryHud();

    this.hud.onMinimapClick(() => {
      if (!this.running || this.player.isDead || this.deathSequence || this.cutscene?.active || this.hud.isMissionCompleteOpen() || this.inventoryController?.isOpen || this.paused) {
        return;
      }
      this.openExpandedMap();
    });
    this.hud.onExpandedMapClose(() => this.closeExpandedMap());
    this.hud.onExpandedMapTransform((action) => this.#applyExpandedMapTransform(action));
    this.expandedMapView = { zoom: 1, centerX: 0, centerY: 0 };

    this.#onKeyDown = (e) => {
      if (!this.running || this.player.isDead || this.deathSequence || this.hud.isMissionCompleteOpen()) return;
      if (this.shopOpen) return; // a loja trata o próprio teclado
      if (e.key === 'Escape' && this.hud.isExpandedMapOpen()) {
        this.closeExpandedMap();
        return;
      }
      if (e.key === 'Escape' && this.inventoryController?.isOpen) {
        this.inventoryController.close();
        return;
      }
      if (this.cutscene?.active) return;
      if (!this.paused && !this.inventoryController?.isOpen && !this.hud.isExpandedMapOpen() && !e.repeat) {
        const cheat = this.cheatBuffer.push(e.key);
        if (cheat) {
          this.#activateCheat(cheat);
          return; // a última letra do código não aciona a função normal da tecla
        }
      }
      if (!this.paused && !this.inventoryController?.isOpen && !this.hud.isExpandedMapOpen()) {
        if (/^Digit[1-4]$/.test(e.code)) {
          selectWeapon(this.weapons.arsenal, WEAPON_ORDER[Number(e.code.slice(5)) - 1]);
        } else if (e.code === 'KeyG' && !e.repeat) {
          cycleWeapon(this.weapons.arsenal, 1);
        } else if (e.code === 'KeyR') {
          startReload(this.weapons.arsenal);
        } else if (e.code === 'KeyV' && !e.repeat) {
          // Troca a visão: 2D → 2.5D → 3D completo → 2D
          this.onCameraButton();
        }
      }
      if (e.key === 'i' || e.key === 'I' || e.key === 'Tab') {
        e.preventDefault();
        if (this.hud.isExpandedMapOpen()) this.closeExpandedMap();
        if (this.inventoryController?.isOpen) {
          if (this.inventoryController.mode === 'browse') this.inventoryController.close();
        } else if (!this.paused) {
          this.openInventory();
        }
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        if (this.hud.isExpandedMapOpen()) {
          this.closeExpandedMap();
        } else if (!this.paused && !this.inventoryController?.isOpen) {
          this.openExpandedMap();
        }
        return;
      }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (this.inventoryController?.isOpen || this.hud.isExpandedMapOpen() || this.pauseMenu?.confirmDialog?.isOpen || this.pauseMenu?.assetsRefreshDialog?.isOpen) return;
        if (this.pauseMenu?.isOpen) this.pauseMenu.close();
        else this.pauseMenu?.open();
      }
    };
    window.addEventListener('keydown', this.#onKeyDown);
  }

  #onKeyDown = null;

  initWorld() {
    this.hud.showLoading(35, 'Gerando ilha e cidade-base 30x30...');
    if (!this.cityMap) {
      this.cityMap = new CityMap();
    }
    this.#buildEncounterNpcs();
    this.pathfinder = new RoadPathfinder(this.cityMap);

    this.hud.showLoading(70, 'Iniciando tráfego e pedestres...');
    this.resetMatch();

    this.#handleResize();
    this.#onResize = () => this.#handleResize();
    window.addEventListener('resize', this.#onResize);

    this.#onPageHide = () => this.#persistSaveState();
    this.#onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        this.#persistSaveState();
      }
    };
    window.addEventListener('pagehide', this.#onPageHide);
    document.addEventListener('visibilitychange', this.#onVisibilityChange);

    this.hud.showLoading(100, 'Pronto!');
    console.info('[Engine] Cidade-ilha inicializada com', this.cityMap.locationsByCode.size, 'locais codificados.');
  }

  #onResize = null;
  #onPageHide = null;
  #onVisibilityChange = null;

  stop() {
    this.#persistSaveState();
    this.hud.clearNpcSpeechBubbles?.();
    this.running = false;
    if (this.#onKeyDown) window.removeEventListener('keydown', this.#onKeyDown);
    if (this.onDifficultyEvent) window.removeEventListener('gta-difficulty', this.onDifficultyEvent);
    document.getElementById('camera-button')?.removeEventListener('click', this.onCameraButton);
    document.querySelector('[data-view-picker]')?.removeEventListener('click', this.onViewPicker);
    if (this.#onResize) window.removeEventListener('resize', this.#onResize);
    if (this.#onPageHide) window.removeEventListener('pagehide', this.#onPageHide);
    if (this.#onVisibilityChange) document.removeEventListener('visibilitychange', this.#onVisibilityChange);
  }

  #persistSaveState() {
    if (!this.storyPackage || this.player?.isDead || this.deathSequence) return;
    const snapshot = createSaveSnapshot({
      storyKey: this.storyKey || this.storyPackage.title || 'default',
      currentMissionIndex: this.currentMissionIndex,
      unlockedMissionIndices: [...this.unlockedMissionIndices],
      freeRoamMode: this.freeRoamMode,
      itemPickedUp: this.itemPickedUp,
      inventorySlots: this.inventory.getSlots(),
      collectedExtraIds: [...this.collectedExtraIds],
      completedNpcPoints: this.completedNpcPoints,
      player: {
        x: this.player.x,
        y: this.player.y,
        angle: this.player.angle,
        health: this.player.health,
      },
    });
    saveGameState(snapshot);
    this.#saveEconomy();
  }

  applyRefreshedStoryPackage(freshPackage) {
    if (!freshPackage) return;
    this.storyPackage = freshPackage;
    this.locationNames = freshPackage.locationNames || new Map();
    this.#buildEncounterNpcs();
    if (this.freeRoamMode || !freshPackage.missions?.length) return;
    const clamped = Math.max(0, Math.min(this.currentMissionIndex, freshPackage.missions.length - 1));
    this.currentMissionIndex = clamped;
    this.pauseMenu?.configure(freshPackage.missions, clamped, {
      unlockedMissionIndices: [...this.unlockedMissionIndices],
      onPauseChange: (isPaused) => {
        this.paused = isPaused;
        if (isPaused) this.#persistSaveState();
      },
      onRestartMission: () => {
        this.startMission(this.currentMissionIndex);
      },
      onSelectMission: (missionIdx) => {
        if (!this.unlockedMissionIndices.has(missionIdx)) return;
        this.missionCheckpoint = null;
        this.startMission(missionIdx);
      },
      onNewGame: () => {
        this.onNewGame?.();
      },
      onRefreshAssets: () => {
        this.onRefreshAssets?.();
      },
      onResetGame: () => {
        this.onResetGame?.();
      },
      onChangeStory: () => {
        this.#persistSaveState();
        this.onChangeStory?.();
      },
      onExitToTitle: () => {
        this.#persistSaveState();
        this.onExitToTitle?.();
      },
    });
    this.#syncInventoryHud();
  }

  async restoreSavedSession(savedState) {
    if (!savedState || !this.storyPackage || !this.storyPackage.missions?.length) {
      return this.startMission(0);
    }

    const clamped = Math.max(
      0,
      Math.min(savedState.currentMissionIndex || 0, this.storyPackage.missions.length - 1),
    );
    this.unlockedMissionIndices = new Set([0, ...(savedState.unlockedMissionIndices || [])]);
    if (!savedState.freeRoamMode) {
      this.unlockedMissionIndices.add(clamped);
    }
    const mission = this.storyPackage.missions[clamped];
    const pendingUrls = getPendingMissionAssetUrls(this.storyPackage, clamped, this.preloadedUrls, {
      includeSplash: false,
    });

    if (pendingUrls.length > 0) {
      this.paused = true;
      this.hud.showLoading(10, `Carregando ${mission.title}...`);
      await preloadMissionAssets(this.storyPackage, clamped, {
        includeSplash: false,
        preloadedUrls: this.preloadedUrls,
        onProgress: ({ loaded, total, ratio }) => {
          this.hud.showLoading(10 + ratio * 85, `Carregando recursos da missão (${loaded}/${total})...`);
        },
      });
      this.hud.showLoading(100, 'Missão pronta!');
      this.hud.showGameHud();
      this.paused = false;
    }

    this.currentMissionIndex = clamped;
    this.freeRoamMode = Boolean(savedState.freeRoamMode);
    this.missionOutTriggered = false;
    this.awaitingExitTarget = false;
    const needsPickup = Boolean(mission.pickupLocation && mission.giveItem);
    this.itemPickedUp = needsPickup ? Boolean(savedState.itemPickedUp) : true;
    const initialObjective = this.freeRoamMode
      ? null
      : (this.itemPickedUp || !needsPickup ? mission.targetLocation : mission.pickupLocation);

    this.resetMatch(mission.startLocation, initialObjective);

    this.inventory.clear();
    for (const slot of savedState.inventorySlots || []) {
      if (slot && !this.inventory.hasItem(slot.id)) {
        this.inventory.addItem(slot);
      }
    }
    this.#syncInventoryHud();

    this.collectedExtraIds = new Set(savedState.collectedExtraIds || []);
    for (const c of this.worldCollectibles) {
      if (this.collectedExtraIds.has(c.id) || this.inventory.hasItem(c.id)) {
        c.collected = true;
        this.collectedExtraIds.add(c.id);
      }
    }
    this.worldCollectibles = this.worldCollectibles.filter((c) => !c.collected);

    this.completedNpcPoints = Array.isArray(savedState.completedNpcPoints)
      ? savedState.completedNpcPoints.map((pt) => ({ x: pt.x, y: pt.y }))
      : [];

    if (savedState.player) {
      this.player.x = savedState.player.x;
      this.player.y = savedState.player.y;
      this.player.angle = savedState.player.angle || 0;
      this.player.health = savedState.player.health || 100;
      this.hudDisplayHealth = this.player.health;
      this.player.inVehicleId = null;
      this.camera.x = this.player.x;
      this.camera.y = this.player.y;
      this.#syncActiveChunks(this.player.x, this.player.y);
    }

    this.pauseMenu?.configure(this.storyPackage.missions, clamped, {
      unlockedMissionIndices: [...this.unlockedMissionIndices],
      onPauseChange: (isPaused) => {
        this.paused = isPaused;
        if (isPaused) this.#persistSaveState();
      },
      onRestartMission: () => {
        this.startMission(this.currentMissionIndex);
      },
      onSelectMission: (missionIdx) => {
        if (!this.unlockedMissionIndices.has(missionIdx)) return;
        this.missionCheckpoint = null;
        this.startMission(missionIdx);
      },
      onNewGame: () => {
        this.onNewGame?.();
      },
      onRefreshAssets: () => {
        this.onRefreshAssets?.();
      },
      onResetGame: () => {
        this.onResetGame?.();
      },
      onChangeStory: () => {
        this.#persistSaveState();
        this.onChangeStory?.();
      },
      onExitToTitle: () => {
        this.#persistSaveState();
        this.onExitToTitle?.();
      },
    });

    if (!this.freeRoamMode) {
      const bannerObjective = !this.itemPickedUp && needsPickup
        ? (mission.pickupObjective || mission.objective)
        : mission.objective;
      this.hud?.showMissionBanner?.(clamped + 1, bannerObjective);
    } else {
      this.hud?.showToast?.('Modo exploração livre restaurado.');
    }
    this.#persistSaveState();
  }

  async startMission(index, { skipIntro = false, preserveState = false } = {}) {
    if (!this.storyPackage || !this.storyPackage.missions?.length) {
      this.freeRoamMode = true;
      this.resetMatch();
      return;
    }

    const clamped = Math.max(0, Math.min(index, this.storyPackage.missions.length - 1));
    this.unlockedMissionIndices.add(0);
    this.unlockedMissionIndices.add(clamped);
    const mission = this.storyPackage.missions[clamped];
    const pendingUrls = getPendingMissionAssetUrls(this.storyPackage, clamped, this.preloadedUrls, {
      includeSplash: false
    });

    if (pendingUrls.length > 0) {
      this.paused = true;
      this.hud.showLoading(10, `Carregando ${mission.title}...`);
      await preloadMissionAssets(this.storyPackage, clamped, {
        includeSplash: false,
        preloadedUrls: this.preloadedUrls,
        onProgress: ({ loaded, total, ratio }) => {
          this.hud.showLoading(10 + ratio * 85, `Carregando recursos da missão (${loaded}/${total})...`);
        }
      });
      this.hud.showLoading(100, 'Missão pronta!');
      this.hud.showGameHud();
      this.paused = false;
    }

    this.currentMissionIndex = clamped;
    this.freeRoamMode = false;
    this.missionOutTriggered = false;
    this.completedNpcPoints = [];
    this.awaitingExitTarget = false;
    const needsPickup = Boolean(mission.pickupLocation && mission.giveItem);
    this.itemPickedUp = !needsPickup;
    const initialObjective = needsPickup ? mission.pickupLocation : mission.targetLocation;

    if (preserveState) {
      const currentVehicle = this.player.inVehicleId
        ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
        : null;
      this.player.speed = 0;
      if (currentVehicle) {
        currentVehicle.vx = 0;
        currentVehicle.vy = 0;
        currentVehicle.speed = 0;
      }
      this.setObjective(initialObjective);
      this.#syncActiveChunks(this.player.x, this.player.y);
      this.trafficManager?.normalizeTrafficAtMissionStart?.(this.vehicles, this.player);
      this.hud.hideGameOver();
      this.missionCheckpoint = {
        missionIndex: clamped,
        x: this.player.x,
        y: this.player.y,
        angle: this.player.angle,
        health: this.player.health,
        inVehicleId: this.player.inVehicleId,
        vehiclePos: currentVehicle ? { x: currentVehicle.x, y: currentVehicle.y, angle: currentVehicle.angle } : null,
        inventorySlots: this.inventory.getSlots()
      };
    } else if (this.missionCheckpoint && this.missionCheckpoint.missionIndex === clamped) {
      const cp = this.missionCheckpoint;
      this.resetMatch(mission.startLocation, initialObjective);
      this.inventory.restorePreservingExtras(cp.inventorySlots);
      this.#syncInventoryHud();
      if (needsPickup && mission.giveItem && this.inventory.hasItem(mission.giveItem)) {
        this.itemPickedUp = true;
        this.setObjective(mission.targetLocation);
      }
      this.player.x = cp.x;
      this.player.y = cp.y;
      this.player.angle = cp.angle;
      this.player.health = cp.health;
      this.player.inVehicleId = cp.inVehicleId;
      if (cp.inVehicleId && cp.vehiclePos) {
        const v = this.vehicles.find((veh) => veh.id === cp.inVehicleId);
        if (v) {
          v.x = cp.vehiclePos.x;
          v.y = cp.vehiclePos.y;
          v.angle = cp.vehiclePos.angle;
          v.driver = 'player';
          v.isParked = false;
        }
      }
      this.camera.x = this.player.x;
      this.camera.y = this.player.y;
    } else {
      this.missionCheckpoint = null;
      this.inventory.restorePreservingExtras();
      this.#syncInventoryHud();
      this.resetMatch(mission.startLocation, initialObjective);
    }

    this.pauseMenu?.configure(this.storyPackage.missions, clamped, {
      unlockedMissionIndices: [...this.unlockedMissionIndices],
      onPauseChange: (isPaused) => {
        this.paused = isPaused;
        if (isPaused) this.#persistSaveState();
      },
      onRestartMission: () => {
        this.startMission(this.currentMissionIndex);
      },
      onSelectMission: (missionIdx) => {
        if (!this.unlockedMissionIndices.has(missionIdx)) return;
        this.missionCheckpoint = null;
        this.startMission(missionIdx);
      },
      onNewGame: () => {
        this.onNewGame?.();
      },
      onRefreshAssets: () => {
        this.onRefreshAssets?.();
      },
      onResetGame: () => {
        this.onResetGame?.();
      },
      onChangeStory: () => {
        this.#persistSaveState();
        this.onChangeStory?.();
      },
      onExitToTitle: () => {
        this.#persistSaveState();
        this.onExitToTitle?.();
      }
    });

    const onMapReady = () => {
      if (!needsPickup && mission.giveItem && !this.inventory.hasItem(mission.giveItem)) {
        this.#grantMissionItem(mission.giveItem);
      }
      const bannerObjective = needsPickup
        ? (mission.pickupObjective || mission.objective)
        : mission.objective;
      this.hud?.showMissionBanner?.(clamped + 1, bannerObjective);
      this.#persistSaveState();
    };

    if (!skipIntro && mission.introCutscene?.steps?.length > 0 && this.cutscene) {
      this.cutscene.play(mission.introCutscene, this.storyPackage.characters, () => {
        onMapReady();
      });
    } else {
      onMapReady();
    }
  }

  #syncInventoryHud() {
    this.hud?.setInventoryCount?.(this.inventory.getCount(), this.inventory.capacity);
  }

  #grantMissionItem(itemId, overrides = {}) {
    const itemDef = this.storyPackage?.items?.get(itemId);
    if (!itemDef) return;
    const res = this.inventory.addItem({ ...itemDef, ...overrides });
    if (!res.ok && res.reason === 'inventory_full') {
      console.warn(`[Engine] Inventário cheio (${this.inventory.capacity}/${this.inventory.capacity}); não foi possível adicionar "${itemDef.name}".`);
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(`Inventário cheio (${this.inventory.capacity}/${this.inventory.capacity})! Não foi possível guardar "${itemDef.name}".`);
      }
      return;
    }
    this.#syncInventoryHud();
    this.#persistSaveState();
  }

  openInventory() {
    if (!this.inventoryController || this.inventoryController.isOpen) return;
    this.inventoryController.openBrowse(this.inventory, () => {
      this.#syncInventoryHud();
    });
  }

  resetMatch(startCode = 'CASA-001', targetCode = null) {
    this.vehicles = [];
    if (this.wanted) {
      clearWanted(this.wanted);
      this.policeCars = [];
      this.policeBullets = [];
      this.bustTimer = 0;
    }
    this.trashBins = [];
    this.activeChunkKeys = new Set();
    this.lastVehicleChunkKey = null;
    this.trafficManager = new TrafficManager(this.cityMap, { chunkManaged: true });
    this.boatManager = new BoatManager(this.cityMap);
    this.skidMarks = [];
    this.bloodMarks = [];
    this.smokeParticles = [];
    this.explosions = [];
    this.pendingGameOver = null;
    this.deathSequence = null;
    this.hud?.setDeathDesaturation?.(0);
    this.missionOutTriggered = false;
    this.completedNpcPoints = [];

    const startLoc = this.cityMap.resolveLocationCode(startCode);
    this.player.x = startLoc.spawnPoint.x;
    this.player.y = startLoc.spawnPoint.y;
    this.player.angle = 0;
    this.player.speed = 0;
    this.player.walkPhase = 0;
    this.player.health = 100;
    this.hudDisplayHealth = 100;
    this.wasInsideHospital = false;
    this.collectibleFullToastCooldown = 0;
    this.worldCollectibles = [];
    this.collectedExtraIds = new Set();
    if (Array.isArray(this.storyPackage?.extraItems)) {
      for (const item of this.storyPackage.extraItems) {
        if (!item?.worldPoint) continue;
        const alreadyCollected = this.collectedExtraIds.has(item.id) || this.inventory.hasItem(item.id);
        if (alreadyCollected) {
          this.collectedExtraIds.add(item.id);
          continue;
        }
        this.worldCollectibles.push({
          id: item.id,
          name: item.name,
          description: item.description,
          imageUrl: item.imageUrl,
          x: item.worldPoint.x,
          y: item.worldPoint.y,
          kind: item.worldPoint.kind,
          locationCode: item.worldPoint.code,
          rarity: item.rarity || 'normal',
          collected: false
        });
      }
    }
    this.player.burnCooldown = 0;
    this.player.isDead = false;
    this.player.deathReason = null;
    this.player.inVehicleId = null;
    this.player.insideLocationCode = null;
    this.player.sinkScale = 1;
    this.player.sinkAlpha = 1;
    this.player.sinkProgress = 0;
    this.player.knockdownTimer = 0;
    this.player.ejected = { active: false, vx: 0, vy: 0, hitCooldown: 0, graceTimer: 0, sourceVehicleId: null };
    this.player.sinking = { active: false, timer: 0, duration: 1.35, vehicleId: null, vx: 0, vy: 0 };

    this.camera.x = this.player.x;
    this.camera.y = this.player.y;

    this.setObjective(targetCode);
    this.#syncActiveChunks(this.player.x, this.player.y);
    this.trafficManager?.normalizeTrafficAtMissionStart?.(this.vehicles, this.player);
    this.hud.hideGameOver();
  }

  #syncActiveChunks(anchorX, anchorY) {
    if (typeof this.cityMap?.getActiveChunks !== 'function') return;
    const current = this.cityMap.getChunkCoordsAt(anchorX, anchorY);
    if (this.lastVehicleChunkKey === current.key && this.activeChunkKeys.size > 0) {
      return;
    }

    const activeChunks = this.cityMap.getActiveChunks(anchorX - 10, anchorY - 10, anchorX + 10, anchorY + 10, 1);
    const nextKeys = new Set(activeChunks.map((c) => c.key));

    // Remove veículos de chunks que saíram da vizinhança ativa (preservando o carro do jogador, próximos ou em chamas)
    if (this.vehicles.length > 0) {
      this.vehicles = this.vehicles.filter((v) => {
        if (v.id === this.player.inVehicleId) return true;
        if (v.destroyed || v.burning || v.isCritical || v.claimedByPedId) return true;
        if (nextKeys.has(v.chunkKey)) return true;
        const posChunk = this.cityMap.getChunkCoordsAt(v.x, v.y);
        if (nextKeys.has(posChunk.key)) return true;
        return Math.hypot(v.x - this.player.x, v.y - this.player.y) < 1100;
      });
    }

    // Remove lixeiras de chunks que saíram da vizinhança ativa
    if (this.trashBins.length > 0) {
      this.trashBins = this.trashBins.filter((bin) => {
        if (nextKeys.has(bin.chunkKey)) return true;
        const posChunk = this.cityMap.getChunkCoordsAt(bin.x, bin.y);
        return nextKeys.has(posChunk.key) || Math.hypot(bin.x - this.player.x, bin.y - this.player.y) < 1100;
      });
    }

    const existingVehIds = new Set(this.vehicles.map((v) => v.id));
    const existingBinIds = new Set(this.trashBins.map((b) => b.id));
    for (const chunk of activeChunks) {
      if (this.activeChunkKeys.has(chunk.key)) continue;
      for (const spawn of chunk.vehicleSpawns) {
        if (existingVehIds.has(spawn.id)) continue;
        if (Math.hypot(spawn.x - this.player.x, spawn.y - this.player.y) < 90) continue;
        const veh = createVehicleEntity(spawn);
        veh.chunkKey = spawn.chunkKey;
        veh.vx = Math.cos(veh.angle) * 135;
        veh.vy = Math.sin(veh.angle) * 135;
        veh.speed = 135;
        this.vehicles.push(veh);
        existingVehIds.add(veh.id);
      }
      for (const binSpawn of chunk.trashBinSpawns || []) {
        if (existingBinIds.has(binSpawn.id)) continue;
        const bin = createTrashBinEntity(binSpawn);
        bin.chunkKey = binSpawn.chunkKey;
        this.trashBins.push(bin);
        existingBinIds.add(bin.id);
      }
    }

    this.trafficManager?.syncPedestrianChunks?.(activeChunks, nextKeys, this.player, this.activeChunkKeys);

    this.activeChunkKeys = nextKeys;
    this.lastVehicleChunkKey = current.key;
  }

  applyDamage(amount, fatalReason = 'Você se deu mal!', { bypassResistance = false, bypassKnockdown = false } = {}) {
    if (this.player.isDead || amount <= 0) return;
    if (!bypassKnockdown && (this.player.knockdownTimer || 0) > 0) return;
    const diffMult = this.difficulty?.damageTaken ?? 1;
    const effectiveDamage = Math.max(1, Math.round((bypassResistance ? amount : amount * 0.55) * diffMult));
    this.player.health = Math.max(0, this.player.health - effectiveDamage);
    this.hud.triggerDamageFlash();
    if (this.player.health <= 0) {
      this.triggerGameOver(fatalReason);
    }
  }

  triggerGameOver(reason) {
    if (this.player.isDead || this.deathSequence) return;
    this.pendingGameOver = null;
    this.player.health = 0;
    this.player.deathReason = reason;
    this.deathSequence = {
      timer: 0,
      duration: 3.0,
      reason
    };
  }

  #finalizeGameOver(reason) {
    this.deathSequence = null;
    this.player.isDead = true;
    this.player.health = 0;
    this.player.deathReason = reason;
    this.hud?.setDeathDesaturation?.(1);
    this.hud.showGameOver(reason);
  }

  getLocationDisplayName(code) {
    if (!code) return '';
    return this.locationNames.get(code) || code;
  }

  setObjective(code) {
    if (!code) {
      this.objectiveCode = null;
      this.objectivePoint = null;
      this.objectiveNpcPoint = null;
      this.objectiveLocationType = null;
      this.routePoints = [];
      return;
    }
    const target = this.cityMap.resolveLocationCode(code);
    this.objectiveCode = target.code;
    this.objectivePoint = { ...target.spawnPoint, doorSide: target.doorSide || null };
    this.objectiveLocationType = target.type || null;
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    const spriteTop = this.#getMissionNpcSpriteTop(activeMission);
    if ((target.type === 'commerce' || target.type === 'house') && target.bounds) {
      this.objectiveNpcPoint = {
        x: target.bounds.x + target.bounds.w * 0.5,
        y: target.bounds.y + target.bounds.h * 0.55,
        location: target.code,
        angle: Math.PI * 0.5,
        spriteTop,
      };
    } else {
      this.objectiveNpcPoint = { ...target.spawnPoint, location: target.code, angle: Math.PI * 0.5, spriteTop };
    }
    this.routePoints = this.pathfinder.findRoute(this.player.x, this.player.y, this.objectiveCode);
  }

  /** Muda a câmera: '2d', '25d' ou '3d'. */
  setViewMode(mode) {
    if (!['2d', '25d', '3d'].includes(mode)) return;
    this.viewMode = mode;
    try { localStorage.setItem('gta-visao', mode); } catch { /* sem storage */ }
    this.#applyViewMode(true);
  }

  #applyViewMode(announce) {
    const label = { '2d': '2D', '25d': '2.5D', '3d': '3D' }[this.viewMode];
    const badge = document.getElementById('camera-badge');
    if (badge) badge.textContent = label;
    for (const b of document.querySelectorAll('[data-view-picker] [data-view]')) {
      b.classList.toggle('active', b.dataset.view === this.viewMode);
    }
    this.renderer.view3d = this.viewMode === '25d';
    const want3d = this.viewMode === '3d';
    if (want3d && !this.renderer3d && !this.loading3d) {
      this.loading3d = import('../render/three-renderer.js?v=15')
        .then(async ({ Renderer3D }) => {
          const r3 = new Renderer3D(this.canvasEl || this.renderer.canvas, this.renderer.dayCycle);
          await r3.ready;
          this.renderer3d = r3;
          this.renderer3d.setActive(this.viewMode === '3d');
        })
        .catch((err) => {
          console.error('[3D] Falha ao carregar a visão 3D:', err);
          this.hud.showToast('Não foi possível abrir a visão 3D neste computador.', 3500);
          this.viewMode = '25d';
          this.renderer.view3d = true;
        })
        .finally(() => { this.loading3d = null; });
    }
    this.renderer3d?.setActive(want3d);
    if (announce) {
      const msg = { '2d': 'Visão 2D (de cima)', '25d': 'Visão 2.5D (prédios com altura)', '3d': 'Visão 3D (câmera atrás)' }[this.viewMode];
      this.hud.showToast(`${msg} · V troca`, 2200);
    }
  }

  #is3dActive() {
    return this.viewMode === '3d' && Boolean(this.renderer3d);
  }

  #characterColors(id) {
    const c = this.storyPackage?.characters?.get?.(id);
    if (!c) return {};
    const sleeve = c.sleeveColor || null;
    // camiseta: a protagonista usa camiseta escura com manga longa; quem não tem cor própria usa a manga
    const shirt = id === this.storyPackage?.protagonist ? (c.pantsColor || '#1e1e23') : (sleeve || '#2c6a43');
    return { shirt, sleeve, pants: c.pantsColor, skin: c.skinColor, shoes: c.shoeColor };
  }

  // lift: quanto acima do ponto (em 2D vira deslocamento para cima na tela; em 3D, altura)
  #worldToScreen(worldX, worldY0, lift = 0) {
    if (this.#is3dActive()) return this.renderer3d.worldToScreen(worldX, worldY0, 16 + lift * 0.6);
    const worldY = worldY0 - lift;
    const zoom = this.renderer?.zoom || 1;
    const viewW = this.renderer?.viewWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
    const viewH = this.renderer?.viewHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);
    return {
      x: (worldX - this.camera.x) * zoom + viewW * 0.5,
      y: (worldY - this.camera.y) * zoom + viewH * 0.5
    };
  }

  #buildEncounterNpcs() {
    this.encounterNpcs = [];
    this.encounterLocationCodes = new Map();
    if (!this.cityMap) return;
    if (this.storyPackage?.mapRoofs instanceof Map) {
      for (const [code, roof] of this.storyPackage.mapRoofs.entries()) {
        this.encounterLocationCodes.set(code, {
          roofColor: roof.roofColor || '#d6282e',
          roofLogo: roof.roofLogo || '',
        });
      }
    }
    this.#setupShops();
    const encounters = this.storyPackage?.encounters;
    if (!Array.isArray(encounters) || encounters.length === 0) return;
    for (const encounter of encounters) {
      try {
        const pos = this.cityMap.resolveIndoorOppositePosition(encounter.location);
        this.encounterLocationCodes.set(encounter.location, {
          roofColor: encounter.roofColor || '#d6282e',
          roofLogo: encounter.roofLogo || '',
        });
        this.encounterNpcs.push({
          id: encounter.id,
          npc: encounter.npc,
          location: encounter.location,
          prompt: encounter.prompt,
          cutscene: encounter.cutscene,
          spriteTop: this.storyPackage?.characters?.get(encounter.npc)?.sprites?.top || '',
          x: pos.x,
          y: pos.y,
          angle: pos.angle,
        });
      } catch (err) {
        console.warn(`[Engine] Não foi possível posicionar encontro "${encounter.id}": ${err.message}`);
      }
    }
  }

  #findNearbyEncounterNpc() {
    if (this.player.inVehicleId || !this.player.insideLocationCode) return null;
    for (const npc of this.encounterNpcs) {
      if (npc.location !== this.player.insideLocationCode) continue;
      if (Math.hypot(this.player.x - npc.x, this.player.y - npc.y) < 58) {
        return npc;
      }
    }
    return null;
  }

  #isPickupStageActive() {
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    return Boolean(
      !this.itemPickedUp &&
      activeMission?.pickupLocation &&
      activeMission?.giveItem &&
      this.objectivePoint
    );
  }

  #getProtagonistSprites() {
    const chars = this.storyPackage?.characters;
    if (!(chars instanceof Map) || chars.size === 0) return null;
    const protId = this.storyPackage?.protagonist;
    const protChar = (protId && chars.get(protId)) || chars.values().next().value;
    if (!protChar) return null;
    return {
      ...(protChar.sprites || {}),
      skinColor: protChar.skinColor || '#f1c27d',
      sleeveColor: protChar.sleeveColor || '',
      pantsColor: protChar.pantsColor || '',
      shoeColor: protChar.shoeColor || '',
    };
  }

  #getMissionNpcSpriteTop(mission) {
    if (!mission || !(this.storyPackage?.characters instanceof Map)) return '';
    const protId = this.storyPackage?.protagonist || '';
    const cs = mission.outroCutscene || mission.introCutscene;
    const candidateId = (cs?.rightChar && cs.rightChar !== protId)
      ? cs.rightChar
      : (cs?.leftChar && cs.leftChar !== protId)
        ? cs.leftChar
        : (cs?.rightChar || cs?.leftChar || '');
    return (candidateId && this.storyPackage.characters.get(candidateId)?.sprites?.top) || '';
  }

  #getMissionTargetNpcPoint() {
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    if (!activeMission?.targetLocation || !this.cityMap) return null;
    if (this._cachedTargetNpcMissionId === activeMission.id && this._cachedTargetNpcPoint !== undefined) {
      return this._cachedTargetNpcPoint;
    }
    let pt = null;
    try {
      const target = this.cityMap.resolveLocationCode(activeMission.targetLocation);
      if ((target.type === 'commerce' || target.type === 'house') && target.bounds) {
        pt = {
          x: target.bounds.x + target.bounds.w * 0.5,
          y: target.bounds.y + target.bounds.h * 0.55,
          location: target.code,
          angle: Math.PI * 0.5,
          spriteTop: this.#getMissionNpcSpriteTop(activeMission),
        };
      }
    } catch {
      pt = null;
    }
    this._cachedTargetNpcMissionId = activeMission.id;
    this._cachedTargetNpcPoint = pt;
    return pt;
  }

  #isNearPendingTargetNpc() {
    if (this.player.inVehicleId || !this.#isPickupStageActive()) return false;
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    if (!activeMission || this.player.insideLocationCode !== activeMission.targetLocation) return false;
    const pt = this.#getMissionTargetNpcPoint();
    if (!pt) return false;
    return Math.hypot(this.player.x - pt.x, this.player.y - pt.y) < 58;
  }

  #isNearInteriorStoryNpc() {
    if (this.player.inVehicleId || this.#isPickupStageActive() || !this.objectiveNpcPoint) return false;
    const requiresBuildingEntry =
      this.objectiveLocationType === 'commerce' || this.objectiveLocationType === 'house';
    if (!requiresBuildingEntry) return false;
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    if (!activeMission || this.player.insideLocationCode !== activeMission.targetLocation) return false;
    return Math.hypot(this.player.x - this.objectiveNpcPoint.x, this.player.y - this.objectiveNpcPoint.y) < 58;
  }

  #resolvePlayerMissionNpcCollision() {
    if (this.player.inVehicleId || this.player.isDead) {
      return;
    }
    const npcs = [...(this.completedNpcPoints || []), ...(this.encounterNpcs || [])];
    if (!this.#isPickupStageActive() && !this.missionOutTriggered && !this.freeRoamMode && this.objectiveNpcPoint) {
      npcs.push(this.objectiveNpcPoint);
    } else if (this.#isPickupStageActive() && !this.missionOutTriggered && !this.freeRoamMode) {
      const pendingNpc = this.#getMissionTargetNpcPoint();
      if (pendingNpc) npcs.push(pendingNpc);
    }
    if (npcs.length === 0) return;

    const radius = this.player.radius || 11;
    for (const npc of npcs) {
      const hit = resolveCircleStaticObstacle(this.player.x, this.player.y, radius, npc.x, npc.y, 11);
      if (!hit.collided) continue;
      const env = resolveEntityCollisions(hit.x, hit.y, radius, this.cityMap.getCollidersAround(hit.x, hit.y, 80));
      this.player.x = env.x;
      this.player.y = env.y;
    }
  }

  #findNearestTalkablePedestrian(x, y, maxDist = 52) {
    const peds = this.trafficManager?.pedestrians;
    if (!Array.isArray(peds)) return null;
    let best = null;
    let bestDist = maxDist;
    for (const ped of peds) {
      if (!ped || ped.isDead || ped.knockedDown) continue;
      const d = Math.hypot(x - ped.x, y - ped.y);
      if (d < bestDist) {
        bestDist = d;
        best = ped;
      }
    }
    return best;
  }

  #handleMissionArrival() {
    const mission = this.storyPackage.missions[this.currentMissionIndex];
    if (!mission) return;

    this.player.speed = 0;
    const finishMission = () => {
      if (this.objectiveNpcPoint) {
        const alreadySaved = this.completedNpcPoints.some(
          (pt) => Math.hypot(pt.x - this.objectiveNpcPoint.x, pt.y - this.objectiveNpcPoint.y) < 4
        );
        if (!alreadySaved) {
          this.completedNpcPoints.push({
            x: this.objectiveNpcPoint.x,
            y: this.objectiveNpcPoint.y,
            location: this.objectiveNpcPoint.location,
            angle: this.objectiveNpcPoint.angle,
            spriteTop: this.objectiveNpcPoint.spriteTop || '',
          });
        }
      }
      this.setObjective(null);
      this.#payMissionReward(this.currentMissionIndex, mission);
      const hasNext = this.currentMissionIndex + 1 < this.storyPackage.missions.length;
      this.paused = true;
      this.hud.showMissionComplete(mission.title, hasNext, () => {
        this.paused = false;
        if (hasNext) {
          this.startMission(this.currentMissionIndex + 1, { preserveState: true });
        } else {
          this.freeRoamMode = true;
          this.setObjective(null);
          this.#persistSaveState();
        }
      });
    };

    const openDeliveryModal = (expectedId, onSuccess, onCancel) => {
      this.inventoryController.openDelivery(this.inventory, {
        prompt: mission.deliveryPrompt || 'Escolha o item correto do seu inventário para entregar:',
        expectedItemId: expectedId || mission.requireItem,
        wrongItemMessage: mission.wrongItemMessage || 'Não é esse item que eu procuro!',
        wrongItemMessages: this.storyPackage?.wrongItemLines || [],
        onDeliver: () => {
          this.#syncInventoryHud();
          this.#persistSaveState();
          onSuccess?.();
        },
        onCancel
      });
    };

    const hasInlineDelivery = Boolean(
      mission.outroCutscene?.steps?.some((step) => step.type === 'deliver')
    );

    const runOutro = () => {
      if (mission.outroCutscene?.steps?.length > 0 && this.cutscene) {
        this.cutscene.play(
          mission.outroCutscene,
          this.storyPackage.characters,
          (result) => {
            if (result?.outcome === 'gameover') {
              this.triggerGameOver(result.reason || 'Você falhou na missão.');
            } else {
              finishMission();
            }
          },
          {
            onDeliverRequest: (stepItemId, onDelivered, onCancelled) => {
              if (!this.inventoryController) {
                onDelivered?.();
                return;
              }
              openDeliveryModal(stepItemId, onDelivered, onCancelled);
            }
          }
        );
      } else {
        finishMission();
      }
    };

    if (mission.requireItem && !hasInlineDelivery && this.inventoryController) {
      openDeliveryModal(mission.requireItem, runOutro, () => {
        this.missionOutTriggered = false;
        this.awaitingExitTarget = true;
      });
    } else {
      runOutro();
    }
  }

  #resetExpandedMapView() {
    if (!this.cityMap) return;
    this.expandedMapView = this.minimap.computeInitialExpandedView(
      this.hud.expandedMapCanvas,
      this.cityMap,
      this.player,
      this.objectivePoint,
      window.innerWidth,
      window.innerHeight,
    );
    this.hud.setExpandedMapZoomLabel(this.expandedMapView.zoom);
    this.#renderExpandedMap();
  }

  #clampExpandedMapView() {
    if (!this.cityMap) return;
    const zoom = Math.max(1, Math.min(6, this.expandedMapView.zoom || 1));
    this.expandedMapView.zoom = zoom;
    const canvas = this.hud.expandedMapCanvas;
    const baseScale = this.minimap.getExpandedBaseScale(canvas, this.cityMap);
    const scale = baseScale * zoom;
    const halfVisibleW = canvas && scale > 0 ? (canvas.width * 0.5) / scale : this.cityMap.worldWidth * 0.5;
    const halfVisibleH = canvas && scale > 0 ? (canvas.height * 0.5) / scale : this.cityMap.worldHeight * 0.5;

    if (zoom <= 1.001) {
      this.expandedMapView.zoom = 1;
      this.expandedMapView.centerX = this.cityMap.worldWidth * 0.5;
      this.expandedMapView.centerY = this.cityMap.worldHeight * 0.5;
    } else {
      if (halfVisibleW * 2 >= this.cityMap.worldWidth) {
        this.expandedMapView.centerX = this.cityMap.worldWidth * 0.5;
      } else {
        this.expandedMapView.centerX = Math.max(
          halfVisibleW,
          Math.min(this.cityMap.worldWidth - halfVisibleW, this.expandedMapView.centerX),
        );
      }
      if (halfVisibleH * 2 >= this.cityMap.worldHeight) {
        this.expandedMapView.centerY = this.cityMap.worldHeight * 0.5;
      } else {
        this.expandedMapView.centerY = Math.max(
          halfVisibleH,
          Math.min(this.cityMap.worldHeight - halfVisibleH, this.expandedMapView.centerY),
        );
      }
    }
    this.hud.setExpandedMapZoomLabel(this.expandedMapView.zoom);
  }

  #applyExpandedMapTransform(action) {
    if (!this.hud.isExpandedMapOpen() || !this.cityMap || !action) return;
    const canvas = this.hud.expandedMapCanvas;
    const baseScale = this.minimap.getExpandedBaseScale(canvas, this.cityMap);
    const curZoom = Math.max(1, Math.min(6, this.expandedMapView.zoom || 1));

    if (action.type === 'reset') {
      this.#resetExpandedMapView();
      return;
    }

    if (action.type === 'pan') {
      const scale = baseScale * curZoom;
      if (scale > 0) {
        this.expandedMapView.centerX -= (action.dx || 0) / scale;
        this.expandedMapView.centerY -= (action.dy || 0) / scale;
        this.#clampExpandedMapView();
        this.#renderExpandedMap();
      }
      return;
    }

    if (action.type === 'zoom') {
      const nextZoom = Math.max(1, Math.min(6, curZoom * (action.factor || 1)));
      if (Math.abs(nextZoom - curZoom) < 0.001 && nextZoom === curZoom) return;
      const oldScale = baseScale * curZoom;
      const newScale = baseScale * nextZoom;
      if (canvas && Number.isFinite(action.canvasX) && Number.isFinite(action.canvasY)) {
        const dx = action.canvasX - canvas.width * 0.5;
        const dy = action.canvasY - canvas.height * 0.5;
        const worldX = this.expandedMapView.centerX + dx / oldScale;
        const worldY = this.expandedMapView.centerY + dy / oldScale;
        this.expandedMapView.centerX = worldX - dx / newScale;
        this.expandedMapView.centerY = worldY - dy / newScale;
      } else if (canvas && this.player && nextZoom > curZoom) {
        const px = canvas.width * 0.5 + (this.player.x - this.expandedMapView.centerX) * oldScale;
        const py = canvas.height * 0.5 + (this.player.y - this.expandedMapView.centerY) * oldScale;
        if (px >= 0 && px <= canvas.width && py >= 0 && py <= canvas.height) {
          const dx = px - canvas.width * 0.5;
          const dy = py - canvas.height * 0.5;
          this.expandedMapView.centerX = this.player.x - dx / newScale;
          this.expandedMapView.centerY = this.player.y - dy / newScale;
        }
      }
      this.expandedMapView.zoom = nextZoom;
      this.#clampExpandedMapView();
      this.#renderExpandedMap();
    }
  }

  #renderExpandedMap() {
    this.minimap.renderExpanded(
      this.hud.expandedMapCanvas,
      this.cityMap,
      this.player,
      this.routePoints,
      this.objectivePoint,
      this.worldCollectibles,
      window.innerWidth,
      window.innerHeight,
      this.expandedMapView,
      this.encounterLocationCodes,
    );
  }

  openExpandedMap() {
    if (this.hud.isExpandedMapOpen()) return;
    this.paused = true;
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    const objectiveText = this.freeRoamMode
      ? 'Exploração livre'
      : (activeMission?.objective || '');
    this.hud.openExpandedMap(objectiveText);
    this.#resetExpandedMapView();
    this.hud.animateExpandedMapOpen();
  }

  closeExpandedMap() {
    if (!this.hud.isExpandedMapOpen()) return;
    this.hud.closeExpandedMap();
    this.paused = false;
  }

  #handleResize() {
    this.renderer.resize(window.innerWidth, window.innerHeight);
    if (this.hud.isExpandedMapOpen()) {
      this.#renderExpandedMap();
    }
  }

  start() {
    this.hud.showGameHud();
    this.running = true;
    this.lastTimestamp = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTimestamp) / 1000));
      this.lastTimestamp = now;
      this.pendingContextPrompt = null;
      this.pendingNameplate = null;
      this.pendingPartnerNameplate = null;
      this.update(dt);
      // Só a rota normal do update preenche o balão/nome; pausa, cutscene, morte etc. os escondem
      this.hud.setContextPrompt?.(this.pendingContextPrompt);
      this.hud.setNameplate?.(this.pendingNameplate);
      this.hud.setNameplate?.(this.pendingPartnerNameplate, 'partner-nameplate');
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  update(dt) {
    this.elapsedTime += dt;
    const input = this.input.update(dt);

    if (this.hud.isExpandedMapOpen()) {
      if (input.mapToggleJustPressed || input.secondaryJustPressed || input.pauseJustPressed) {
        this.closeExpandedMap();
        return;
      }
      if (input.resetZoomJustPressed) {
        this.#resetExpandedMapView();
        return;
      }
      let changed = false;
      const zoomDir = (input.zoomInPressed ? 1 : 0) - (input.zoomOutPressed ? 1 : 0);
      if (zoomDir !== 0) {
        this.#applyExpandedMapTransform({ type: 'zoom', factor: Math.exp(zoomDir * 1.8 * dt) });
        changed = true;
      }
      if (Math.abs(input.moveX) > 0.05 || Math.abs(input.moveY) > 0.05) {
        const zoom = Math.max(1, this.expandedMapView.zoom || 1);
        const panWorldSpeed = (this.cityMap.worldWidth * 0.42) / zoom;
        this.expandedMapView.centerX += input.moveX * panWorldSpeed * dt;
        this.expandedMapView.centerY += input.moveY * panWorldSpeed * dt;
        this.#clampExpandedMapView();
        if (!changed) this.#renderExpandedMap();
      }
      return;
    }

    if (input.mapToggleJustPressed && !this.player.isDead && !this.deathSequence && !this.cutscene?.active && !this.inventoryController?.isOpen && !this.hud.isMissionCompleteOpen() && !this.paused) {
      this.openExpandedMap();
      return;
    }

    if (input.pauseJustPressed && !this.player.isDead && !this.deathSequence && !this.cutscene?.active && !this.inventoryController?.isOpen && !this.hud.isMissionCompleteOpen() && !this.pauseMenu?.confirmDialog?.isOpen && !this.pauseMenu?.assetsRefreshDialog?.isOpen) {
      if (this.pauseMenu?.isOpen) this.pauseMenu.close();
      else this.pauseMenu?.open();
      return;
    }

    if (this.inventoryController?.isOpen) {
      this.inventoryController.updateInput(input);
      return;
    }

    if (this.paused) {
      if (this.hud.isMissionCompleteOpen()) {
        if (input.actionJustPressed) {
          this.hud.confirmMissionComplete();
        }
      } else {
        this.pauseMenu?.updateInput(input);
      }
      return;
    }

    if (this.cutscene?.active) {
      this.cutscene.updateInput(input);
      return;
    }

    if (this.shopOpen) return;

    this.#updateCameraZoom(input, dt);

    if (this.player.isDead) {
      this.#updateParticles(dt);
      this.#updateExplosions(dt);
      if (input.actionJustPressed) {
        if (this.storyPackage && !this.freeRoamMode) {
          this.startMission(this.currentMissionIndex, { skipIntro: true });
        } else {
          this.resetMatch();
        }
      }
      return;
    }

    if (this.deathSequence) {
      this.input.setDrivingMode(false);
      this.deathSequence.timer += dt;
      const progress = Math.min(1, this.deathSequence.timer / this.deathSequence.duration);
      const timeScale = Math.max(0.03, Math.pow(1 - progress, 1.8));
      const scaledDt = dt * timeScale;

      this.hud?.setDeathDesaturation?.(progress);
      this.trafficManager.update(scaledDt, this.player, this.vehicles, this.trashBins, this.elapsedTime);

      const noInput = { moveX: 0, moveY: 0, actionPressed: false, secondaryPressed: false };
      for (const v of this.vehicles) {
        if (v.driver === 'npc') continue;
        if (Math.abs(v.x - this.player.x) > 1500) continue;
        updateVehicle(v, noInput, scaledDt, this.cityMap);
      }

      const nearbyVehicles = this.vehicles.filter(
        (v) => Math.abs(v.x - this.player.x) < 1200 && Math.abs(v.y - this.player.y) < 1200
      );
      this.#updateTrashBins(scaledDt, nearbyVehicles);
      this.#updateParticles(scaledDt);
      this.#updateExplosions(scaledDt);

      this.hud.updateStatus({
        locationCode: this.getLocationDisplayName(this.cityMap.getLocationAt(this.player.x, this.player.y)?.code || 'CIDADE'),
        vehicle: null,
        isDrifting: false,
        objectiveCode: this.getLocationDisplayName(this.objectiveCode),
        health: 0
      });

      if (this.deathSequence.timer >= this.deathSequence.duration) {
        this.#finalizeGameOver(this.deathSequence.reason);
      }
      return;
    }

    if (this.pendingGameOver) {
      this.pendingGameOver.timer += dt;
      this.#updateParticles(dt);
      this.#updateExplosions(dt);
      this.hud.updateStatus({
        locationCode: this.getLocationDisplayName(this.cityMap.getLocationAt(this.player.x, this.player.y)?.code || 'CIDADE'),
        vehicle: null,
        isDrifting: false,
        objectiveCode: this.getLocationDisplayName(this.objectiveCode),
        health: 0
      });
      if (this.pendingGameOver.timer >= this.pendingGameOver.duration && this.explosions.length === 0) {
        const reason = this.pendingGameOver.reason;
        this.pendingGameOver = null;
    this.deathSequence = null;
    this.hud?.setDeathDesaturation?.(0);
        this.triggerGameOver(reason);
      }
      return;
    }

    if (this.player.sinking.active) {
      const s = this.player.sinking;
      s.timer += dt;
      const progress = Math.min(1, s.timer / s.duration);
      const damp = Math.exp(-3.2 * dt);
      s.vx *= damp;
      s.vy *= damp;

      if (s.vehicleId) {
        const sv = this.vehicles.find((v) => v.id === s.vehicleId);
        if (sv) {
          sv.x += s.vx * dt;
          sv.y += s.vy * dt;
          sv.sinkProgress = progress;
          sv.sinkScale = 1 - progress * 0.72;
          sv.sinkAlpha = 1 - progress * 0.88;
          this.player.x = sv.x;
          this.player.y = sv.y;
        }
      } else {
        this.player.x += s.vx * dt;
        this.player.y += s.vy * dt;
        this.player.sinkProgress = progress;
        this.player.sinkScale = 1 - progress * 0.72;
        this.player.sinkAlpha = 1 - progress * 0.88;
      }

      this.hud.updateStatus({
        locationCode: 'ÁGUA',
        vehicle: null,
        isDrifting: false,
        objectiveCode: this.getLocationDisplayName(this.objectiveCode),
        health: this.player.health
      });

      if (progress >= 1) {
        this.player.sinking.active = false;
        this.applyDamage(this.player.health || 100, 'Você caiu na água nos limites da ilha!', { bypassResistance: true });
      }
      return;
    }

    let activeVehicle = this.player.inVehicleId
      ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
      : null;

    if (!activeVehicle) {
      if (this.player.ejected.active) {
        const ejRes = updateEjectedPlayer(this.player, dt, this.cityMap, this.vehicles);
        if (this.player.speed > 35) {
          this.bloodMarks.push({
            x: this.player.x,
            y: this.player.y,
            size: 7,
            angle: this.player.angle,
            alpha: 0.72
          });
          if (this.bloodMarks.length > 260) {
            this.bloodMarks.shift();
          }
        }
        if (ejRes.extraDamage > 0) {
          this.bloodMarks.push(
            { x: this.player.x, y: this.player.y, size: 16, angle: this.player.angle, alpha: 0.88 },
            { x: this.player.x + 8, y: this.player.y - 6, size: 8, angle: 0, alpha: 0.78 },
            { x: this.player.x - 7, y: this.player.y + 7, size: 7, angle: 0, alpha: 0.78 }
          );
          this.applyDamage(Math.max(1, Math.round(ejRes.extraDamage * 0.75)), 'Você colidiu fortemente após ser ejetado!');
        }
        if (!this.player.ejected.active && !this.player.isDead && !this.deathSequence) {
          this.player.knockdownTimer = 2.0;
          this.player.speed = 0;
        }
        this.#resolvePlayerMissionNpcCollision();
      } else if (this.player.enteringVehicle) {
        const anim = this.player.enteringVehicle;
        const targetVehicle = this.vehicles.find((v) => v.id === anim.vehicleId);
        if (!targetVehicle || targetVehicle.destroyed) {
          this.player.enteringVehicle = null;
          this.player.entryScale = 1;
          this.player.entryAlpha = 1;
        } else {
          anim.timer += dt;
          const t = Math.min(1, anim.timer / anim.duration);
          const ease = 1 - Math.pow(1 - t, 2);
          this.player.x = anim.fromX + (targetVehicle.x - anim.fromX) * ease;
          this.player.y = anim.fromY + (targetVehicle.y - anim.fromY) * ease;
          this.player.angle = Math.atan2(targetVehicle.y - anim.fromY, targetVehicle.x - anim.fromX);
          this.player.walkPhase += dt * 22;
          this.player.speed = 90;
          if (targetVehicle.kind === 'moto') {
            this.player.entryScale = 1 + Math.sin(t * Math.PI) * 0.22;
            this.player.entryAlpha = 1;
          } else {
            this.player.entryScale = 1 - t * 0.35;
            this.player.entryAlpha = 1 - Math.max(0, (t - 0.55) / 0.45);
          }
          if (t >= 1) {
            this.player.enteringVehicle = null;
            this.player.entryScale = 1;
            this.player.entryAlpha = 1;
            this.player.inVehicleId = targetVehicle.id;
            this.player.x = targetVehicle.x;
            this.player.y = targetVehicle.y;
            this.player.insideLocationCode = null;
            targetVehicle.entryPulseTimer = 0.28;
            this.input.consumeExitTrigger();
            activeVehicle = targetVehicle;
          }
        }
      } else if (this.player.exitingVehicle) {
        const anim = this.player.exitingVehicle;
        anim.timer += dt;
        const t = Math.min(1, anim.timer / anim.duration);
        const ease = 1 - Math.pow(1 - t, 2);
        this.player.x = anim.fromX + (anim.toX - anim.fromX) * ease;
        this.player.y = anim.fromY + (anim.toY - anim.fromY) * ease;
        this.player.angle = Math.atan2(anim.toY - anim.fromY, anim.toX - anim.fromX);
        this.player.walkPhase += dt * 22;
        this.player.speed = 90;
        if (anim.kind === 'moto') {
          this.player.entryScale = 1 + Math.sin(t * Math.PI) * 0.2;
          this.player.entryAlpha = 1;
        } else {
          this.player.entryScale = 0.65 + t * 0.35;
          this.player.entryAlpha = Math.min(1, t / 0.45);
        }
        if (t >= 1) {
          this.player.exitingVehicle = null;
          this.player.entryScale = 1;
          this.player.entryAlpha = 1;
          this.player.x = anim.toX;
          this.player.y = anim.toY;
        }
      } else if ((this.player.knockdownTimer || 0) > 0) {
        this.player.knockdownTimer = Math.max(0, this.player.knockdownTimer - dt);
        this.player.speed = 0;
        this.player.walkPhase = 0;
        this.#resolvePlayerMissionNpcCollision();
      } else {
        updatePedestrian(this.player, input, dt, this.cityMap, this.vehicles);
        this.#resolvePlayerMissionNpcCollision();
        if (this.player.speed > 5) {
          this.player.walkPhase += dt * 14;
        } else {
          this.player.walkPhase = 0;
        }
        // Espaço: conversar/entrar · F: só entrar no veículo
        const wantsAction = input.actionJustPressed || input.exitJustPressed;
        if (wantsAction && !this.#isNearInteriorStoryNpc() && !this.#isNearPendingTargetNpc()) {
          const encounterNpc = input.actionJustPressed ? this.#findNearbyEncounterNpc() : null;
          if (encounterNpc && this.cutscene) {
            this.player.speed = 0;
            this.cutscene.play(encounterNpc.cutscene, this.storyPackage.characters, (result) => {
              if (result?.outcome === 'gameover') {
                this.triggerGameOver(result.reason || 'Fim de linha!');
              }
            });
            return;
          }
          if (this.#nearShop('gun', 50)) {
            this.#openGunShop();
            return;
          }
          const nearest = findNearestVehicle(this.player.x, this.player.y, this.vehicles);
          if (nearest) {
            const hadNpcDriver = nearest.driver === 'npc';
            if (hadNpcDriver) {
              this.trafficManager.evictDriver(nearest, this.player.radius);
              this.policeCrime('carjack');
            }
            nearest.driver = 'player';
            nearest.isParked = false;
            nearest.vx *= 0.25;
            nearest.vy *= 0.25;
            nearest.speed *= 0.25;
            this.player.insideLocationCode = null;
            this.player.enteringVehicle = {
              vehicleId: nearest.id,
              fromX: this.player.x,
              fromY: this.player.y,
              timer: 0,
              duration: hadNpcDriver ? 0.34 : 0.24,
              hadNpcDriver,
            };
          } else if (input.actionJustPressed) {
            const ped = this.#findNearestTalkablePedestrian(this.player.x, this.player.y);
            if (ped) {
              ped.angle = Math.atan2(this.player.y - ped.y, this.player.x - ped.x);
              const pool = this.storyPackage?.npcLines?.length ? this.storyPackage.npcLines : PEDESTRIAN_CHAT_LINES;
              const line = pool[Math.floor(Math.random() * pool.length)];
              const initPos = this.#worldToScreen(ped.x, ped.y, 22);
              this.hud.showNpcSpeechBubble(ped, line, initPos);
            }
          }
        }
      }
    } else {
      const shouldExit =
        input.exitJustPressed ||
        input.comboExitJustPressed ||
        (input.canTriggerHoldExit && activeVehicle.speed < 25);

      if (shouldExit) {
        const exitPos = findSafeExitPosition(activeVehicle, this.player.radius, this.cityMap);
        const startX = activeVehicle.x;
        const startY = activeVehicle.y;
        const kind = activeVehicle.kind;
        activeVehicle.driver = null;
        activeVehicle.entryPulseTimer = 0.24;
        this.player.inVehicleId = null;
        this.player.x = startX;
        this.player.y = startY;
        this.player.exitingVehicle = {
          fromX: startX,
          fromY: startY,
          toX: exitPos.x,
          toY: exitPos.y,
          timer: 0,
          duration: 0.24,
          kind,
        };
        this.input.consumeExitTrigger();
        activeVehicle = null;
      }
    }

    this.input.setDrivingMode(Boolean(activeVehicle));

    this.#syncActiveChunks(this.player.x, this.player.y);
    this.trafficManager.update(dt, this.player, this.vehicles, this.trashBins, this.elapsedTime);
    this.boatManager?.update(dt);

    let maxPlayerImpact = 0;
    let playerHitBuilding = false;
    let impactMoveVx = activeVehicle ? activeVehicle.vx : 0;
    let impactMoveVy = activeVehicle ? activeVehicle.vy : 0;
    for (const v of this.vehicles) {
      if (v.driver === 'npc') continue;
      if (v.driver !== 'player' && Math.abs(v.x - this.player.x) > 1500) continue;
      const preVx = v.vx;
      const preVy = v.vy;
      const res = updateVehicle(v, input, dt, this.cityMap);
      if (v.driver === 'player' && res.impactSpeed > maxPlayerImpact) {
        maxPlayerImpact = res.impactSpeed;
        playerHitBuilding = Boolean(res.collided);
        impactMoveVx = preVx;
        impactMoveVy = preVy;
      }
      if (res.collided && res.impactSpeed > 75) {
        const dmgRes = applyVehicleDamage(v, res.impactSpeed);
        if (dmgRes.exploded) {
          this.#triggerVehicleExplosion(v);
        }
      }
      if (v.isDrifting && v.driftIntensity > 0.25) {
        this.#emitVehicleTireMarks(v, this.skidMarks, {
          alpha: Math.min(0.48, v.driftIntensity * 0.42),
          maxCount: 600,
          length: 9,
          includeSurface: true,
        });
      }
    }

    // Colisão veículo-veículo na área próxima ao jogador
    const nearbyVehicles = this.vehicles.filter(
      (v) => Math.abs(v.x - this.player.x) < 1200 && Math.abs(v.y - this.player.y) < 1200
    );
    for (let i = 0; i < nearbyVehicles.length; i++) {
      for (let j = i + 1; j < nearbyVehicles.length; j++) {
        const vA = nearbyVehicles[i];
        const vB = nearbyVehicles[j];
        const pairRes = resolveVehiclePairCollision(vA, vB);
        if (pairRes.collided && pairRes.impactSpeed > 75) {
          if (applyVehicleDamage(vA, pairRes.impactSpeed).exploded) {
            this.#triggerVehicleExplosion(vA);
          }
          if (applyVehicleDamage(vB, pairRes.impactSpeed).exploded) {
            this.#triggerVehicleExplosion(vB);
          }
        }
        if (pairRes.collided && (vA.driver === 'player' || vB.driver === 'player')) {
          if (pairRes.impactSpeed > maxPlayerImpact) {
            maxPlayerImpact = pairRes.impactSpeed;
          }
        }
      }
    }

    // Contagem regressiva de 10s para veículos com até 30% de integridade
    for (const v of this.vehicles) {
      if (v.entryPulseTimer > 0) {
        v.entryPulseTimer = Math.max(0, v.entryPulseTimer - dt);
      }
      if (v.destroyed) continue;
      const crit = updateVehicleCriticalState(v, dt);
      if (crit.shouldExplode) {
        this.#triggerVehicleExplosion(v);
      }
    }

    // Fumaça em veículos com <= 50% de integridade (cinza) e <= 30% (preta + faíscas de fogo)
    for (const v of nearbyVehicles) {
      if (!v.destroyed && (v.health ?? 100) <= 50) {
        const isCritical = (v.health ?? 100) <= 30;
        v.smokeTimer = (v.smokeTimer || 0) - dt;
        const interval = isCritical ? 0.026 : 0.07;
        if (v.smokeTimer <= 0) {
          v.smokeTimer = interval;
          const hoodX = v.x + Math.cos(v.angle) * (v.length * 0.28);
          const hoodY = v.y + Math.sin(v.angle) * (v.length * 0.28);
          this.smokeParticles.push({
            x: hoodX + (Math.random() - 0.5) * 6,
            y: hoodY + (Math.random() - 0.5) * 6,
            vx: -v.vx * 0.08 + (Math.random() - 0.5) * (isCritical ? 22 : 14),
            vy: -v.vy * 0.08 - (isCritical ? 12 : 6) + (Math.random() - 0.5) * 14,
            size: (isCritical ? 14 : 11) + Math.random() * 8,
            alpha: isCritical ? 0.88 : 0.52,
            dark: isCritical ? 0.05 : 0.58,
            life: 0,
            maxLife: isCritical ? 1.9 : 1.6
          });
          if (isCritical && Math.random() < 0.45) {
            const flamePalette = [
              [1, 0.9, 0.22],
              [1, 0.48, 0.06],
              [0.95, 0.16, 0.04]
            ];
            this.smokeParticles.push({
              x: hoodX + (Math.random() - 0.5) * 8,
              y: hoodY + (Math.random() - 0.5) * 8,
              vx: -v.vx * 0.05 + (Math.random() - 0.5) * 26,
              vy: -18 + (Math.random() - 0.5) * 18,
              size: 7 + Math.random() * 5,
              alpha: 0.95,
              color: flamePalette[Math.floor(Math.random() * flamePalette.length)],
              life: 0,
              maxLife: 0.35 + Math.random() * 0.2
            });
          }
          while (this.smokeParticles.length > 320) {
            this.smokeParticles.shift();
          }
        }
      } else if (v.destroyed && v.burning) {
        v.burnSmokeTimer = (v.burnSmokeTimer || 0) - dt;
        if (v.burnSmokeTimer <= 0) {
          v.burnSmokeTimer = 0.055;
          this.smokeParticles.push({
            x: v.x + (Math.random() - 0.5) * 18,
            y: v.y + (Math.random() - 0.5) * 18,
            vx: (Math.random() - 0.5) * 16,
            vy: -16 + (Math.random() - 0.5) * 12,
            size: 16 + Math.random() * 10,
            alpha: 0.86,
            dark: 0.05,
            life: 0,
            maxLife: 1.8
          });
          const flamePalette = [
            [1, 0.9, 0.2],
            [1, 0.46, 0.05],
            [0.96, 0.14, 0.04]
          ];
          this.smokeParticles.push({
            x: v.x + (Math.random() - 0.5) * 20,
            y: v.y + (Math.random() - 0.5) * 14,
            vx: (Math.random() - 0.5) * 18,
            vy: -20 - Math.random() * 14,
            size: 10 + Math.random() * 7,
            alpha: 0.95,
            color: flamePalette[Math.floor(Math.random() * flamePalette.length)],
            life: 0,
            maxLife: 0.4 + Math.random() * 0.25
          });
          while (this.smokeParticles.length > 320) {
            this.smokeParticles.shift();
          }
        }
      }
    }

    // Dano por contato com veículos em chamas na rua
    if (this.player.burnCooldown > 0) {
      this.player.burnCooldown = Math.max(0, this.player.burnCooldown - dt);
    }
    for (const v of nearbyVehicles) {
      if (v.burnCooldown > 0) {
        v.burnCooldown = Math.max(0, v.burnCooldown - dt);
      }
      if (!v.destroyed || !v.burning) continue;

      if (!this.player.inVehicleId && !this.player.isDead && !this.pendingGameOver && this.player.burnCooldown <= 0) {
        if (isTouchingVehicle(this.player.x, this.player.y, this.player.radius, v, 7)) {
          this.player.burnCooldown = 0.45;
          this.applyDamage(14, 'Você se queimou em um veículo em chamas!');
        }
      }

      if (this.trafficManager?.pedestrians) {
        for (const ped of this.trafficManager.pedestrians) {
          if (ped.state !== 'downed' && isTouchingVehicle(ped.x, ped.y, ped.radius || 9, v, 5)) {
            ped.state = 'downed';
            ped.runOver = true;
          }
        }
      }

      for (const other of nearbyVehicles) {
        if (other.id === v.id || other.destroyed || (other.burnCooldown || 0) > 0) continue;
        if (isTouchingVehicle(other.x, other.y, other.radius, v, 4)) {
          other.burnCooldown = 0.5;
          other.health = Math.max(0, (other.health ?? 100) - 8);
          if (other.health <= 0) {
            this.#triggerVehicleExplosion(other);
          }
        }
      }
    }

    this.#updateParticles(dt);
    this.#updateExplosions(dt);
    this.#updateTrashBins(dt, nearbyVehicles);

    if ((this.player.vehicleHitCooldown || 0) > 0) {
      this.player.vehicleHitCooldown = Math.max(0, this.player.vehicleHitCooldown - dt);
    }

    // Impacto de veículos no jogador a pé
    if (!activeVehicle && !this.player.isDead && !this.player.sinking.active && (this.player.vehicleHitCooldown || 0) <= 0) {
      for (const v of nearbyVehicles) {
        if (v.speed <= 25 || v.destroyed) continue;
        if (Math.abs(this.player.x - v.x) > 52 || Math.abs(this.player.y - v.y) > 52) continue;
        if (!isTouchingVehicle(this.player.x, this.player.y, this.player.radius || 12, v, 2)) continue;
        const movingTowardPlayer = (this.player.x - v.x) * v.vx + (this.player.y - v.y) * v.vy > 0;
        if (!movingTowardPlayer) continue;

        const dmg = Math.min(75, Math.max(5, Math.round((v.speed - 20) * 0.35)));
        const mag = Math.hypot(v.vx, v.vy) || 1;
        const knockDist = Math.min(22, Math.max(6, v.speed * 0.14));
        const kx = (v.vx / mag) * knockDist;
        const ky = (v.vy / mag) * knockDist;
        const playerRadius = this.player.radius || 12;
        const colliders = this.cityMap.getCollidersAround(this.player.x + kx, this.player.y + ky, 48);
        const resolved = resolveEntityCollisions(this.player.x + kx, this.player.y + ky, playerRadius, colliders);
        this.player.x = resolved.x;
        this.player.y = resolved.y;
        this.player.vehicleHitCooldown = 0.65;
        this.bloodMarks.push({
          x: this.player.x,
          y: this.player.y,
          size: 8 + Math.random() * 5,
          angle: Math.random() * Math.PI * 2,
          alpha: 0.72,
        });
        this.applyDamage(dmg, 'Você foi atropelado por um veículo!');
        if (!this.player.isDead && !this.deathSequence) {
          this.player.knockdownTimer = 2.0;
          this.player.speed = 0;
        }
        break;
      }
    }

    // Impacto de veículos em pessoas andando ou fugindo na rua
    const standingPeds = this.trafficManager.pedestrians.filter((p) => p.state !== 'downed');
    for (const v of nearbyVehicles) {
      if (v.speed <= 18) continue;
      for (const ped of standingPeds) {
        if (ped.state === 'downed' || (ped.hitCooldown || 0) > 0) continue;
        if (Math.abs(ped.x - v.x) > 48 || Math.abs(ped.y - v.y) > 48) continue;
        if (isTouchingVehicle(ped.x, ped.y, ped.radius || 10, v, 2)) {
          const dmg = Math.min(100, Math.max(18, Math.round(v.speed * 0.45)));
          const hit = applyPedestrianDamage(ped, dmg, v.vx, v.vy);
          if (hit.downed && v.driver === 'player') this.policeCrime('ped');
          if (hit.damaged) {
            this.bloodMarks.push({
              x: ped.x,
              y: ped.y,
              size: hit.downed ? 16 : 10,
              angle: v.angle,
              alpha: hit.downed ? 0.85 : 0.65
            });
            v.bloodTireTimer = 1.6;
          }
        }
      }
    }

    // Atropelamento de pessoas caídas no chão: desloca o corpo e deixa trilha de sangue
    const downedPeds = this.trafficManager.pedestrians.filter((p) => p.state === 'downed');
    for (const v of nearbyVehicles) {
      if (v.speed > 12) {
        const hitRadius = Math.max(v.width, v.height) * 0.45;
        for (const ped of downedPeds) {
          if (Math.hypot(v.x - ped.x, v.y - ped.y) < hitRadius) {
            const vLen = Math.hypot(v.vx, v.vy) || 1;
            const pushSpeed = Math.max(140, v.speed * 1.15);
            ped.vx = (v.vx / vLen) * pushSpeed;
            ped.vy = (v.vy / vLen) * pushSpeed;
            if (!ped.runOver) {
              ped.runOver = true;
              this.bloodMarks.push({
                x: ped.x,
                y: ped.y,
                size: 16,
                angle: v.angle,
                alpha: 0.85
              });
            }
            v.bloodTireTimer = 1.8;
          }
        }
      }
      if (v.bloodTireTimer > 0) {
        v.bloodTireTimer = Math.max(0, v.bloodTireTimer - dt);
        if (v.speed > 12) {
          this.#emitVehicleTireMarks(v, this.bloodMarks, {
            alpha: Math.min(0.75, v.bloodTireTimer * 0.45),
            maxCount: 420,
            length: 7,
            includeSurface: false,
          });
        }
      }
    }

    for (const ped of downedPeds) {
      const pSpeed = Math.hypot(ped.vx || 0, ped.vy || 0);
      if (pSpeed > 10) {
        const nextX = ped.x + ped.vx * dt;
        const nextY = ped.y + ped.vy * dt;
        const colliders = this.cityMap.getCollidersAround(nextX, nextY, 80);
        const res = resolveEntityCollisions(nextX, nextY, 10, colliders);
        ped.x = res.x;
        ped.y = res.y;
        const damp = Math.exp(-4.8 * dt);
        ped.vx = res.collided ? -ped.vx * 0.3 : ped.vx * damp;
        ped.vy = res.collided ? -ped.vy * 0.3 : ped.vy * damp;
        this.bloodMarks.push({
          x: ped.x,
          y: ped.y,
          size: 8,
          angle: Math.atan2(ped.vy, ped.vx),
          alpha: 0.72
        });
        while (this.bloodMarks.length > 260) {
          this.bloodMarks.shift();
        }
      }
    }

    if (activeVehicle) {
      this.player.x = activeVehicle.x;
      this.player.y = activeVehicle.y;
      this.player.angle = activeVehicle.angle;

      const impact = evaluateVehicleImpact(maxPlayerImpact);
      if (impact.eject) {
        const moveLen = Math.hypot(impactMoveVx, impactMoveVy);
        let dirX = moveLen > 1 ? impactMoveVx / moveLen : Math.cos(activeVehicle.angle);
        let dirY = moveLen > 1 ? impactMoveVy / moveLen : Math.sin(activeVehicle.angle);
        if (playerHitBuilding) {
          dirX = -dirX;
          dirY = -dirY;
        }
        const ejectSpeed = Math.min(460, Math.max(240, maxPlayerImpact * 0.95));

        activeVehicle.driver = null;
        this.player.inVehicleId = null;
        const spawnX = activeVehicle.x + dirX * (activeVehicle.radius + this.player.radius + 4);
        const spawnY = activeVehicle.y + dirY * (activeVehicle.radius + this.player.radius + 4);
        const safeColliders = this.cityMap.getCollidersAround(spawnX, spawnY, 80);
        const safePos = resolveEntityCollisions(spawnX, spawnY, this.player.radius, safeColliders);
        this.player.x = safePos.x;
        this.player.y = safePos.y;
        this.player.angle = Math.atan2(dirY, dirX);
        this.player.ejected = {
          active: true,
          vx: dirX * ejectSpeed,
          vy: dirY * ejectSpeed,
          hitCooldown: 0.15,
          graceTimer: 0.25,
          sourceVehicleId: activeVehicle.id
        };
        this.input.consumeExitTrigger();
        this.applyDamage(Math.max(1, Math.round(impact.damage * 0.7)), 'Você sofreu uma colisão fatal!');
      }
    }

    if (isInWater(this.player.x, this.player.y, this.cityMap) && !this.player.sinking.active && !this.player.isDead) {
      const sv = this.player.inVehicleId
        ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
        : null;
      this.hud.triggerDamageFlash();
      this.player.sinking = {
        active: true,
        timer: 0,
        duration: 1.35,
        vehicleId: sv ? sv.id : null,
        vx: sv ? sv.vx * 0.45 : Math.cos(this.player.angle) * 90,
        vy: sv ? sv.vy * 0.45 : Math.sin(this.player.angle) * 90
      };
    }

    const loc = this.cityMap.getLocationAt(this.player.x, this.player.y);
    this.player.currentLocationCode = loc ? loc.code : 'CIDADE';
    this.player.insideLocationCode =
      !this.player.inVehicleId && loc && (loc.type === 'house' || loc.type === 'commerce' || loc.type === 'hospital')
        ? loc.code
        : null;

    const isInsideHospital = Boolean(!this.player.inVehicleId && loc && loc.type === 'hospital');
    if (isInsideHospital && !this.wasInsideHospital && this.player.health < 100) {
      this.player.health = 100;
      this.hud.triggerHealFlash();
      this.hud.showToast('Vida recuperada no hospital!');
    }
    this.wasInsideHospital = isInsideHospital;

    if (this.collectibleFullToastCooldown > 0) {
      this.collectibleFullToastCooldown = Math.max(0, this.collectibleFullToastCooldown - dt);
    }
    for (const c of this.worldCollectibles) {
      if (c.collected || this.inventory.hasItem(c.id)) {
        c.collected = true;
        this.collectedExtraIds.add(c.id);
        continue;
      }
      if (c.kind === 'interior' && this.player.insideLocationCode !== c.locationCode) continue;
      if (Math.hypot(this.player.x - c.x, this.player.y - c.y) <= 44) {
        if (this.inventory.isFull()) {
          if (this.collectibleFullToastCooldown <= 0) {
            this.hud.showToast(`Inventário cheio! Libere espaço para pegar ${c.name}.`);
            this.collectibleFullToastCooldown = 3.0;
          }
          continue;
        }
        c.collected = true;
        this.collectedExtraIds.add(c.id);
        this.#grantMissionItem(c.id, { category: 'extra', rarity: c.rarity || 'normal' });
        this.#earn(collectibleReward(c.rarity || 'normal'), 'Item encontrado');
        const screenPos = this.#worldToScreen(c.x, c.y);
        this.hud.animatePickupToInventory(screenPos.x, screenPos.y, c.imageUrl, c.name);
        this.hud.showToast(`${c.name} — ${c.description}`, {
          imageUrl: c.imageUrl,
          imageAlt: c.name
        });
      }
    }

    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    const reachedPickup =
      !this.itemPickedUp &&
      activeMission?.pickupLocation &&
      this.objectivePoint &&
      (Math.hypot(this.player.x - this.objectivePoint.x, this.player.y - this.objectivePoint.y) < 76 ||
        this.player.insideLocationCode === activeMission.pickupLocation);

    if (reachedPickup) {
      this.itemPickedUp = true;
      const itemDef = this.storyPackage?.items?.get(activeMission.giveItem);
      const itemName = itemDef?.name || 'Item';
      if (this.objectivePoint && itemDef?.imageUrl) {
        const screenPos = this.#worldToScreen(this.objectivePoint.x, this.objectivePoint.y);
        this.hud.updateWorldPickupItem(false);
        this.hud.animatePickupToInventory(screenPos.x, screenPos.y, itemDef.imageUrl, itemName);
      }
      if (activeMission.giveItem && !this.inventory.hasItem(activeMission.giveItem)) {
        this.#grantMissionItem(activeMission.giveItem);
      }
      const targetName = this.locationNames.get(activeMission.targetLocation) || activeMission.targetLocation;
      this.hud.showToast(`${itemName} guardada no inventário! Leve até ${targetName}.`, {
        imageUrl: itemDef?.imageUrl || '',
        imageAlt: itemName
      });
      this.setObjective(activeMission.targetLocation);
      this.#persistSaveState();
    } else if (this.#isPickupStageActive()) {
      if (this.#isNearPendingTargetNpc() && input.actionJustPressed) {
        const itemDef = this.storyPackage?.items?.get(activeMission.giveItem);
        const itemName = itemDef?.name || activeMission.giveItem || 'o item';
        const pickupName = this.locationNames.get(activeMission.pickupLocation) || activeMission.pickupLocation;
        const hintMsg = activeMission.pickupObjective || `Você ainda não pegou ${itemName}! Vá até ${pickupName} primeiro.`;
        this.hud.showToast(hintMsg, {
          imageUrl: itemDef?.imageUrl || '',
          imageAlt: itemName
        });
      }
    } else {
      const requiresBuildingEntry =
        this.objectiveLocationType === 'commerce' || this.objectiveLocationType === 'house';
      const reachedTarget =
        this.objectivePoint &&
        (requiresBuildingEntry
          ? this.#isNearInteriorStoryNpc() && input.actionJustPressed
          : Math.hypot(this.player.x - this.objectivePoint.x, this.player.y - this.objectivePoint.y) < 76 ||
            Boolean(activeMission && this.player.insideLocationCode === activeMission.targetLocation));

      if (this.awaitingExitTarget) {
        if (!reachedTarget || (requiresBuildingEntry && input.actionJustPressed)) {
          this.awaitingExitTarget = false;
        }
      }
      if (!this.awaitingExitTarget && this.objectivePoint && !this.missionOutTriggered && reachedTarget) {
        if (this.storyPackage && !this.freeRoamMode) {
          this.missionOutTriggered = true;
          this.#handleMissionArrival();
        } else {
          this.setObjective(null);
        }
      }
    }

    this.routeTimer += dt;
    if (this.objectiveCode && this.routeTimer >= 0.25) {
      this.routeTimer = 0;
      this.routePoints = this.pathfinder.findRoute(this.player.x, this.player.y, this.objectiveCode);
    }

    const nearbyBlocks = this.cityMap.getVisibleBlocks(
      this.player.x - 400,
      this.player.y - 400,
      this.player.x + 400,
      this.player.y + 400
    );
    for (const block of nearbyBlocks) {
      for (const b of block.buildings) {
        const ex = b.entrance.x + b.entrance.w * 0.5;
        const ey = b.entrance.y + b.entrance.h * 0.5;
        const nearDoor = !this.player.inVehicleId && Math.hypot(this.player.x - ex, this.player.y - ey) < 42;
        const targetOpen = nearDoor ? 1 : 0;
        b.doorOpen = (b.doorOpen || 0) + (targetOpen - (b.doorOpen || 0)) * Math.min(1, dt * 12);
        const targetRoofAlpha = !this.player.inVehicleId && this.player.insideLocationCode === b.code ? 0 : 1;
        const currRoofAlpha = b.roofAlpha ?? 1;
        const nextRoofAlpha = currRoofAlpha + (targetRoofAlpha - currRoofAlpha) * Math.min(1, dt * 10);
        b.roofAlpha = nextRoofAlpha < 0.01 ? 0 : nextRoofAlpha > 0.99 ? 1 : nextRoofAlpha;
      }
    }

    this.camera.x += (this.player.x - this.camera.x) * Math.min(1, dt * 10);
    this.camera.y += (this.player.y - this.camera.y) * Math.min(1, dt * 10);

    const currentVehicle = this.player.inVehicleId
      ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
      : null;

    const nearbyEncounterNpc = this.#findNearbyEncounterNpc();
    const objectiveHint = (this.#isNearInteriorStoryNpc() || this.#isNearPendingTargetNpc())
      ? 'Aperte Ação para falar'
      : nearbyEncounterNpc
        ? (nearbyEncounterNpc.prompt || 'Aperte Ação para falar')
        : this.getLocationDisplayName(this.objectiveCode);

    if (this.hudDisplayHealth < this.player.health) {
      this.hudDisplayHealth = Math.min(this.player.health, this.hudDisplayHealth + dt * 90);
    } else {
      this.hudDisplayHealth = this.player.health;
    }

    this.hud.updateStatus({
      locationCode: this.getLocationDisplayName(this.player.currentLocationCode),
      vehicle: currentVehicle,
      isDrifting: Boolean(currentVehicle?.isDrifting),
      objectiveCode: objectiveHint,
      health: this.hudDisplayHealth
    });

    this.#updatePartnerFollow(dt, currentVehicle);
    this.#updateWeapons(dt, currentVehicle);
    this.#updateEconomy(dt, currentVehicle);
    this.#updatePolice(dt, currentVehicle);
    {
      const ars = this.weapons.arsenal;
      const w = WEAPONS[ars.current];
      this.hud.setWeaponStatus?.({
        id: w.id,
        name: w.name,
        melee: Boolean(w.melee),
        mag: ars.mag[w.id] || 0,
        reserve: ars.reserve[w.id] || 0,
        reloading: ars.reloadTimer > 0,
        armedCount: ars.owned.size - 1,
        inVehicle: Boolean(currentVehicle),
      });
    }
    this.#updateVehicleGuidance(currentVehicle);
    this.#updateNameplate(currentVehicle);
    this.#updatePartnerNameplate();
  }

  // Cartão da protagonista no HUD (retrato + nome) e nome flutuando sobre ela.
  #initProtagonistHud() {
    const chars = this.storyPackage?.characters;
    if (!(chars instanceof Map) || chars.size === 0) return;
    const protId = this.storyPackage?.protagonist;
    const prot = (protId && chars.get(protId)) || chars.values().next().value;
    if (!prot) return;
    this.protagonistName = prot.name || '';
    this.hud.setProtagonist?.({
      name: prot.name,
      portrait: prot.sprites?.cutscene || '',
      fallback: prot.sprites?.front || '',
    });
  }

  // ---- Armas (estilo GTA) ----
  #initWeapons(canvas) {
    const arsenal = createArsenal();
    this.weapons = {
      arsenal,
      giveAll: () => giveAllWeapons(arsenal),
    };
    this.bullets = [];
    this.weaponFx = [];
    this.mouseScreen = null;
    this.mouseMovedAt = -Infinity;
    this.mouseFiring = false;
    this.fireKeyHeld = false;
    this.prevFireHeld = false;
    this.shootLineCooldown = 0;

    const isUiTarget = (t) => Boolean(t?.closest?.('button, a, input, select, textarea, [role="button"], #minimap-container, .hud-pill, #touch-controls'));
    window.addEventListener('mousemove', (e) => {
      this.mouseScreen = { x: e.clientX, y: e.clientY };
      this.mouseMovedAt = performance.now();
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || isUiTarget(e.target)) return;
      this.mouseScreen = { x: e.clientX, y: e.clientY };
      this.mouseMovedAt = performance.now();
      this.mouseFiring = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFiring = false;
    });
    // K atira no teclado (Ctrl não: Ctrl+W fecharia a aba do navegador)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyK') this.fireKeyHeld = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyK') this.fireKeyHeld = false;
    });
    window.addEventListener('blur', () => {
      this.mouseFiring = false;
      this.fireKeyHeld = false;
    });
    this.canvasEl = canvas;
  }

  #screenToWorld(sx, sy) {
    if (this.#is3dActive()) {
      const hit = this.renderer3d.screenToWorld(sx, sy);
      if (hit) return hit;
    }
    const zoom = this.renderer?.zoom || 1;
    const viewW = this.renderer?.viewWidth || window.innerWidth;
    const viewH = this.renderer?.viewHeight || window.innerHeight;
    return { x: (sx - viewW * 0.5) / zoom + this.camera.x, y: (sy - viewH * 0.5) / zoom + this.camera.y };
  }

  #updateWeapons(dt, currentVehicle) {
    const arsenal = this.weapons.arsenal;
    tickArsenal(arsenal, dt);
    this.shootLineCooldown = Math.max(0, this.shootLineCooldown - dt);
    const weapon = WEAPONS[arsenal.current];
    const armed = weapon && !weapon.melee;
    if (this.canvasEl) this.canvasEl.style.cursor = armed && !currentVehicle ? 'crosshair' : '';

    const canAct = !currentVehicle && !this.player.enteringVehicle && !this.player.exitingVehicle
      && !this.player.ejected?.active && !((this.player.knockdownTimer || 0) > 0) && !this.player.isDead;

    // Mira: com mouse (desktop) vira para o cursor; sem mouse, atira para onde olha
    const mouseAiming = this.mouseScreen && performance.now() - this.mouseMovedAt < 5000;
    let aimAngle = this.player.angle;
    if (canAct && mouseAiming) {
      const w = this.#screenToWorld(this.mouseScreen.x, this.mouseScreen.y);
      aimAngle = Math.atan2(w.y - this.player.y, w.x - this.player.x);
      if (armed) this.player.angle = aimAngle;
    }
    this.player.weaponId = canAct ? arsenal.current : null;

    const held = this.mouseFiring || this.fireKeyHeld;
    const justPressed = held && !this.prevFireHeld;
    this.prevFireHeld = held;

    if (canAct && held && (justPressed || weapon?.auto)) {
      const cos = Math.cos(aimAngle);
      const sin = Math.sin(aimAngle);
      const origin = { x: this.player.x + cos * 18 - sin * 6, y: this.player.y + sin * 18 + cos * 6 };
      const res = tryFire(arsenal, origin, aimAngle);
      if (res?.kind === 'shot') {
        this.bullets.push(...res.bullets);
        this.weaponFx.push({ kind: 'muzzle', x: origin.x, y: origin.y, angle: aimAngle, life: 0, maxLife: 0.06 });
        this.#panicPedestrians(this.player.x, this.player.y, 430);
        this.policeCrime('shot');
        if (this.shootLineCooldown <= 0) {
          this.partnerSay('shoot');
          this.shootLineCooldown = 12;
        }
      } else if (res?.kind === 'melee') {
        this.#doMelee(aimAngle, weapon);
      } else if (res?.kind === 'empty' && justPressed) {
        this.hud.showToast('Sem munição! Digite BANGBANG ou troque de arma (1–4).', 2600);
      }
    }

    if (this.bullets.length > 0) {
      const peds = this.trafficManager?.pedestrians || [];
      const impacts = stepBullets(this.bullets, dt, {
        hitsWall: (x, y) => this.cityMap.getCollidersAround(x, y, 4).some((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h),
        hitVehicle: (x, y) => this.vehicles.find((v) => !v.destroyed && v.id !== this.player.inVehicleId
          && Math.abs(v.x - x) < 40 && Math.abs(v.y - y) < 40 && isTouchingVehicle(x, y, 1.5, v, 0)) || null,
        hitPedestrian: (x, y) => peds.find((p) => p.state !== 'downed' && Math.abs(p.x - x) < 14 && Math.abs(p.y - y) < 14
          && Math.hypot(p.x - x, p.y - y) < (p.radius || 9)) || null,
      });
      for (const imp of impacts) {
        this.weaponFx.push({ kind: imp.type === 'ped' ? 'hit' : 'spark', x: imp.x, y: imp.y, angle: 0, life: 0, maxLife: 0.25 });
        if (imp.type === 'vehicle') {
          const v = imp.target;
          v.health = Math.max(0, (v.health ?? 100) - imp.damage * 0.55);
          if (v.police) this.policeCrime('hit-police');
          if (v.health <= 0) {
            this.#triggerVehicleExplosion(v);
            if (!v.police) this.policeCrime('vehicle');
          }
        } else if (imp.type === 'ped') {
          const ang = Math.atan2(imp.y - this.player.y, imp.x - this.player.x);
          const r = applyPedestrianDamage(imp.target, imp.damage * 1.6, Math.cos(ang) * 120, Math.sin(ang) * 120);
          if (r.downed) this.policeCrime('ped');
        }
      }
    }

    for (let i = this.weaponFx.length - 1; i >= 0; i--) {
      const fx = this.weaponFx[i];
      fx.life += dt;
      if (fx.life >= fx.maxLife) this.weaponFx.splice(i, 1);
    }
  }

  #doMelee(angle, weapon) {
    const fx = this.player.x + Math.cos(angle) * 16;
    const fy = this.player.y + Math.sin(angle) * 16;
    for (const ped of this.trafficManager?.pedestrians || []) {
      if (ped.state === 'downed' || Math.hypot(ped.x - fx, ped.y - fy) > weapon.range) continue;
      const r = applyPedestrianDamage(ped, weapon.damage, Math.cos(angle) * 160, Math.sin(angle) * 160);
      if (r.downed) this.policeCrime('ped');
      this.weaponFx.push({ kind: 'hit', x: ped.x, y: ped.y, angle, life: 0, maxLife: 0.2 });
      break;
    }
  }

  #panicPedestrians(x, y, radius) {
    for (const ped of this.trafficManager?.pedestrians || []) {
      if (ped.state === 'downed' || ped.state === 'fleeing') continue;
      if (Math.abs(ped.x - x) > radius || Math.abs(ped.y - y) > radius) continue;
      const dx = ped.x - x;
      const dy = ped.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > radius) continue;
      ped.state = 'fleeing';
      ped.fleeTimer = 4;
      ped.substate = null;
      ped.crossTarget = null;
      ped.waitingCrosswalk = null;
      ped.targetBuilding = null;
      ped.plazaTarget = null;
      ped.returnTarget = null;
      ped.dirX = dx / d;
      ped.dirY = dy / d;
      ped.angle = Math.atan2(ped.dirY, ped.dirX);
    }
  }

  // ---- Polícia e nível de procurado ----
  /** Troca o nível de dificuldade (Fácil / Normal / Difícil). */
  setDifficulty(id) {
    this.difficulty = getDifficulty(id);
    saveDifficultyId(this.difficulty.id);
    return this.difficulty;
  }

  #initPolice() {
    this.difficulty = getDifficulty(loadDifficultyId());
    if (!this.onDifficultyEvent) {
      this.onDifficultyEvent = (ev) => {
        const d = this.setDifficulty(ev.detail?.id);
        this.hud.showToast?.(`Dificuldade: ${d.label}`, 2000);
      };
      window.addEventListener('gta-difficulty', this.onDifficultyEvent);
    }
    this.wanted = createWanted();
    this.policeCars = [];
    this.policeBullets = [];
    this.policeSpawnTimer = 0;
    this.bustTimer = 0;
    this.lastStars = 0;
  }

  /** Registra um crime da protagonista. */
  policeCrime(type) {
    if (!this.wanted) return;
    const mult = this.difficulty?.crimeMult ?? 1;
    const gained = reportCrime(this.wanted, type, (CRIMES[type] ?? 0) * mult);
    if (gained > 0) {
      this.hud.flashWanted?.();
      this.partnerSay('police');
    }
  }

  #spawnPoliceCar(target) {
    const pf = this.pathfinder;
    if (!pf) return null;
    const viewW = (this.renderer.viewWidth || 800) / this.renderer.zoom;
    const viewH = (this.renderer.viewHeight || 600) / this.renderer.zoom;
    const minDist = Math.max(560, Math.hypot(viewW, viewH) * 0.55);
    const here = pf.nearestNode(target.x, target.y);
    const options = [];
    for (let dx = -5; dx <= 5; dx++) {
      for (let dy = -5; dy <= 5; dy++) {
        const ix = here.ix + dx;
        const iy = here.iy + dy;
        if (ix < 0 || iy < 0 || ix >= pf.nodesPerAxis || iy >= pf.nodesPerAxis) continue;
        const p = pf.nodeToWorld(ix, iy);
        const d = Math.hypot(p.x - target.x, p.y - target.y);
        if (d < minDist || d > minDist + 700) continue;
        if (this.vehicles.some((v) => !v.destroyed && Math.hypot(v.x - p.x, v.y - p.y) < 60)) continue;
        options.push(p);
      }
    }
    if (options.length === 0) return null;
    const p = options[Math.floor(Math.random() * options.length)];
    const car = createVehicleEntity({
      id: `policia-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
      kind: 'car',
      model: 'Viatura',
      color: '#f1f5f9',
      x: p.x,
      y: p.y,
      angle: Math.atan2(target.y - p.y, target.x - p.x),
    });
    car.police = true;
    car.driver = 'police';
    car.isParked = false;
    car.profile = { ...POLICE_PROFILE };
    car.length = POLICE_PROFILE.length;
    car.health = 140;
    car.route = [];
    car.routeTimer = 0;
    car.shootCooldown = 1 + Math.random();
    this.vehicles.push(car);
    this.policeCars.push(car);
    return car;
  }

  #removeVehicle(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  #updatePolice(dt, currentVehicle) {
    const w = this.wanted;
    const target = currentVehicle || this.player;
    const level = wantedStars(w);

    // Manutenção da lista de viaturas
    for (let i = this.policeCars.length - 1; i >= 0; i--) {
      const car = this.policeCars[i];
      if (car.driver === 'player') { // roubou a viatura
        car.police = false;
        this.policeCars.splice(i, 1);
        this.policeCrime('carjack');
        continue;
      }
      if (car.destroyed && !car.countedDown) {
        car.countedDown = true;
        this.policeCrime('police-down');
      }
      const d = Math.hypot(car.x - target.x, car.y - target.y);
      if (car.destroyed || (level === 0 && d > 950) || d > 2600) {
        this.policeCars.splice(i, 1);
        if (!car.destroyed) this.#removeVehicle(car);
      }
    }

    // Reforços conforme as estrelas
    this.policeSpawnTimer = Math.max(0, this.policeSpawnTimer - dt);
    const active = this.policeCars.filter((c) => !c.destroyed).length;
    if (active < policeCarsFor(desiredPoliceCars(level), level, this.difficulty) && this.policeSpawnTimer <= 0) {
      this.#spawnPoliceCar(target);
      this.policeSpawnTimer = 2.2;
    }

    let seen = false;
    let bustingNow = false;
    for (const car of this.policeCars) {
      if (car.destroyed) continue;
      car.sirenOn = level > 0;
      const d = Math.hypot(car.x - target.x, car.y - target.y);
      if (d < 560) seen = true;

      if (level === 0) {
        // Ficha limpa: a viatura para e vai embora (some quando longe)
        car.aiInput = { moveX: 0, actionPressed: false, secondaryPressed: car.speed > 20 };
        continue;
      }

      car.routeTimer -= dt;
      if (car.routeTimer <= 0 || !car.route?.length) {
        car.route = gridRoute(this.pathfinder, car, target);
        car.routeTimer = 0.7;
      }
      while (car.route.length > 1 && Math.hypot(car.route[0].x - car.x, car.route[0].y - car.y) < 46) car.route.shift();
      const close = d < 170;
      const onFootClose = !currentVehicle && d < 75;
      car.waitingAtTarget = onFootClose;
      if (onFootClose) {
        car.aiInput = { moveX: 0, actionPressed: false, secondaryPressed: car.speed > 15 };
      } else {
        car.aiInput = driveToward(car, close ? target : car.route[0] || target, { ram: close && Boolean(currentVehicle), dt });
      }

      // Bater na viatura também é crime
      car.hitCooldown = Math.max(0, (car.hitCooldown || 0) - dt);
      if (currentVehicle && car.hitCooldown <= 0 && d < (car.radius + currentVehicle.radius + 4)
        && Math.hypot(currentVehicle.vx - car.vx, currentVehicle.vy - car.vy) > 140) {
        car.hitCooldown = 1.5;
        this.policeCrime('hit-police');
      }

      // Voz de prisão
      if (!currentVehicle && d < 62 && car.speed < 80) bustingNow = true;
      if (currentVehicle && d < (car.radius + currentVehicle.radius + 10) && Math.abs(currentVehicle.speed || 0) < 25) bustingNow = true;

      // A partir de 3 estrelas, atiram
      car.shootCooldown -= dt;
      if (level >= this.difficulty.shootFromStars && d < 330 && car.shootCooldown <= 0) {
        car.shootCooldown = 0.8 + Math.random() * 0.6;
        const a = Math.atan2(target.y - car.y, target.x - car.x) + (Math.random() - 0.5) * this.difficulty.policeSpread;
        const ox = car.x + Math.cos(a) * 20;
        const oy = car.y + Math.sin(a) * 20;
        this.policeBullets.push({
          x: ox, y: oy, prevX: ox, prevY: oy, vx: Math.cos(a) * 1000, vy: Math.sin(a) * 1000,
          damage: 8, travelled: 0, range: 420, alive: true,
        });
        this.weaponFx.push({ kind: 'muzzle', x: ox, y: oy, angle: a, life: 0, maxLife: 0.06 });
      }
    }

    // Balas da polícia
    if (this.policeBullets.length > 0) {
      const impacts = stepBullets(this.policeBullets, dt, {
        hitsWall: (x, y) => this.cityMap.getCollidersAround(x, y, 4).some((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h),
        hitVehicle: (x, y) => (currentVehicle && isTouchingVehicle(x, y, 1.5, currentVehicle, 0) ? currentVehicle : null),
        hitPedestrian: (x, y) => (!currentVehicle && Math.hypot(this.player.x - x, this.player.y - y) < 11 ? this.player : null),
      });
      for (const imp of impacts) {
        this.weaponFx.push({ kind: imp.type === 'wall' ? 'spark' : 'hit', x: imp.x, y: imp.y, angle: 0, life: 0, maxLife: 0.25 });
        if (imp.type === 'ped') this.applyDamage(imp.damage, 'A polícia te pegou!');
        if (imp.type === 'vehicle') {
          imp.target.health = Math.max(0, (imp.target.health ?? 100) - imp.damage * 0.5 * this.difficulty.damageTaken);
          if (imp.target.health <= 0) this.#triggerVehicleExplosion(imp.target);
        }
      }
    }

    // Fuga
    const ev = tickWanted(w, dt, seen, this.difficulty.escapeMult);
    if (ev === 'escaped') {
      this.hud.showToast('Você despistou a polícia!', 3000);
      this.partnerSay('escaped', { force: true });
    }

    // Presa?
    this.bustTimer = bustingNow ? this.bustTimer + dt : Math.max(0, this.bustTimer - dt * 2);
    if (level > 0 && this.bustTimer > 1.4) this.#busted(currentVehicle);

    const nowStars = wantedStars(w);
    this.hud.setWanted?.({ stars: nowStars, flash: w.flash, busting: this.bustTimer > 0.2 && nowStars > 0 });
    this.lastStars = nowStars;
  }

  #busted(currentVehicle) {
    this.bustTimer = 0;
    const penalty = Math.min(this.wallet.money, Math.max(100, Math.round(this.wallet.money * this.difficulty.bustPenalty)));
    spend(this.wallet, penalty);
    this.#saveEconomy();
    clearWanted(this.wanted);
    for (const car of this.policeCars) if (!car.destroyed) this.#removeVehicle(car);
    this.policeCars = [];
    this.policeBullets.length = 0;
    if (currentVehicle) {
      currentVehicle.driver = null;
      currentVehicle.vx = 0;
      currentVehicle.vy = 0;
      this.player.inVehicleId = null;
      this.input.setDrivingMode(false);
    }
    let spawn = null;
    try {
      const mission = this.storyPackage?.missions?.[this.currentMissionIndex];
      if (mission?.startLocation) spawn = this.cityMap.resolveLocationCode(mission.startLocation).spawnPoint;
    } catch { spawn = null; }
    if (spawn) {
      this.player.x = spawn.x;
      this.player.y = spawn.y;
      this.camera.x = spawn.x;
      this.camera.y = spawn.y;
    }
    this.player.speed = 0;
    if (this.partner) this.partner.state = 'unplaced';
    this.hud.showBusted?.(penalty);
    this.partnerSay('busted', { force: true });
  }

  // ---- Dinheiro, combos e lojas ----
  #economyKey(suffix) {
    return `gta-${suffix}-${this.storyKey || 'default'}`;
  }

  #initEconomy() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(this.#economyKey('economia')) || 'null'); } catch { saved = null; }
    this.wallet = createWallet(saved?.money || 0);
    this.paidMissions = new Set(Array.isArray(saved?.paidMissions) ? saved.paidMissions : []);
    const ars = this.weapons.arsenal;
    if (saved?.weapons) {
      for (const id of saved.weapons.owned || []) {
        if (!WEAPONS[id]) continue;
        ars.owned.add(id);
        if (!WEAPONS[id].melee) {
          ars.mag[id] = Math.min(WEAPONS[id].magSize, saved.weapons.mag?.[id] ?? WEAPONS[id].magSize);
          ars.reserve[id] = Math.max(0, saved.weapons.reserve?.[id] ?? 0);
        }
      }
      if (ars.owned.has(saved.weapons.current)) ars.current = saved.weapons.current;
    }
    // A Ana Laura sempre começa com uma pistola (vale também para saves antigos).
    if (!ars.owned.has('pistola')) {
      giveWeapon(ars, 'pistola', 48);
      if (!saved?.weapons?.current || saved.weapons.current === 'punhos') selectWeapon(ars, 'pistola');
    }
    this.nearMissCooldowns = new Map();
    this.ecoLastVehicleHealth = null;
    this.shopOpen = false;
    this.shops = [];
    this.garageArmed = true;
  }

  #saveEconomy() {
    const ars = this.weapons.arsenal;
    const data = {
      money: this.wallet.money,
      paidMissions: [...this.paidMissions],
      weapons: { owned: [...ars.owned], current: ars.current, mag: ars.mag, reserve: ars.reserve },
    };
    try { localStorage.setItem(this.#economyKey('economia'), JSON.stringify(data)); } catch { /* sem storage */ }
  }

  #earn(amount, label) {
    const mult = amount > 0 ? (this.difficulty?.moneyMult ?? 1) : 1;
    const v = addMoney(this.wallet, Math.round(amount * mult));
    if (v > 0) this.hud.showMoneyGain?.(v, label);
    this.#saveEconomy();
  }

  #payMissionReward(index, mission) {
    const key = mission?.id || String(index);
    if (this.paidMissions.has(key)) return;
    this.paidMissions.add(key);
    this.#earn(missionReward(index), 'Missão cumprida');
  }

  #countNearMisses(v) {
    let count = 0;
    const now = this.elapsedTime;
    for (const [id, until] of this.nearMissCooldowns) {
      if (until < now) this.nearMissCooldowns.delete(id);
    }
    if ((v.speed || 0) < 230) return 0;
    for (const o of this.vehicles) {
      if (o === v || o.destroyed || this.nearMissCooldowns.has(o.id)) continue;
      const dx = o.x - v.x;
      const dy = o.y - v.y;
      if (Math.abs(dx) > 70 || Math.abs(dy) > 70) continue;
      const gap = Math.hypot(dx, dy) - (v.radius || 17) - (o.radius || 17);
      if (gap > 0 && gap < 11) {
        this.nearMissCooldowns.set(o.id, now + 2.5);
        count += 1;
      }
    }
    return count;
  }

  #updateEconomy(dt, currentVehicle) {
    let crashed = false;
    let nearMisses = 0;
    if (currentVehicle) {
      const h = currentVehicle.health ?? 100;
      if (this.ecoLastVehicleHealth != null && h < this.ecoLastVehicleHealth - 2) crashed = true;
      this.ecoLastVehicleHealth = h;
      if (!crashed) nearMisses = this.#countNearMisses(currentVehicle);
    } else {
      this.ecoLastVehicleHealth = null;
    }
    const events = tickCombo(this.wallet, dt, {
      drifting: Boolean(currentVehicle?.isDrifting),
      driftIntensity: currentVehicle?.driftIntensity || 0,
      speed: currentVehicle?.speed || 0,
      crashed,
      nearMisses,
    });
    for (const ev of events) {
      if (ev.type === 'stunt') this.hud.flashComboStunt?.(ev.label, ev.mult);
      if (ev.type === 'bank') {
        this.hud.showMoneyGain?.(ev.amount, ev.mult > 1 ? `Combo x${ev.mult}` : 'Manobra');
        this.#saveEconomy();
      }
      if (ev.type === 'lost') this.hud.showComboLost?.(ev.amount);
    }
    this.hud.setCombo?.({
      active: comboActive(this.wallet),
      mult: multiplierFor(this.wallet.chain),
      pending: this.wallet.pending,
      label: this.wallet.lastStunt,
      timer: this.wallet.timer,
    });
    this.hud.setMoney?.(this.wallet.money);
  }

  /** Escolhe prédios comerciais livres perto do início para a loja de armas e a oficina. */
  #setupShops() {
    this.shops = [];
    if (!this.cityMap?.locationsByCode) return;
    const used = new Set();
    for (const m of this.storyPackage?.missions || []) {
      for (const c of [m.startLocation, m.pickupLocation, m.targetLocation]) if (c) used.add(String(c).toUpperCase());
    }
    for (const e of this.storyPackage?.encounters || []) if (e.location) used.add(String(e.location).toUpperCase());
    for (const it of this.storyPackage?.extraItems || []) if (it.location) used.add(String(it.location).toUpperCase());
    for (const code of this.storyPackage?.mapRoofs?.keys?.() || []) used.add(code);

    let origin = { x: this.cityMap.worldWidth * 0.5, y: this.cityMap.worldHeight * 0.5 };
    try {
      const startCode = this.storyPackage?.missions?.[0]?.startLocation;
      if (startCode) origin = this.cityMap.resolveLocationCode(startCode).spawnPoint || origin;
    } catch { /* mantém o centro */ }

    const candidates = [];
    for (const [code, loc] of this.cityMap.locationsByCode) {
      if (loc?.type !== 'commerce' || used.has(code) || !loc.spawnPoint) continue;
      candidates.push({ code, loc, d: Math.hypot(loc.spawnPoint.x - origin.x, loc.spawnPoint.y - origin.y) });
    }
    candidates.sort((a, b) => a.d - b.d);
    const gun = candidates[0];
    const garage = candidates.find((c) => gun && Math.hypot(c.loc.spawnPoint.x - gun.loc.spawnPoint.x, c.loc.spawnPoint.y - gun.loc.spawnPoint.y) > 350);
    if (gun) {
      this.shops.push({ kind: 'gun', code: gun.code, name: 'Loja de Armas', point: gun.loc.spawnPoint });
      this.encounterLocationCodes.set(gun.code, { roofColor: '#b91c1c', roofLogo: SHOP_LOGOS.gun });
    }
    if (garage) {
      this.shops.push({ kind: 'garage', code: garage.code, name: 'Oficina', point: garage.loc.spawnPoint });
      this.encounterLocationCodes.set(garage.code, { roofColor: '#1d4ed8', roofLogo: SHOP_LOGOS.garage });
    }
    // No HUD e no mapa, o prédio passa a se chamar pelo nome da loja
    if (this.shops.length > 0) {
      this.locationNames = new Map(this.locationNames || []);
      for (const s of this.shops) this.locationNames.set(s.code, s.name);
    }
  }

  /** Depuração: leva a protagonista até a porta de uma loja ('gun' | 'garage'). */
  debugGoToShop(kind = 'gun') {
    const s = this.shops.find((x) => x.kind === kind);
    if (!s) return null;
    this.player.x = s.point.x;
    this.player.y = s.point.y + 6;
    if (this.partner) this.partner.state = 'unplaced';
    return { code: s.code, name: this.getLocationDisplayName(s.code) };
  }

  #nearShop(kind, radius) {
    return this.shops.find((s) => s.kind === kind && Math.hypot(this.player.x - s.point.x, this.player.y - s.point.y) < radius) || null;
  }

  #openGunShop() {
    const ars = this.weapons.arsenal;
    const items = () => GUN_SHOP.map((it) => ({
      ...it,
      note: it.kind === 'weapon' && ars.owned.has(it.id) ? 'Você já tem (compra munição)' : '',
      disabled: it.kind === 'ammo' && !ars.owned.has(it.weapon),
    }));
    this.#openShop('🔫 Loja de Armas', 'Compre armas e munição', items, (it) => {
      if (it.kind === 'ammo' && !ars.owned.has(it.weapon)) return 'Compre a arma primeiro!';
      if (!spend(this.wallet, it.price)) return 'Dinheiro insuficiente.';
      if (it.kind === 'weapon') {
        giveWeapon(ars, it.id, it.ammo);
        selectWeapon(ars, it.id);
      } else if (it.kind === 'ammo') {
        ars.reserve[it.weapon] = (ars.reserve[it.weapon] || 0) + it.ammo;
      } else if (it.kind === 'heal') {
        this.player.health = 100;
      }
      return null;
    });
  }

  #openGarage(vehicle) {
    const items = () => GARAGE_SHOP.map((it) => ({
      ...it,
      note: (it.kind === 'turbo' && vehicle.turbo) || (it.kind === 'neon' && (vehicle.neon || vehicle.special)) ? 'Já instalado' : '',
      disabled: (it.kind === 'turbo' && vehicle.turbo) || (it.kind === 'neon' && (vehicle.neon || vehicle.special))
        || (it.kind === 'repair' && (vehicle.health ?? 100) >= (vehicle.special ? 200 : 100)),
    }));
    this.#openShop('🔧 Oficina', `Serviços para o seu ${vehicle.kind === 'moto' ? 'moto' : vehicle.kind === 'van' ? 'van' : 'carro'}`, items, (it) => {
      if (!spend(this.wallet, it.price)) return 'Dinheiro insuficiente.';
      if (it.kind === 'repair') vehicle.health = vehicle.special ? 200 : 100;
      if (it.kind === 'paint') {
        const idx = PAINT_COLORS.indexOf(vehicle.color);
        vehicle.color = PAINT_COLORS[(idx + 1) % PAINT_COLORS.length];
        // Pintura nova despista a polícia (se nenhuma viatura estiver olhando)
        if (wantedStars(this.wanted) > 0) {
          if (this.wanted.seenRecently) {
            this.hud.showToast('A polícia viu você entrar! Pintura não adiantou.', 3200);
          } else {
            clearWanted(this.wanted);
            this.hud.showToast('Carro novo, ficha limpa! A polícia perdeu você.', 3200);
          }
        }
      }
      if (it.kind === 'neon') vehicle.neon = true;
      if (it.kind === 'turbo') {
        vehicle.profile = turboProfile(vehicle.profile || VEHICLE_PROFILES[vehicle.kind] || VEHICLE_PROFILES.car);
        vehicle.turbo = true;
      }
      return null;
    });
  }

  #openShop(title, subtitle, itemsFn, onBuy) {
    if (this.shopOpen || !this.hud.openShop) return;
    this.shopOpen = true;
    this.player.speed = 0;
    this.hud.openShop({
      title,
      subtitle,
      getItems: itemsFn,
      getMoney: () => this.wallet.money,
      onBuy: (item) => {
        const err = onBuy(item);
        if (!err) {
          this.#saveEconomy();
          this.partnerSay('shop', { force: true });
        }
        return err;
      },
      onClose: () => {
        this.shopOpen = false;
        this.input.consumeExitTrigger?.();
      },
    });
  }

  // ---- Códigos secretos ----
  #activateCheat(cheat) {
    const currentVehicle = this.player.inVehicleId
      ? this.vehicles.find((v) => v.id === this.player.inVehicleId)
      : null;
    switch (cheat.id) {
      case 'special-car':
        this.#spawnSpecialCar();
        break;
      case 'turbo':
        if (!currentVehicle) {
          this.hud.showToast('Entre num veículo e digite TURBO de novo!', 3200);
          return;
        }
        currentVehicle.profile = turboProfile(currentVehicle.profile || VEHICLE_PROFILES[currentVehicle.kind] || VEHICLE_PROFILES.car);
        currentVehicle.turbo = true;
        break;
      case 'heal':
        this.player.health = 100;
        if (currentVehicle) currentVehicle.health = currentVehicle.special ? 200 : 100;
        break;
      case 'weapons':
        this.weapons?.giveAll?.();
        break;
      case 'partner':
        if (this.partner) {
          this.partner.state = 'unplaced';
        } else {
          this.hud.showToast('Esta história não tem parceira.', 3000);
          return;
        }
        break;
      case 'money':
        this.#earn(REWARDS.cheat, 'Código GRANA');
        break;
      case 'clear-wanted':
        clearWanted(this.wanted);
        break;
      case 'more-wanted':
        reportCrime(this.wanted, 'cheat', 2);
        this.hud.flashWanted?.();
        break;
      case 'night':
        this.renderer.dayCycle.startHour = 22;
        this.renderer.dayCycle.frozen = false;
        this.renderer.dayCycle.offsetTime = this.elapsedTime;
        break;
      case 'day':
        this.renderer.dayCycle.startHour = 10;
        this.renderer.dayCycle.offsetTime = this.elapsedTime;
        break;
      default:
        return;
    }
    this.hud.showToast(`🎮 Código ativado: ${cheat.label}`, 3600);
    this.partnerSay('cheat', { force: true });
  }

  #spawnSpecialCar() {
    const a = this.player.angle || 0;
    const candidates = [
      [Math.cos(a) * 60, Math.sin(a) * 60],
      [-Math.sin(a) * 50, Math.cos(a) * 50],
      [Math.sin(a) * 50, -Math.cos(a) * 50],
      [-Math.cos(a) * 60, -Math.sin(a) * 60],
    ];
    let pos = { x: this.player.x + candidates[0][0], y: this.player.y + candidates[0][1] };
    for (const [dx, dy] of candidates) {
      const x = this.player.x + dx;
      const y = this.player.y + dy;
      const free = !this.cityMap.getCollidersAround(x, y, 40).some((c) => x > c.x - 26 && x < c.x + c.w + 26 && y > c.y - 26 && y < c.y + c.h + 26)
        && !this.vehicles.some((v) => !v.destroyed && Math.hypot(v.x - x, v.y - y) < 50);
      if (free) {
        pos = { x, y };
        break;
      }
    }
    // Só um carro especial por vez
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.special && v.id !== this.player.inVehicleId) this.vehicles.splice(i, 1);
    }
    const car = createVehicleEntity({
      id: `especial-${Date.now()}`,
      kind: 'car',
      model: 'Ana Turbo',
      color: '#ff3fa4',
      x: pos.x,
      y: pos.y,
      angle: a,
      isParked: true,
    });
    car.special = true;
    car.profile = { ...SPECIAL_CAR_PROFILE };
    car.length = SPECIAL_CAR_PROFILE.length;
    car.health = 200;
    this.vehicles.push(car);
  }

  // ---- Parceira (ex.: Camila acompanhando a Ana Laura) ----
  #initPartner() {
    this.partner = null;
    this.partnerChatCooldown = 6;
    this.partnerIdleTimer = 0;
    this.lastPlayerVehicle = null;
    const id = this.storyPackage?.partner;
    const def = id && this.storyPackage?.characters?.get(id);
    if (!def) return;
    this.partner = createPartner(def);
  }

  /** Fala da parceira num balão (respeita intervalo mínimo, exceto se forçar). */
  partnerSay(kind, { force = false } = {}) {
    const p = this.partner;
    if (!p || !p.visible && p.state !== 'riding') return;
    if (!force && this.partnerChatCooldown > 0) return;
    const line = pickLine(kind);
    if (!line) return;
    this.partnerChatCooldown = 7;
    this.partnerIdleTimer = 0;
    const pos = this.#worldToScreen(p.x, p.y, 22);
    this.hud.showNpcSpeechBubble(p, line, pos);
  }

  #updatePartnerFollow(dt, currentVehicle) {
    const p = this.partner;
    if (!p) return;
    if (currentVehicle) this.lastPlayerVehicle = currentVehicle;
    // Enquanto a protagonista entra/sai do carro, a parceira espera
    if (this.player.enteringVehicle || this.player.ejected?.active) return;
    this.partnerChatCooldown = Math.max(0, this.partnerChatCooldown - dt);

    const event = updatePartner(p, {
      player: this.player,
      playerVehicle: currentVehicle,
      lastVehicle: this.lastPlayerVehicle,
      dt,
      resolve: (x, y, r) => resolvePedestrianEnvironmentCollisions(x, y, r, this.cityMap, this.vehicles),
    });
    if (event === 'boarded') this.partnerSay('boarded');
    if (event === 'exited') this.partnerSay('exited');

    if (currentVehicle) {
      if (currentVehicle.isDrifting && currentVehicle.driftIntensity > 0.7 && currentVehicle.speed > 220) {
        this.partnerSay('drift');
      }
      const h = currentVehicle.health ?? 100;
      if (this.partnerLastVehicleHealth != null && h < this.partnerLastVehicleHealth - 6) {
        this.partnerSay('crash');
      }
      this.partnerLastVehicleHealth = h;
    } else {
      this.partnerLastVehicleHealth = null;
    }

    this.partnerIdleTimer += dt;
    if (this.partnerIdleTimer > 38) this.partnerSay('idle');
  }

  #updatePartnerNameplate() {
    const p = this.partner;
    if (!p || !p.visible || p.state === 'riding') return;
    const pos = this.#worldToScreen(p.x, p.y, 32);
    this.pendingPartnerNameplate = { text: p.name, x: pos.x, y: pos.y };
  }

  #updateNameplate(currentVehicle) {
    if (!this.protagonistName || this.player.isDead || this.player.sinking?.active) return;
    const lift = currentVehicle ? Math.max(currentVehicle.length, currentVehicle.width) * 0.5 + 14 : 34;
    const pos = this.#worldToScreen(this.player.x, this.player.y, lift);
    this.pendingNameplate = { text: this.protagonistName, x: pos.x, y: pos.y };
  }

  // Zoom da câmera do jogo: roda do mouse ou teclas + / − (0 volta ao padrão).
  #initCameraZoom(canvas) {
    this.zoomDefault = 1.22;
    this.zoomMin = 0.8;
    this.zoomMax = 2.8;
    let saved = NaN;
    try { saved = Number.parseFloat(localStorage.getItem('gta-zoom')); } catch { /* sem storage */ }
    this.zoomTarget = Number.isFinite(saved) ? Math.min(this.zoomMax, Math.max(this.zoomMin, saved)) : this.zoomDefault;
    this.renderer.zoom = this.zoomTarget;
    canvas?.addEventListener('wheel', (e) => {
      if (!this.running || this.paused || this.cutscene?.active || this.hud.isExpandedMapOpen()) return;
      e.preventDefault();
      this.#setZoomTarget(this.zoomTarget * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }

  #setZoomTarget(value) {
    this.zoomTarget = Math.min(this.zoomMax, Math.max(this.zoomMin, value));
    try { localStorage.setItem('gta-zoom', this.zoomTarget.toFixed(3)); } catch { /* sem storage */ }
  }

  #updateCameraZoom(input, dt) {
    const dir = (input.zoomInPressed ? 1 : 0) - (input.zoomOutPressed ? 1 : 0);
    if (dir !== 0) this.#setZoomTarget(this.zoomTarget * Math.exp(dir * 1.4 * dt));
    if (input.resetZoomJustPressed) this.#setZoomTarget(this.zoomDefault);
    const z = this.renderer.zoom;
    this.renderer.zoom = z + (this.zoomTarget - z) * Math.min(1, dt * 9);
  }

  // Dicas de controle: balão "F Entrar" perto de veículos, barra de controles
  // conforme o modo e uma dica única na primeira vez que dirige.
  #updateVehicleGuidance(currentVehicle) {
    const busy = this.player.enteringVehicle || this.player.exitingVehicle
      || this.player.ejected?.active || (this.player.knockdownTimer || 0) > 0
      || this.player.isDead || this.inventoryController?.isOpen;

    this.hud.setControlsMode?.(currentVehicle ? (currentVehicle.kind === 'moto' ? 'moto' : 'car') : 'foot');

    if (currentVehicle) {
      // Oficina: basta parar o veículo na frente dela
      const garage = this.shops.find((s) => s.kind === 'garage');
      if (garage) {
        const d = Math.hypot(currentVehicle.x - garage.point.x, currentVehicle.y - garage.point.y);
        if (d > 130) this.garageArmed = true;
        if (d < 85) {
          const pos = this.#worldToScreen(garage.point.x, garage.point.y, 40);
          this.pendingContextPrompt = { keys: [], text: '🔧 Pare aqui para entrar na Oficina', x: pos.x, y: pos.y };
          if (this.garageArmed && Math.abs(currentVehicle.speed || 0) < 18) {
            this.garageArmed = false;
            this.#openGarage(currentVehicle);
          }
        }
      }
      if (!this.drivingTipShown) {
        this.drivingTipShown = true;
        let jaViu = false;
        try { jaViu = localStorage.getItem('gta-dica-dirigir') === '1'; } catch { /* sem storage */ }
        if (!jaViu) {
          this.hud.showToast('Dirigindo! W/↑ ou Espaço acelera · S/↓ ou Shift freia e dá ré · A/D vira · F sai', 6500);
          try { localStorage.setItem('gta-dica-dirigir', '1'); } catch { /* sem storage */ }
        }
      }
      // Parada: lembra como sair do veículo
      if (!this.pendingContextPrompt && !busy && Math.abs(currentVehicle.speed || 0) < 15) {
        const pos = this.#worldToScreen(currentVehicle.x, currentVehicle.y, 46);
        const texto = currentVehicle.kind === 'moto' ? 'Descer da moto' : 'Sair do veículo';
        this.pendingContextPrompt = { keys: ['F'], text: texto, x: pos.x, y: pos.y };
      }
      return;
    }
    if (busy || this.#isNearInteriorStoryNpc() || this.#isNearPendingTargetNpc() || this.#findNearbyEncounterNpc()) return;

    const gunShop = this.#nearShop('gun', 50);
    if (gunShop) {
      const pos = this.#worldToScreen(gunShop.point.x, gunShop.point.y, 30);
      this.pendingContextPrompt = { keys: ['F', 'Espaço'], text: 'Entrar na Loja de Armas', x: pos.x, y: pos.y };
      return;
    }

    const nearest = findNearestVehicle(this.player.x, this.player.y, this.vehicles);
    if (!nearest) return;
    const nome = nearest.kind === 'moto' ? 'Subir na moto' : nearest.kind === 'van' ? 'Entrar na van' : 'Entrar no carro';
    const acao = nearest.driver === 'npc' ? `${nome} (tomar do motorista)` : nome;
    const pos = this.#worldToScreen(nearest.x, nearest.y, Math.max(nearest.length, nearest.width) * 0.5 + 6);
    this.pendingContextPrompt = { keys: ['F', 'Espaço'], text: acao, x: pos.x, y: pos.y };
  }

  #updateParticles(dt) {
    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    }
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.smokeParticles.splice(i, 1);
        continue;
      }
      const damp = Math.exp(-2.0 * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += 12 * dt;
    }
  }

  #updateTrashBins(dt, nearbyVehicles) {
    if (!this.trashBins || this.trashBins.length === 0) return;

    for (const bin of this.trashBins) {
      for (const v of nearbyVehicles) {
        if (v.speed <= 12) continue;
        if (Math.abs(bin.x - v.x) > 48 || Math.abs(bin.y - v.y) > 48) continue;
        if (isTouchingVehicle(bin.x, bin.y, bin.radius, v, 1)) {
          hitTrashBin(bin, v.vx, v.vy, v.x, v.y);
        }
      }

      if (!this.player.inVehicleId && !this.player.isDead && this.player.speed > 10) {
        const d = Math.hypot(bin.x - this.player.x, bin.y - this.player.y);
        if (d < bin.radius + this.player.radius) {
          const pvx = Math.cos(this.player.angle) * this.player.speed * 0.85;
          const pvy = Math.sin(this.player.angle) * this.player.speed * 0.85;
          hitTrashBin(bin, pvx, pvy, this.player.x, this.player.y, 75);
        }
      }

      if (bin.vx !== 0 || bin.vy !== 0 || bin.angVel !== 0) {
        updateTrashBin(bin, dt, this.cityMap);
        const binSpeed = Math.hypot(bin.vx, bin.vy);
        if (binSpeed > 45 && this.trafficManager?.pedestrians) {
          for (const ped of this.trafficManager.pedestrians) {
            if (ped.state === 'downed' || (ped.hitCooldown || 0) > 0) continue;
            if (Math.hypot(ped.x - bin.x, ped.y - bin.y) <= bin.radius + (ped.radius || 10)) {
              const dmg = Math.min(85, Math.max(15, Math.round(binSpeed * 0.22)));
              const hit = applyPedestrianDamage(ped, dmg, bin.vx, bin.vy);
              if (hit.damaged) {
                if (hit.downed || dmg >= 35) {
                  this.bloodMarks.push({
                    x: ped.x,
                    y: ped.y,
                    size: hit.downed ? 14 : 9,
                    angle: Math.atan2(bin.vy, bin.vx),
                    alpha: 0.72
                  });
                }
                bin.vx *= -0.45;
                bin.vy *= -0.45;
              }
            }
          }
        }
      }
    }
  }

  #updateExplosions(dt) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.timer += dt;

      const shockProgress = Math.min(1, ex.timer / ex.shockDuration);
      const shockEase = 1 - Math.pow(1 - shockProgress, 2.2);
      ex.shockRadius = ex.shockMaxRadius * shockEase;

      if (!ex.shockDone) {
        if (!ex.hitIds.has('player') && this.player.inVehicleId == null) {
          const pDist = Math.hypot(this.player.x - ex.x, this.player.y - ex.y);
          if (pDist <= ex.shockRadius) {
            ex.hitIds.add('player');
            const dmg = computeShockwaveDamage(pDist, ex.shockMaxRadius, 95);
            if (dmg > 0) {
              this.applyDamage(dmg, 'Você foi atingido pelo deslocamento de ar da explosão!');
            }
          }
        }

        if (this.trafficManager?.pedestrians) {
          for (const ped of this.trafficManager.pedestrians) {
            const key = `ped:${ped.id}`;
            if (ex.hitIds.has(key)) continue;
            const d = Math.hypot(ped.x - ex.x, ped.y - ex.y);
            if (d <= ex.shockRadius) {
              ex.hitIds.add(key);
              const strength = computeShockwaveFalloff(d, ex.shockMaxRadius);
              if (strength > 0) {
                const ang = Math.atan2(ped.y - ex.y, ped.x - ex.x);
                ped.vx = Math.cos(ang) * 240 * strength;
                ped.vy = Math.sin(ang) * 240 * strength;
                if (strength >= 0.25) {
                  ped.state = 'downed';
                  ped.runOver = true;
                  this.bloodMarks.push({
                    x: ped.x,
                    y: ped.y,
                    size: 14,
                    angle: ang,
                    alpha: 0.82
                  });
                }
              }
            }
          }
        }

        for (const other of this.vehicles) {
          if (other.id === ex.sourceVehicleId || other.destroyed) continue;
          const key = `veh:${other.id}`;
          if (ex.hitIds.has(key)) continue;
          const d = Math.hypot(other.x - ex.x, other.y - ex.y);
          if (d <= ex.shockRadius) {
            ex.hitIds.add(key);
            const strength = computeShockwaveFalloff(d, ex.shockMaxRadius);
            if (strength > 0) {
              const ang = Math.atan2(other.y - ex.y, other.x - ex.x);
              other.vx += Math.cos(ang) * 190 * strength;
              other.vy += Math.sin(ang) * 190 * strength;
              const splashSpeed = Math.round(340 * strength);
              if (applyVehicleDamage(other, splashSpeed, 35).exploded) {
                this.#triggerVehicleExplosion(other);
              }
            }
          }
        }

        if (this.trashBins) {
          for (const bin of this.trashBins) {
            const key = `bin:${bin.id}`;
            if (ex.hitIds.has(key)) continue;
            const d = Math.hypot(bin.x - ex.x, bin.y - ex.y);
            if (d <= ex.shockRadius) {
              ex.hitIds.add(key);
              const strength = computeShockwaveFalloff(d, ex.shockMaxRadius);
              if (strength > 0) {
                const ang = Math.atan2(bin.y - ex.y, bin.x - ex.x);
                hitTrashBin(bin, Math.cos(ang) * 280 * strength, Math.sin(ang) * 280 * strength, ex.x, ex.y, 120 * strength);
              }
            }
          }
        }

        if (shockProgress >= 1) {
          ex.shockDone = true;
        }
      }

      if (ex.timer >= ex.duration) {
        this.explosions.splice(i, 1);
      }
    }
  }

  render() {
    const shakeAmp = this.shakeTimer > 0 ? this.shakeTimer * 18 : 0;
    const renderCam =
      shakeAmp > 0
        ? {
            x: this.camera.x + (Math.random() - 0.5) * shakeAmp,
            y: this.camera.y + (Math.random() - 0.5) * shakeAmp
          }
        : this.camera;
    const isPickupStage = this.#isPickupStageActive();
    const activeMission = this.storyPackage?.missions?.[this.currentMissionIndex];
    const pickupItemDef = isPickupStage ? this.storyPackage?.items?.get(activeMission.giveItem) : null;

    const hideTargetNpc = isPickupStage || this.missionOutTriggered || this.freeRoamMode;
    const pendingTargetNpc = isPickupStage && !this.missionOutTriggered && !this.freeRoamMode
      ? this.#getMissionTargetNpcPoint()
      : null;
    const extraNpcs = pendingTargetNpc
      ? [...this.completedNpcPoints, ...this.encounterNpcs, pendingTargetNpc]
      : [...this.completedNpcPoints, ...this.encounterNpcs];
    if (this.#is3dActive()) {
      const now = performance.now();
      const dt3 = Math.min(0.1, (now - (this.last3dFrame || now)) / 1000) || 1 / 60;
      this.last3dFrame = now;
      this.renderer3d.render({
        cityMap: this.cityMap,
        vehicles: this.vehicles,
        pedestrians: this.trafficManager ? this.trafficManager.pedestrians : [],
        player: this.player,
        partner: this.partner,
        bullets: this.policeBullets?.length ? [...this.bullets, ...this.policeBullets] : this.bullets,
        explosions: this.explosions,
        worldCollectibles: this.worldCollectibles,
        objectivePoint: hideTargetNpc ? null : this.objectivePoint,
        gpsPoint: this.freeRoamMode || this.missionOutTriggered ? null : this.objectivePoint,
        objectiveNpcPoint: hideTargetNpc ? null : this.objectiveNpcPoint,
        completedNpcPoints: extraNpcs,
        protagonistColors: this.#characterColors(this.storyPackage?.protagonist),
        partnerColors: this.#characterColors(this.storyPackage?.partner),
        time: this.elapsedTime,
        dt: dt3,
      });
    } else this.renderer.renderFrame({
      camera: renderCam,
      cityMap: this.cityMap,
      vehicles: this.vehicles,
      boats: this.boatManager ? this.boatManager.boats : [],
      trashBins: this.trashBins || [],
      pedestrians: this.trafficManager ? this.trafficManager.pedestrians : [],
      player: this.player,
      playerSprites: this.#getProtagonistSprites(),
      partner: this.partner,
      bullets: this.policeBullets?.length ? [...this.bullets, ...this.policeBullets] : this.bullets,
      weaponFx: this.weaponFx,
      skidMarks: this.skidMarks,
      bloodMarks: this.bloodMarks,
      smokeParticles: this.smokeParticles,
      explosions: this.explosions,
      worldCollectibles: this.worldCollectibles,
      objectivePoint: hideTargetNpc ? null : this.objectivePoint,
      gpsPoint: this.freeRoamMode || this.missionOutTriggered ? null : this.objectivePoint,
      objectiveNpcPoint: hideTargetNpc ? null : this.objectiveNpcPoint,
      completedNpcPoints: extraNpcs,
      encounterLocations: this.encounterLocationCodes,
      emitNpcWaves: !hideTargetNpc && Boolean(this.objectiveNpcPoint || this.objectivePoint),
      time: this.elapsedTime
    });
    if (isPickupStage && pickupItemDef?.imageUrl && !this.cutscene?.active && !this.paused && !this.player.isDead) {
      const screenPos = this.#worldToScreen(this.objectivePoint.x, this.objectivePoint.y);
      this.hud.updateWorldPickupItem(true, screenPos.x, screenPos.y, pickupItemDef.imageUrl, pickupItemDef.name);
    } else {
      this.hud.updateWorldPickupItem(false);
    }

    if (!this.cutscene?.active && !this.paused && !this.player.isDead) {
      const visibleCollectibles = [];
      for (const c of this.worldCollectibles) {
        if (c.collected || !c.imageUrl) continue;
        if (c.kind === 'interior' && this.player.insideLocationCode !== c.locationCode) continue;
        if (Math.abs(c.x - renderCam.x) > 1000 || Math.abs(c.y - renderCam.y) > 800) continue;
        const pos = this.#worldToScreen(c.x, c.y);
        visibleCollectibles.push({
          screenX: pos.x,
          screenY: pos.y,
          imageUrl: c.imageUrl,
          name: c.name
        });
      }
      this.hud.updateWorldCollectibles(visibleCollectibles);
    } else {
      this.hud.updateWorldCollectibles([]);
    }
    this.hud.updateNpcSpeechBubbles?.((bubblePed) => {
      const closeBelowPlayer =
        !this.player.inVehicleId &&
        bubblePed.y > this.player.y &&
        bubblePed.y - this.player.y < 52 &&
        Math.abs(bubblePed.x - this.player.x) < 58;
      const avoidX = closeBelowPlayer
        ? (bubblePed.x >= this.player.x ? 34 : -34)
        : 0;
      return this.#worldToScreen(bubblePed.x + avoidX, bubblePed.y, 22);
    });
    this.minimap.render(
      this.cityMap,
      this.player,
      this.routePoints,
      this.objectivePoint,
      this.worldCollectibles,
      this.encounterLocationCodes,
    );
    if (this.hud.isExpandedMapOpen()) {
      this.#renderExpandedMap();
    }
  }

  #emitVehicleTireMarks(vehicle, targetArray, { alpha, maxCount, length = 8, includeSurface = false }) {
    if (!vehicle || !Array.isArray(targetArray)) return;
    const cos = Math.cos(vehicle.angle);
    const sin = Math.sin(vehicle.angle);
    const rearX = vehicle.x - cos * ((vehicle.length || 44) * 0.28);
    const rearY = vehicle.y - sin * ((vehicle.length || 44) * 0.28);
    const wheelOffsets = vehicle.kind === 'moto' ? [0] : [-1, 1];
    const trackHalf = (vehicle.width || 24) * 0.34;
    const tireWidth = vehicle.kind === 'van' ? 5 : 4;

    for (const side of wheelOffsets) {
      const wx = rearX + (-sin) * trackHalf * side;
      const wy = rearY + cos * trackHalf * side;
      targetArray.push({
        x: wx,
        y: wy,
        angle: vehicle.angle,
        alpha,
        width: tireWidth,
        length,
        size: tireWidth,
        surface: includeSurface && this.cityMap?.getSurfaceAt ? this.cityMap.getSurfaceAt(wx, wy) : undefined,
      });
    }
    while (targetArray.length > maxCount) {
      targetArray.shift();
    }
  }

  #triggerVehicleExplosion(vehicle) {
    if (!vehicle || vehicle.destroyed) return;
    vehicle.destroyed = true;
    vehicle.burning = true;
    vehicle.burnSmokeTimer = 0;
    vehicle.health = 0;
    vehicle.criticalTimer = 0;
    vehicle.driver = null;
    vehicle.vx = 0;
    vehicle.vy = 0;
    vehicle.speed = 0;
    vehicle.isDrifting = false;

    const blastRadius = 155;
    const shockMaxRadius = 215;
    const shockDuration = 0.62;
    const lobes = [];
    for (let i = 0; i < 7; i++) {
      lobes.push({
        angle: (Math.PI * 2 * i) / 7 + (Math.random() - 0.5) * 0.45,
        distScale: 0.28 + Math.random() * 0.42,
        sizeScale: 0.62 + Math.random() * 0.42,
        delay: Math.random() * 0.14
      });
    }
    const sparks = [];
    for (let i = 0; i < 18; i++) {
      sparks.push({
        angle: (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.35,
        speed: 0.75 + Math.random() * 0.75,
        size: 5 + Math.random() * 5
      });
    }

    const hitIds = new Set();
    if (this.player.inVehicleId === vehicle.id) {
      this.player.inVehicleId = null;
      this.player.health = 0;
      this.player.sinkAlpha = 0;
      this.hud.triggerDamageFlash();
      hitIds.add('player');
      this.triggerGameOver('Seu veículo explodiu!');
    }

    this.shakeTimer = 0.55;
    this.explosions.push({
      x: vehicle.x,
      y: vehicle.y,
      sourceVehicleId: vehicle.id,
      timer: 0,
      duration: 1.35,
      radius: blastRadius,
      shockMaxRadius,
      shockDuration,
      shockRadius: 0,
      shockDone: false,
      hitIds,
      lobes,
      sparks
    });

    this.#emitVehicleTireMarks(vehicle, this.skidMarks, {
      alpha: 0.78,
      maxCount: 600,
      length: 12,
      includeSurface: true,
    });

    for (let i = 0; i < 18; i++) {
      const a = (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.25;
      const spd = 40 + Math.random() * 75;
      this.smokeParticles.push({
        x: vehicle.x,
        y: vehicle.y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 16,
        size: 16 + Math.random() * 14,
        alpha: 0.88,
        dark: 0.12,
        life: 0,
        maxLife: 1.25 + Math.random() * 0.45
      });
    }
  }
}
