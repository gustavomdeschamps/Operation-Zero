// OPERATION ZERO — ponto de entrada. Inicializa renderer/cena/câmera, integra os módulos,
// controla os estados (carregamento, abertura, menu, pronto, jogando, pausado, encerrado, online)
// e o loop principal. Preferências e perfil vêm de settings.js (validados antes de usar).
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { EventBus, relativeYaw } from './utils.js';
import { GameMap } from './map.js';
import { Player, InputManager, ACTION_LABELS } from './player.js';
import { WeaponSystem } from './weapon.js';
import { SmokeAbility } from './abilities.js';
import { EnemyManager } from './enemies.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { OnlineMenu } from './online/lobby.js';
import { ShopView } from './ui/shop.js';
import { NetMatch } from './online/match.js';
import * as catalog from './shared/catalog.js';
import { computeSpread } from './shared/weapon-rules.js';
import { TEAM } from './shared/protocol.js';
import { loadSettings, saveSettings, normalizeSettings, loadProfile, saveProfile, prefersReducedMotion } from './settings.js';
import { characterLibrary } from './characters/library.js';
import { HumanCharacter } from './characters/human.js';
import { Studio } from './ui/studio.js';
import { Minimap } from './ui/minimap.js';
import { MainMenu } from './ui/menu.js';
import { SettingsPanel, keyLabel } from './ui/settings-panel.js';
import { Intro } from './ui/intro.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Enquadramento do menu em cada mapa: onde o operador fica e de onde a câmera o observa.
 * hero = posição no piso; cam = ângulo (rad, em torno do operador) e distância da câmera.
 */
const MENU_SHOTS = {
  foundry7: { hero: [1, 22], camAngle: 0.2, camDist: 3.9, from: [-12, 14, -26] },
  vesper: { hero: [-3, 33], camAngle: 0.2, camDist: 3.9, from: [16, 18, -16] },
};

class Game {
  constructor() {
    this.state = 'loading';
    this.canvas = document.getElementById('game-canvas');
    this.ui = new UI();
    this.events = new EventBus();
    this.settings = loadSettings();
    this.profile = loadProfile(catalog);
    this.clock = { last: performance.now(), real: 0 };
    this.fps = { frames: 0, acc: 0 };
    this.stats = { kills: 0, shots: 0, hits: 0, headshots: 0, damageTaken: 0 };
    this.sessionTime = 0;
    this.gameTime = 0;
    this.settingsReturn = 'menu';
    this.debug = new URLSearchParams(location.search).has('debug');
    this.hero = null;
    this.heroKey = '';
    this.charactersReady = false;
    this._eye = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._chest = new THREE.Vector3();
    this._camFrom = new THREE.Vector3();
    this._camTo = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._mmView = { x: 0, z: 0, yaw: 0 };
    this._mmAllies = [];
    this._mmExtras = {};
    this._loop = this.loop.bind(this);
  }

  // ---- inicialização --------------------------------------------------------
  async boot() {
    const ui = this.ui;
    ui.setLoading('Inicializando WebGL…', 0.08);
    await nextFrame();
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      throw new Error('WebGL não está disponível neste navegador/dispositivo.');
    }
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = CONFIG.graphics.exposure;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xb9a3b4, CONFIG.graphics.fogDensity);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, CONFIG.camera.near, CONFIG.camera.far);
    this.camera.rotation.order = 'YXZ';

    ui.setLoading('Construindo a arena FOUNDRY-7…', 0.22);
    await nextFrame();
    this.map = new GameMap(this.scene, { anisotropy: Math.min(8, r.capabilities.getMaxAnisotropy()), mapId: 'foundry7' });
    this.map.build();
    this.scene.environment = this.map.createEnvironment(r);

    ui.setLoading('Calibrando sistemas de combate…', 0.45);
    await nextFrame();
    this.audio = new AudioEngine();
    this.effects = new Effects(this.scene);
    this.input = new InputManager(this.canvas);
    this.input.attach();
    this.player = new Player(this.camera, this.map, this.events);
    this.enemies = new EnemyManager(this.scene, this.map, this.effects, this.audio, this.events);
    this.enemies.spawnAll(this.map.enemySpawns);
    this.weapon = new WeaponSystem({
      camera: this.camera, map: this.map, enemies: this.enemies, effects: this.effects,
      audio: this.audio, events: this.events, player: this.player,
    });
    this.weapon.setLoadout(this.profile.primary);
    this.smoke = new SmokeAbility(this.scene, this.map, this.audio, this.events);
    this.weapon.setEnvironment(this.scene.environment);
    this.enemyCtx = {
      playerPosition: this.player.position,
      playerChest: this._chest,
      playerMovement: null,
      playerSafe: false,
      playerAlive: true,
      time: 0,
      fireBack: true,
      visionBlocked: (a, b) => this.map.segmentBlocked(a, b) || this.smoke.blocksSegment(a, b),
      onPlayerHit: (dmg, src) => this.player.takeDamage(dmg, src),
    };
    this.studio = new Studio(r, this.scene.environment, document.querySelector('[data-screen="menu"]'));
    this.minimap = new Minimap({ canvas: document.getElementById('minimap-canvas'), bigCanvas: document.getElementById('bigmap-canvas') });
    this.minimap.setMap(this.map.collision, this.map.def);
    this.placeHero();

    // personagens: carregam em segundo plano (abertura/carregamento mostram o progresso)
    this.charProgress = { loaded: 0, total: 0 };
    characterLibrary.onProgress((p) => { this.charProgress = p; });
    this.charactersLoading = characterLibrary.preload().then(() => this.onCharactersReady(), (err) => {
      console.warn('[OPERATION ZERO] modelos humanos indisponíveis:', err);
      this.toast('Não foi possível carregar os modelos 3D dos operadores. O jogo segue com silhuetas simplificadas.', 'warn', 5);
    });

    this.wireEvents();
    this.onlineMenu = new OnlineMenu(this);
    this.net = null;
    this.shop = new ShopView(this);
    // acabamentos confirmados pelo servidor também aparecem no treino offline (só visual)
    this.account.onChange((a) => { if (!this.net) this.weapon.setSkins(a.equipped()); this.hero?.setSkins(a.equipped()); this.menu?.onAccountChange(); });
    this.menu = new MainMenu(this);
    this.settingsPanel = new SettingsPanel(this);
    this.intro = new Intro(this);
    this.bindDom();
    this.applySettings({}, false);
    this.setMapChrome();
    this.onResize();

    ui.setLoading('Compilando shaders…', 0.7);
    await nextFrame();
    this.resetSession();
    r.compile(this.scene, this.camera);
    r.compile(this.weapon.viewScene, this.weapon.viewCamera);

    window.__OZ_BOOTED = true;
    if (this.debug) window.__OZ = this;
    this.enemies.setVisible(false);
    requestAnimationFrame(this._loop);
    // a abertura é obrigatória; só ferramentas de teste locais (?nointro em localhost) a dispensam
    const devNoIntro = new URLSearchParams(location.search).has('nointro') && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (!devNoIntro) {
      this.state = 'intro';
      this.introCamT = 0;
      document.body.classList.add('menu-active');
      await this.intro.play({ reduced: this.reducedMotion, loading: this.charactersLoading, progress: () => this.charProgress });
    } else {
      // sem abertura: a tela de carregamento acompanha os modelos (limite de 12 s para nunca travar)
      const until = performance.now() + 12000;
      let done = false;
      this.charactersLoading.then(() => { done = true; });
      while (!done && performance.now() < until) {
        const p = this.charProgress;
        ui.setLoading(`Carregando operadores e animações… ${p.loaded}/${p.total || '—'}`, 0.7 + 0.3 * (p.total ? p.loaded / p.total : 0));
        await new Promise((res) => setTimeout(res, 120));
      }
      ui.setLoading('Pronto', 1);
    }
    this.enterMenu();
  }

  /** Modelos humanos carregados: bots de treino viram soldados e o menu ganha o operador. */
  onCharactersReady() {
    this.charactersReady = true;
    this.enemies.useHumans(this.weapon.materials);
    this.enemies.setVisible(this.state === 'playing' || this.state === 'ready' || this.state === 'paused' || this.state === 'ended');
    this.syncHero();
    if (this.menu.pane === 'operators' && this.menu.visible) this.menu.renderOperators();
  }

  wireEvents() {
    const ev = this.events;
    const ui = this.ui;
    this.unsubscribers = [
      ev.on('ammoChanged', (a) => ui.setAmmo(a)),
      ev.on('shotFired', () => { this.stats.shots++; }),
      ev.on('enemyHit', ({ killed, headshot }) => {
        this.stats.hits++;
        if (headshot) this.stats.headshots++;
        ui.hitmarker(killed ? 'kill' : headshot ? 'head' : 'body');
        this.audio.play(headshot ? 'hitHead' : 'hitBody');
      }),
      ev.on('enemyKilled', ({ enemy, headshot }) => {
        this.stats.kills++;
        ui.setKills(this.stats.kills, CONFIG.session.targetKills);
        ui.killfeed(`${enemy.id} NEUTRALIZADO`, headshot ? 'head' : 'kill');
        this.audio.play('kill');
        const left = CONFIG.session.targetKills - this.stats.kills;
        if (left > 0) ui.setObjective(`Elimine mais ${left} alvo${left === 1 ? '' : 's'} hostis`);
        if (this.stats.kills >= CONFIG.session.targetKills) this.endSession(true);
      }),
      ev.on('playerDamaged', ({ amount, source }) => {
        this.stats.damageTaken += amount;
        ui.damage(source, amount);
        this.audio.play('hurt');
      }),
      ev.on('playerDied', () => this.endSession(false)),
      ev.on('abilityDenied', ({ reason }) => { ui.message(reason, 'warn', 1.4); ui.abilityDenied(); }),
      ev.on('smokeDeployed', () => ui.message('NÉVOA ATIVA — 5s', 'good', 1.2)),
      ev.on('abilityReady', () => ui.killfeed('NÉVOA CIANO PRONTA', 'info')),
      ev.on('footstep', () => this.audio.play('footstep')),
      ev.on('land', ({ speed }) => this.audio.play('land', { intensity: speed / 8 })),
      ev.on('jump', () => this.audio.play('jump')),
      ev.on('reloadStart', () => ui.setReload(0, true)),
    ];
  }

  bindDom() {
    this.listeners = [];
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); this.listeners.push([target, type, fn, opts]); };
    document.querySelectorAll('[data-action]').forEach((btn) => {
      on(btn, 'click', (e) => { e.preventDefault(); this.audio.play('uiClick'); this.handleAction(btn.dataset.action); });
    });
    on(document.getElementById('settings-form'), 'submit', (e) => e.preventDefault());
    on(document, 'pointerlockchange', () => this.onPointerLockChange());
    on(document, 'pointerlockerror', () => this.onPointerLockError());
    on(this.canvas, 'click', () => {
      if (this.state === 'ready' || (this.net && this.net.inGame && this.state !== 'playing' && !this.ui.currentScreen)) this.requestLock();
    });
    on(window, 'resize', () => this.onResize());
    on(window, 'keydown', (e) => {
      if (e.code === 'Escape' && this.bigmapOpen) { e.preventDefault(); this.toggleBigmap(false); return; }
      if (e.code === 'Escape' && this.state === 'paused' && this.ui.currentScreen === 'pause') this.requestLock();
      if (e.code === 'Escape' && this.ui.currentScreen === 'settings' && !this.settingsPanel.waitingBind) this.handleAction('settings-back');
      if (e.code === 'Escape' && this.ui.currentScreen === 'controls') this.handleAction('controls-back');
      // mapa tático: tecla configurável, durante a partida (não pausa o jogo)
      if (this.settings.binds.map.includes(e.code) && !e.repeat && (this.state === 'playing' || this.bigmapOpen)) this.toggleBigmap();
    });
    // o áudio só pode começar após um gesto do jogador (regra dos navegadores)
    const unlock = () => { this.audio.init(); };
    on(window, 'pointerdown', unlock, { capture: true });
    on(window, 'keydown', unlock, { capture: true });
    on(document, 'visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    on(document, 'fullscreenchange', () => this.ui.toast(document.fullscreenElement ? 'Tela cheia ativada.' : 'Tela cheia desativada.'));
    on(this.canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.state = 'error';
      this.ui.showHUD(false);
      this.ui.showError('O contexto WebGL foi perdido (driver/GPU). Recarregue a página para continuar.');
    });
    // Ctrl (agachar) + W fecha a aba em navegadores e não pode ser bloqueado; durante a sessão
    // pedimos confirmação antes de sair para evitar perda acidental da partida.
    on(window, 'beforeunload', (e) => {
      if (this.state === 'playing' || this.state === 'paused' || this.state === 'ready' || (this.net && this.net.inGame)) { e.preventDefault(); e.returnValue = ''; }
    });
    on(window, 'pagehide', () => this.dispose());
  }

  toast(text, kind = '', seconds) { this.ui.toast(text, kind, seconds); }

  // ---- estados -------------------------------------------------------------
  handleAction(action) {
    switch (action) {
      case 'play':
      case 'restart':
        this.audio.init();
        this.startTraining();
        break;
      case 'resume':
        this.audio.init();
        this.toggleBigmap(false);
        this.requestLock();
        break;
      case 'quit':
        this.enterMenu();
        break;
      case 'settings':
        this.settingsReturn = this.ui.currentScreen || 'menu';
        this.settingsPanel.show();
        this.ui.showScreen('settings');
        break;
      case 'settings-back':
        this.settingsPanel.waitingBind = null;
        if (this.settingsReturn === 'menu') this.menu.show();
        else this.ui.showScreen(this.settingsReturn);
        break;
      case 'settings-reset': this.settingsPanel.resetTab(); break;
      case 'controls':
        this.fillControls();
        this.controlsReturn = this.ui.currentScreen || 'menu';
        this.ui.showScreen('controls');
        break;
      case 'credits': this.ui.showScreen('credits'); break;
      case 'credits-back': this.menu.show(); break;
      case 'case-equip': this.shop.equipLast(); break;
      case 'case-close': this.shop.close(); break;
      case 'net-play-again': this.net?.playAgain(); break;
      case 'controls-back':
        if (this.controlsReturn === 'menu' || !this.controlsReturn) this.menu.show(); else this.ui.showScreen(this.controlsReturn);
        break;
      case 'toggle-mute': this.applySettings({ muted: !this.settings.muted }, true); break;
      case 'toggle-fullscreen': this.toggleFullscreen(); break;
      // ---- visualizadores 3D
      case 'viewer-rotate-left': this.studio.rotateBy(-0.6); break;
      case 'viewer-rotate-right': this.studio.rotateBy(0.6); break;
      case 'viewer-zoom-in': this.studio.zoomBy(0.85); break;
      case 'viewer-zoom-out': this.studio.zoomBy(1.18); break;
      case 'viewer-inspect': this.studio.inspect(); break;
      case 'operator-select': this.menu.selectOperator(); break;
      case 'weapon-equip': this.menu.equipWeapon(); break;
      // ---- mapa tático
      case 'bigmap-open': this.toggleBigmap(true); break;
      case 'bigmap-close': this.toggleBigmap(false); break;
      case 'bigmap-zoom': document.getElementById('bigmap-zoom-label').textContent = `${this.minimap.cycleZoom()}×`; this.drawBigmapNow(); break;
      // ---- multiplayer
      case 'net-quick-tdm': this.audio.init(); this.onlineMenu.quick('tdm'); break;
      case 'net-quick-tactical': this.audio.init(); this.onlineMenu.quick('tactical'); break;
      case 'net-create': this.audio.init(); this.onlineMenu.create(); break;
      case 'net-join-code': this.audio.init(); this.onlineMenu.joinCode(); break;
      case 'net-refresh': this.onlineMenu.refreshRooms(); break;
      case 'net-cancel': this.onlineMenu.cancel(); break;
      case 'net-ready': this.net?.toggleReady(); break;
      case 'net-start': this.net?.requestStart(); break;
      case 'net-switch-team': this.net?.switchTeam(); break;
      case 'bots-add-1': this.net?.bots('add', { team: 1 }); break;
      case 'bots-add-2': this.net?.bots('add', { team: 2 }); break;
      case 'bots-remove': this.net?.bots('remove'); break;
      case 'net-copy-code': this.copyRoomCode(); break;
      case 'lobby-operators': this.menu.openFromLobby('operators'); break;
      case 'lobby-arsenal': this.menu.openFromLobby('arsenal'); break;
      case 'menu-back-lobby': this.menu.backToLobby(); break;
      case 'net-leave':
      case 'net-abandon': this.leaveOnline(); break;
      default: break;
    }
  }

  /** Treinamento offline: sempre na Foundry-7, com o kit do perfil. */
  startTraining() {
    this.toggleBigmap(false);
    this.setMap('foundry7');
    this.weapon.setLoadout(this.profile.primary);
    this.enemies.setVisible(true);
    this.setHeroVisible(false);
    this.resetSession();
    this.enterReady();
  }

  /** Entra na sala online já conectada (lobby → partida). O modo offline fica intacto. */
  beginOnline(conn, room) {
    this.resetSession();
    this.state = 'online';
    this.input.enabled = false;
    this.input.reset();
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.studio.active = false;
    this.net = new NetMatch(this, conn, room, this.onlineMenu);
    if (this.debug) window.__OZ_NET = this.net;
    this.ui.showScreen('lobby');
  }

  async leaveOnline(message = '') {
    const net = this.net;
    this.net = null;
    this.toggleBigmap(false);
    this.menu.exitLobbyOverlay();
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.enabled = false;
    this.input.reset();
    if (net) { net.dispose(); await net.conn.leave(); }
    this.weapon.setLoadout(this.profile.primary);
    this.weapon.setSkins(this.account.equipped());
    if (this.account.token) this.account.refresh();
    this.enterMenu();
    this.onlineMenu.open(message);
  }

  copyRoomCode() {
    const code = this.net?.state?.code;
    if (!code) return;
    const done = () => { this.onlineMenu.el.lobbyStatus.textContent = `Código ${code} copiado. Envie para seus amigos.`; this.toast(`Código ${code} copiado.`); };
    try { navigator.clipboard.writeText(code).then(done, done); } catch { done(); }
  }

  enterMenu() {
    this.state = 'menu';
    if (document.pointerLockElement) document.exitPointerLock();
    this.toggleBigmap(false);
    this.input.enabled = false;
    this.input.reset();
    this.resetSession();
    this.enemies.setVisible(false);
    this.setHeroVisible(true);
    this.ui.showHUD(false);
    this.ui.showLockPrompt(false);
    this.menu.show(this.menu.pane === 'play' && !this.menu.fromLobby ? 'play' : 'home');
  }

  /** Sessão preparada; aguardando a captura do mouse para começar. */
  enterReady() {
    this.state = 'ready';
    this.studio.active = false;
    this.ui.showScreen(null);
    this.ui.showHUD(true);
    this.ui.showLockPrompt(true, 'CLIQUE PARA COMEÇAR');
    this.requestLock();
  }

  requestLock() {
    if (document.pointerLockElement === this.canvas) { this.onPointerLockChange(); return; }
    try {
      let p;
      try { p = this.canvas.requestPointerLock({ unadjustedMovement: true }); } catch { p = this.canvas.requestPointerLock(); }
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // alguns sistemas não suportam movimento sem aceleração: tenta o modo padrão
          const p2 = this.canvas.requestPointerLock();
          if (p2 && typeof p2.catch === 'function') p2.catch(() => this.onPointerLockError());
        });
      }
    } catch {
      this.onPointerLockError();
    }
  }

  onPointerLockChange() {
    const locked = document.pointerLockElement === this.canvas;
    if (locked && (this.state === 'ready' || this.state === 'paused' || (this.net && this.state === 'online' && this.net.inGame))) this.startPlaying();
    else if (!locked && this.state === 'playing') this.pause();
  }

  onPointerLockError() {
    if (this.state === 'paused') {
      document.getElementById('pause-hint').textContent = 'O navegador recusou a captura do mouse. Aguarde um instante e clique em RETOMAR novamente.';
    } else if (this.state === 'ready') {
      this.ui.showLockPrompt(true, 'CLIQUE NA TELA PARA CAPTURAR O MOUSE');
    }
  }

  startPlaying() {
    const first = this.state === 'ready';
    this.state = 'playing';
    this.input.reset();
    this.input.enabled = true;
    this.ui.showScreen(null);
    this.ui.showHUD(true);
    this.ui.showLockPrompt(false);
    this.audio.resume();
    document.body.classList.remove('menu-active');
    document.getElementById('pause-hint').textContent = 'O combate, os bots e os temporizadores estão congelados.';
    if (first) this.ui.message(`OBJETIVO: ELIMINE ${CONFIG.session.targetKills} ALVOS HOSTIS`, 'info', 3);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.weapon.adsT = 0;
    this.toggleBigmap(false);
    // online a partida não para: só o modo offline congela o jogo e o áudio
    if (!this.net) this.audio.suspend();
    document.getElementById('pause-hint').textContent = this.net
      ? 'A partida online continua enquanto você está neste menu.'
      : 'O combate, os bots e os temporizadores estão congelados.';
    this.ui.showScreen('pause');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  endSession(victory) {
    if (this.state !== 'playing') return;
    this.state = 'ended';
    this.input.enabled = false;
    this.input.reset();
    this.toggleBigmap(false);
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.play(victory ? 'victory' : 'defeat');
    this.ui.showEnd({
      victory, kills: this.stats.kills, target: CONFIG.session.targetKills, time: this.sessionTime,
      shots: this.stats.shots, hits: this.stats.hits, headshots: this.stats.headshots, damageTaken: this.stats.damageTaken,
    });
  }

  /** Restaura a sessão sem recriar entidades (sem duplicar bots, armas, eventos ou HUD). */
  resetSession() {
    this.stats = { kills: 0, shots: 0, hits: 0, headshots: 0, damageTaken: 0 };
    this.sessionTime = 0;
    this.gameTime = 0;
    this.ui.reset();
    this.player.reset();
    this.weapon.reset();
    this.smoke.reset();
    this.enemies.reset();
    this.effects.clear();
    for (const s of this.map.ammoStations) s.cooldown = 0;
    this.ui.setKills(0, CONFIG.session.targetKills);
    this.ui.setObjective(`Elimine ${CONFIG.session.targetKills} alvos hostis`);
    this.ui.setHealth(this.player.health);
    this.ui.setTimer(0);
    this.ui.setAbility(this.smoke.getStatus());
    this.ui.setReload(0, false);
    this.weapon.emitAmmo();
  }

  // ---- mapas -------------------------------------------------------------------
  /**
   * Troca o mapa carregado (visual + colisão). Online o mapa vem do estado da sala; offline o
   * treinamento usa a Foundry-7; no menu, "VER MAPA" mostra qualquer mapa no fundo.
   */
  setMap(id) {
    if (!catalog.isValidMap(id) || !this.map.load(id)) return false;
    this.scene.environment = this.map.createEnvironment(this.renderer);
    this.weapon.setEnvironment(this.scene.environment);
    this.studio.scene.environment = this.scene.environment;
    this.minimap.setMap(this.map.collision, this.map.def);
    this.applyGraphics();
    this.setMapChrome();
    this.placeHero();
    this.effects.clear();
    // fumaças do mapa anterior somem; online, as nuvens continuam vindo só do servidor
    const netMode = this.smoke.netMode;
    this.smoke.reset();
    this.smoke.netMode = netMode;
    return true;
  }

  setMapChrome() {
    this.renderer.toneMappingExposure = CONFIG.graphics.exposure * (this.map.exposure || 1);
    document.getElementById('hud-arena-name').textContent = this.map.name;
    document.getElementById('bigmap-title').textContent = this.map.name;
  }

  // ---- operador do menu --------------------------------------------------------------
  /** Cria/atualiza o operador exibido no fundo do menu (o mesmo do perfil, uniforme ALFA). */
  syncHero() {
    if (!this.charactersReady) return;
    const key = `${this.profile.operator}:${this.profile.primary}`;
    if (this.hero && this.heroKey === key) return;
    if (!characterLibrary.isReady(this.profile.operator)) return;
    if (this.hero && this.hero.operator === this.profile.operator) {
      this.hero.setWeapon(this.profile.primary, true);
    } else {
      if (this.hero) { this.scene.remove(this.hero.root); this.hero.dispose(); }
      this.hero = new HumanCharacter({ operator: this.profile.operator, team: TEAM.ALFA, weaponMaterials: this.weapon.materials, weapon: this.profile.primary });
      this.scene.add(this.hero.root);
    }
    this.hero.setSkins(this.account.equipped());
    this.heroKey = key;
    this.placeHero();
    this.setHeroVisible(this.state === 'menu' || this.state === 'intro' || this.state === 'online');
  }

  placeHero() {
    const shot = MENU_SHOTS[this.map.id] || MENU_SHOTS.foundry7;
    const [x, z] = shot.hero;
    this.heroPos = new THREE.Vector3(x, this.map.groundHeight(x, z, 3, 0.3), z);
    // o operador olha para a câmera (yaw 0 = olhando para -Z)
    const cx = Math.sin(shot.camAngle) * shot.camDist, cz = Math.cos(shot.camAngle) * shot.camDist;
    this.heroYaw = Math.atan2(-cx, -cz) - 0.3;     // três quartos, levemente voltado para a câmera
    if (this.hero) { this.hero.root.position.copy(this.heroPos); this.hero.bodyYaw = this.heroYaw; }
  }

  setHeroVisible(v) { if (this.hero) this.hero.setVisible(v); }

  /** Perfil mudou (operador/arma): atualiza o menu e o kit offline. */
  onProfileLoadout() {
    this.syncHero();
    if (!this.net && this.state === 'menu') this.weapon.setLoadout(this.profile.primary);
  }

  saveProfile() { saveProfile(this.profile); }

  /** Pose final da câmera do menu para o mapa atual (o operador fica no terço direito). */
  menuCameraPose(time, outPos, outLook) {
    const shot = MENU_SHOTS[this.map.id] || MENU_SHOTS.foundry7;
    const h = this.heroPos || new THREE.Vector3(shot.hero[0], 0, shot.hero[1]);
    const drift = this.reducedMotion ? 0 : Math.sin(time * 0.11) * 0.07;
    const a = shot.camAngle + drift;
    const d = shot.camDist + (this.reducedMotion ? 0 : Math.sin(time * 0.07) * 0.15);
    outPos.set(h.x + Math.sin(a) * d, h.y + 1.45 + (this.reducedMotion ? 0 : Math.sin(time * 0.09) * 0.04), h.z + Math.cos(a) * d);
    // alvo deslocado para a esquerda do operador: ele aparece à direita, o texto do menu à esquerda
    const rightX = Math.cos(a), rightZ = -Math.sin(a);
    outLook.set(h.x - rightX * 0.62, h.y + 1.12, h.z - rightZ * 0.62);
  }

  updateMenuCamera(dt) {
    const cam = this.camera;
    this.menuCameraPose(this.clock.real, this._camTo, this._look);
    cam.position.copy(this._camTo);
    cam.lookAt(this._look);
    if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
    this.updateHero(dt);
    this.map.update(dt, this.clock.real);
    this.effects.update(dt);
  }

  /** Abertura: voo do alto do mapa até o enquadramento do menu. */
  updateIntroCamera(dt, k) {
    const cam = this.camera;
    const shot = MENU_SHOTS[this.map.id] || MENU_SHOTS.foundry7;
    this.menuCameraPose(this.clock.real, this._camTo, this._look);
    const h = this.heroPos || this._look;
    const e = smoothstep(Math.min(1, k));
    if (this.reducedMotion) {
      cam.position.copy(this._camTo);
      cam.lookAt(this._look);
    } else {
      // arco: começa alto e afastado, desce sobre o mapa e termina no operador
      this._camFrom.set(h.x + shot.from[0], h.y + shot.from[1], h.z + shot.from[2]);
      const mid = this._dir.copy(this._camFrom).lerp(this._camTo, 0.55);
      mid.y += 3;
      const u = 1 - e;
      cam.position.set(
        u * u * this._camFrom.x + 2 * u * e * mid.x + e * e * this._camTo.x,
        u * u * this._camFrom.y + 2 * u * e * mid.y + e * e * this._camTo.y,
        u * u * this._camFrom.z + 2 * u * e * mid.z + e * e * this._camTo.z,
      );
      const look = this._eye.set(h.x, h.y + 1.0, h.z).lerp(this._look, smoothstep(Math.min(1, k * 1.2)));
      cam.lookAt(look);
    }
    if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
    this.updateHero(dt);
    this.map.update(dt, this.clock.real);
  }

  updateHero(dt) {
    const h = this.hero;
    if (!h || !h.visible) return;
    const t = this.clock.real;
    h.root.position.copy(this.heroPos);
    h.bodyYaw = this.heroYaw;
    const calm = this.reducedMotion ? 0 : 1;
    h.update(dt, {
      vx: 0, vz: 0, crouch: 0, air: false,
      aimYaw: this.heroYaw - 0.25 + Math.sin(t * 0.37) * 0.1 * calm,
      aimPitch: -0.12 + Math.sin(t * 0.5) * 0.03 * calm,
      lowReady: 0.85 + Math.sin(t * 0.29) * 0.15 * calm,
    });
  }

  // ---- mapa tático, minimapa e mira -----------------------------------------------------
  toggleBigmap(open = !this.bigmapOpen) {
    if (open === !!this.bigmapOpen) return;
    this.bigmapOpen = open;
    this.minimap.toggleBig(open);
    document.getElementById('bigmap').classList.toggle('hidden', !open);
    if (open) this.drawBigmapNow();
  }

  drawBigmapNow() { if (this.bigmapOpen) this.minimap.drawBig(this._mmView, this._mmAllies, this._mmExtras); }

  /** Atualiza minimapa (e mapa ampliado aberto) com você + aliados. Nunca recebe inimigos. */
  updateMinimap(dt, allies = [], extras = {}) {
    const v = this._mmView;
    v.x = this.player.position.x; v.z = this.player.position.z; v.yaw = this.player.yaw;
    this._mmAllies = allies;
    this._mmExtras = extras;
    if (this.settings.showMinimap || this.bigmapOpen) this.minimap.update(dt, v, allies, extras);
  }

  /** Retícula: abertura conforme a dispersão REAL (movimento e disparos), visibilidade por estado. */
  updateCrosshair(movement, alive = true) {
    const w = this.weapon, def = w.current.def, cfg = this.settings.crosshair;
    const ads = w.adsT;
    const pxPerRad = (this.viewportHeight / 2) / Math.tan((this.camera.fov * Math.PI) / 360);
    let spread = 0;
    if (cfg.moveExpand) {
      const base = computeSpread(def, movement, ads, 0);
      const still = computeSpread(def, { state: 'idle', speed: 0, crouching: movement.crouching }, ads, 0);
      spread += Math.max(0, base - still) * pxPerRad;
    }
    if (cfg.fireExpand) spread += w.bloom * pxPerRad;
    this.ui.setCrosshairSpread(spread);
    const optic = ads >= 0.6 && def.id !== 'pistol';
    const scoped = alive && w.scoped;
    this.ui.setScope(scoped);
    this.ui.setCrosshairVisible(alive && !scoped && (!optic || cfg.showAds) && (!w.reloading || cfg.showReload));
  }

  // ---- configurações ---------------------------------------------------------
  get reducedMotion() { return prefersReducedMotion(this.settings); }

  /** Aplica (e opcionalmente salva) preferências. Tudo passa por normalizeSettings. */
  applySettings(patch, persist) {
    const prev = this.settings;
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    const st = this.settings;
    this.player.setSensitivity(st.sensitivity, { vertical: st.sensitivityY, invertY: st.invertY, ads: st.adsSensitivity });
    this.input.setBinds(st.binds);
    this.audio.setLevels({ master: st.volume, sfx: st.sfxVolume, ui: st.uiVolume, music: st.musicVolume, muted: st.muted });
    const mute = document.getElementById('btn-mute');
    mute.classList.toggle('on', st.muted);
    mute.setAttribute('aria-pressed', String(st.muted));
    mute.title = st.muted ? 'Ativar o som' : 'Silenciar';
    this.enemyCtx.fireBack = st.botsFireBack;
    this.ui.setFpsVisible(st.showFps);
    this.ui.setCrosshairConfig(st.crosshair);
    this.effects.setQuality(st.effectsQuality, st.reduceEffects);
    this.weapon.flashScale = st.reduceEffects ? 0.35 : 1;
    // interface e acessibilidade (variáveis CSS e classes do <body>)
    const root = document.documentElement.style;
    root.setProperty('--hud-user-scale', String(st.hudScale));
    root.setProperty('--mm-scale', String(st.minimapScale));
    this.minimap.setStyle({ scale: st.minimapScale, opacity: st.minimapOpacity });
    const body = document.body.classList;
    body.toggle('minimap-left', st.minimapPosition === 'top-left');
    body.toggle('minimap-right', st.minimapPosition === 'top-right' && st.showMinimap);
    body.toggle('hide-minimap', !st.showMinimap);
    body.toggle('hide-killfeed', !st.showKillfeed);
    body.toggle('high-contrast', st.highContrast);
    body.toggle('reduce-motion', this.reducedMotion);
    for (const k of ['minimap-key', 'bigmap-key']) document.getElementById(k).textContent = keyLabel(st.binds.map[0]);
    document.getElementById('ability-key').textContent = keyLabel(st.binds.ability[0]);
    if (this.state !== 'playing' && this.camera.fov !== st.fov && (this.state === 'ready' || this.state === 'paused')) { this.camera.fov = st.fov; this.camera.updateProjectionMatrix(); }
    const gfxChanged = !this._gfxApplied || ['quality', 'renderScale', 'shadowQuality'].some((k) => prev[k] !== st[k]);
    if (gfxChanged) { this._gfxApplied = true; this.applyGraphics(); this.onResize(); }
    if (persist && !saveSettings(st)) this.toast('Não foi possível salvar as preferências neste navegador.', 'warn');
  }

  /** Qualidade gráfica: sombras (com tamanho do mapa de sombra) e resolução. */
  applyGraphics() {
    const st = this.settings;
    const preset = CONFIG.graphics.presets[st.quality] || CONFIG.graphics.presets[CONFIG.graphics.defaultQuality];
    const sizes = { low: 1024, medium: 2048, high: 4096 };
    const shadows = st.shadowQuality === 'auto' ? preset.shadows : st.shadowQuality !== 'off';
    const size = st.shadowQuality === 'auto' ? preset.shadowMapSize : sizes[st.shadowQuality] || 2048;
    const changed = this.renderer.shadowMap.enabled !== shadows;
    this.renderer.shadowMap.enabled = shadows;
    this.map.setShadowQuality(shadows, size);
    if (changed) {
      const refresh = (o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); };
      this.scene.traverse(refresh);
      this.studio.scene.traverse(refresh);
    }
  }

  toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => this.toast('O navegador recusou a tela cheia.', 'warn'));
    } catch { this.toast('Tela cheia não suportada neste navegador.', 'warn'); }
  }

  /** Tela CONTROLES: gerada a partir das teclas configuradas. */
  fillControls() {
    const dl = document.getElementById('controls-copy');
    const b = this.settings.binds;
    const keys = (a) => b[a].map(keyLabel).join(' / ');
    const rows = [
      ['Mover', `${keys('forward')} ${keys('left')} ${keys('back')} ${keys('right')}`],
      ['Olhar', 'Mouse'], ['Atirar', 'Botão esquerdo'], ['Mirar', 'Botão direito'],
      ...['jump', 'crouch', 'walk', 'reload', 'ability', 'interact', 'primary', 'secondary', 'scoreboard', 'map'].map((a) => [ACTION_LABELS[a], keys(a)]),
      ['Pausar / menus', 'Esc'],
    ];
    dl.replaceChildren(...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd');
      const k = document.createElement('kbd'); k.textContent = value;
      dd.append(k);
      return [dt, dd];
    }));
  }

  onResize() {
    if (!this.renderer) return;
    const preset = CONFIG.graphics.presets[this.settings.quality] || CONFIG.graphics.presets.medium;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio) * this.settings.renderScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weapon.setAspect(w / h);
    this.studio.setAspect(w / h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.effects.setViewport(size.y, this.camera.fov);
    this.viewportHeight = h;
  }

  // ---- loop -----------------------------------------------------------------
  loop(now) {
    if (this.state === 'disposed') return;
    requestAnimationFrame(this._loop);
    // limite de FPS: pula quadros até completar o intervalo pedido
    const limit = this.settings.fpsLimit;
    if (limit && now - this.clock.last < 1000 / limit - 0.75) return;
    let dt = (now - this.clock.last) / 1000;
    this.clock.last = now;
    if (!(dt > 0)) dt = 0;
    const realDt = Math.min(dt, 0.25);
    this.clock.real += realDt;
    dt = Math.min(dt, CONFIG.perf.maxDelta);   // evita saltos após travamentos ou ao retomar

    this.fps.frames++;
    this.fps.acc += (now - (this.fps.lastNow || now)) / 1000;
    this.fps.lastNow = now;
    if (this.fps.acc >= 0.5) {
      this.ui.setFps(Math.round(this.fps.frames / this.fps.acc));
      this.fps.frames = 0; this.fps.acc = 0;
    }

    const studio = this.studio.active && this.ui.currentScreen === 'menu';
    // o operador do menu só existe no menu, na abertura e no lobby — nunca dentro da partida
    const heroWanted = this.state === 'menu' || this.state === 'intro' || (!!this.net && !this.net.inGame);
    if (this.hero && this.hero.visible !== heroWanted) this.hero.setVisible(heroWanted);
    if (this.net) this.net.frame(dt);
    else if (this.state === 'playing') this.update(dt);
    else if (this.state === 'intro') this.updateIntroCamera(dt, this.intro.update(realDt));   // tempo real: duração fixa mesmo com FPS baixo
    else if (this.state === 'menu' && !studio) this.updateMenuCamera(dt);
    if (studio) this.studio.update(dt);
    this.updateAmbience();
    // testes automatizados (somente com ?debug) podem pular a renderização para rodar a lógica em tempo real
    if (this.state !== 'loading' && !(this.debug && this.debugSkipRender)) this.render(studio);
  }

  /** Ambiente sonoro: o do menu na abertura, no menu e no lobby; o do mapa durante a partida. */
  updateAmbience() {
    const want = this.state === 'intro' || this.state === 'menu' || (!!this.net && !this.net.inGame);
    if (want !== this._ambience) {
      this._ambience = want;
      if (want) this.audio.startAmbience(); else this.audio.stopAmbience();
      document.body.classList.toggle('menu-active', want);
    }
    const inGame = this.net ? this.net.inGame : this.state === 'playing' || this.state === 'paused' || this.state === 'ready';
    const mapKind = inGame ? (this.map.id === 'vesper' ? 'harbor' : 'industrial') : null;
    if (mapKind !== this._mapAmbience) {
      this._mapAmbience = mapKind;
      if (mapKind) this.audio.startMapAmbience(mapKind); else this.audio.stopMapAmbience();
    }
  }

  update(dt) {
    const { player, weapon, input, smoke, enemies, ui, camera } = this;
    this.gameTime += dt;
    this.sessionTime += dt;

    player.update(dt, input, { lookEnabled: true, adsFactor: weapon.adsT, zoom: weapon.current.def.viewmodel.adsFovScale });
    const movement = player.getMovementState();
    const eye = player.getEyePosition(this._eye);
    camera.updateMatrixWorld();

    // habilidade
    if (input.pressedAction('ability')) {
      camera.getWorldDirection(this._dir);
      smoke.tryActivate(eye, this._dir, camera);
    }
    smoke.update(dt);

    // bots
    const ctx = this.enemyCtx;
    ctx.playerMovement = movement;
    ctx.playerSafe = this.map.isSafeZone(player.position.x, player.position.z);
    ctx.playerAlive = player.alive;
    ctx.time = this.gameTime;
    this._chest.set(player.position.x, player.position.y + player.height * 0.72, player.position.z);
    enemies.update(dt, ctx);
    if (this.state !== 'playing') return; // a sessão pode ter terminado durante a atualização

    // arma
    weapon.update(dt, input, { movement, lookDX: player._mouse.dx, lookDY: player._mouse.dy, canFire: player.alive });
    if (this.state !== 'playing') return;
    const fov = this.settings.fov * weapon.fovScale;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
      this.effects.setViewport(this.renderer.getDrawingBufferSize(this._size || (this._size = new THREE.Vector2())).y, fov);
    }

    this.effects.update(dt);
    this.map.update(dt, this.gameTime);
    this.updateAmmoStations(dt);

    // HUD (cada setter só toca no DOM se o valor mudou)
    ui.setTimer(this.sessionTime);
    ui.setHealth(player.health);
    ui.setMovementState(movement.state);
    ui.setZone(this.map.zoneAt(player.position.x, player.position.z));
    ui.setAbility(smoke.getStatus());
    ui.setReload(weapon.getReloadProgress(), weapon.reloading);
    this.updateCrosshair(movement, player.alive);
    ui.setSmoke(smoke.immersion(camera.position) * 0.92);
    ui.update(dt, (src) => relativeYaw(player.position, player.yaw + player.recoilYaw, src));
    this.updateMinimap(dt);
    this.audio.setListener(camera.position, player.yaw);
    input.endFrame();
  }

  updateAmmoStations(dt) {
    const cfg = CONFIG.ammoStation;
    for (const s of this.map.ammoStations) {
      if (s.cooldown > 0) { s.cooldown = Math.max(0, s.cooldown - dt); continue; }
      const dx = s.position.x - this.player.position.x, dz = s.position.z - this.player.position.z;
      if (dx * dx + dz * dz < cfg.radius * cfg.radius && this.weapon.refillReserve()) {
        s.cooldown = cfg.cooldown;
        this.audio.play('ammoPickup');
        this.ui.message('MUNIÇÃO REABASTECIDA', 'good', 1.4);
      }
    }
  }

  render(studio = false) {
    const r = this.renderer;
    r.clear();
    if (studio) { this.studio.render(); return; }
    r.render(this.scene, this.camera);
    const viewmodel = this.net ? this.net.inGame : (this.state === 'playing' || this.state === 'paused' || this.state === 'ready' || this.state === 'ended');
    if (viewmodel) {
      r.clearDepth();
      r.render(this.weapon.viewScene, this.weapon.viewCamera);
    }
  }

  // ---- testes automatizados (somente com ?debug na URL) -------------------
  debugForcePlay() {
    if (!this.debug) return;
    this.audio.init();
    this.setMap('foundry7');
    this.weapon.setLoadout(this.profile.primary);
    this.enemies.setVisible(true);
    this.setHeroVisible(false);
    this.resetSession();
    this.state = 'ready';
    this.ui.showScreen(null);
    this.ui.showHUD(true);
    this.startPlaying();
  }

  dispose() {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.unsubscribers?.forEach((u) => u());
    this.listeners?.forEach(([t, type, fn, opts]) => t.removeEventListener(type, fn, opts));
    this.input?.detach();
    this.settingsPanel?.dispose();
    this.weapon?.dispose();
    this.smoke?.dispose();
    this.enemies?.dispose();
    this.effects?.dispose();
    this.hero?.dispose();
    this.studio?.dispose();
    this.map?.dispose();
    this.audio?.dispose();
    this.renderer?.dispose();
  }
}

const game = new Game();
game.boot().catch((err) => {
  console.error('[OPERATION ZERO] falha na inicialização:', err);
  window.__OZ_BOOTED = true; // impede a mensagem genérica do vigia
  game.ui.showError(err && err.message ? err.message : String(err));
});
