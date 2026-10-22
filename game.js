// OPERATION ZERO — ponto de entrada. Inicializa renderer/cena/câmera, integra os
// módulos, controla estados (menu, pronto, jogando, pausado, encerrado) e o loop.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { EventBus, clamp, relativeYaw } from './utils.js';
import { GameMap } from './map.js';
import { Player, InputManager } from './player.js';
import { WeaponSystem } from './weapon.js';
import { SmokeAbility } from './abilities.js';
import { EnemyManager } from './enemies.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { OnlineMenu } from './online/lobby.js';
import { NetMatch } from './online/match.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function loadSettings() {
  const base = { ...CONFIG.defaultSettings };
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (raw) Object.assign(base, JSON.parse(raw));
  } catch { /* armazenamento indisponível: usa padrões */ }
  return base;
}

function saveSettings(s) {
  try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(s)); } catch { /* ignora */ }
}

class Game {
  constructor() {
    this.state = 'loading';
    this.canvas = document.getElementById('game-canvas');
    this.ui = new UI();
    this.events = new EventBus();
    this.settings = loadSettings();
    this.clock = { last: performance.now(), real: 0 };
    this.fps = { frames: 0, acc: 0 };
    this.stats = { kills: 0, shots: 0, hits: 0, headshots: 0, damageTaken: 0 };
    this.sessionTime = 0;
    this.gameTime = 0;
    this.settingsReturn = 'menu';
    this.debug = new URLSearchParams(location.search).has('debug');
    this._eye = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._chest = new THREE.Vector3();
    this._loop = this.loop.bind(this);
  }

  // ---- inicialização --------------------------------------------------------
  async boot() {
    const ui = this.ui;
    ui.setLoading('Inicializando WebGL…', 0.1);
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

    ui.setLoading('Construindo a arena FOUNDRY-7…', 0.3);
    await nextFrame();
    this.map = new GameMap(this.scene, { anisotropy: Math.min(8, r.capabilities.getMaxAnisotropy()) });
    this.map.build();
    this.scene.environment = this.map.createEnvironment(r);

    ui.setLoading('Calibrando sistemas de combate…', 0.6);
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

    this.wireEvents();
    this.onlineMenu = new OnlineMenu(this);
    this.net = null;
    const controlsCopy = document.getElementById('controls-copy');
    if (controlsCopy) controlsCopy.append(document.querySelector('.controls-card dl').cloneNode(true));
    this.bindDom();
    this.applySettings(this.settings, false);
    this.onResize();

    ui.setLoading('Compilando shaders…', 0.85);
    await nextFrame();
    this.resetSession();
    r.compile(this.scene, this.camera);
    r.compile(this.weapon.viewScene, this.weapon.viewCamera);

    ui.setLoading('Pronto', 1);
    window.__OZ_BOOTED = true;
    if (this.debug) window.__OZ = this;
    this.enterMenu();
    requestAnimationFrame(this._loop);
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
      ev.on('abilityDenied', ({ reason }) => ui.message(reason, 'warn', 1.4)),
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
    const form = this.ui.el.settingsForm;
    on(form, 'input', () => { this.ui.refreshSettingLabels(); this.applySettings(this.ui.readSettings(), true); });
    on(form, 'submit', (e) => e.preventDefault());
    on(document, 'pointerlockchange', () => this.onPointerLockChange());
    on(document, 'pointerlockerror', () => this.onPointerLockError());
    on(this.canvas, 'click', () => {
      if (this.state === 'ready' || (this.net && this.net.inGame && this.state !== 'playing' && !this.ui.currentScreen)) this.requestLock();
    });
    on(window, 'resize', () => this.onResize());
    on(window, 'keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'paused' && this.ui.currentScreen === 'pause') this.requestLock();
      if (e.code === 'Escape' && this.ui.currentScreen === 'settings') this.handleAction('settings-back');
    });
    on(document, 'visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    on(this.canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.state = 'error';
      this.ui.showHUD(false);
      this.ui.showError('O contexto WebGL foi perdido (driver/GPU). Recarregue a página para continuar.');
    });
    // Ctrl (agachar) + W fecha a aba em navegadores e não pode ser bloqueado; durante a sessão
    // pedimos confirmação antes de sair para evitar perda acidental da partida.
    on(window, 'beforeunload', (e) => {
      if (this.state === 'playing' || this.state === 'paused' || this.state === 'ready') { e.preventDefault(); e.returnValue = ''; }
    });
    on(window, 'pagehide', () => this.dispose());
  }

  // ---- estados -------------------------------------------------------------
  handleAction(action) {
    switch (action) {
      case 'play':
        this.audio.init();
        this.resetSession();
        this.enterReady();
        break;
      case 'resume':
        this.audio.init();
        this.requestLock();
        break;
      case 'restart':
        this.audio.init();
        this.resetSession();
        this.enterReady();
        break;
      case 'quit':
        this.enterMenu();
        break;
      case 'settings':
        this.settingsReturn = this.ui.currentScreen || 'menu';
        this.ui.fillSettings(this.settings);
        this.ui.showScreen('settings');
        break;
      case 'settings-back':
        this.ui.showScreen(this.settingsReturn);
        break;
      case 'settings-reset':
        this.applySettings({ ...CONFIG.defaultSettings }, true);
        this.ui.fillSettings(this.settings);
        break;
      case 'controls': this.ui.showScreen('controls'); break;
      case 'controls-back': this.ui.showScreen('menu'); break;
      // ---- multiplayer
      case 'online': this.audio.init(); this.onlineMenu.open(); break;
      case 'net-back': this.onlineMenu.close(); this.ui.showScreen('menu'); break;
      case 'net-quick': this.audio.init(); this.onlineMenu.quick(); break;
      case 'net-create': this.audio.init(); this.onlineMenu.create(); break;
      case 'net-join-code': this.audio.init(); this.onlineMenu.joinCode(); break;
      case 'net-refresh': this.onlineMenu.refreshRooms(); break;
      case 'net-cancel': this.onlineMenu.cancel(); break;
      case 'net-ready': this.net?.toggleReady(); break;
      case 'net-start': this.net?.requestStart(); break;
      case 'net-switch-team': this.net?.switchTeam(); break;
      case 'net-copy-code': this.copyRoomCode(); break;
      case 'net-leave':
      case 'net-abandon': this.leaveOnline(); break;
      default: break;
    }
  }

  /** Entra na sala online já conectada (lobby → partida). O modo offline fica intacto. */
  beginOnline(conn, room) {
    this.resetSession();
    this.state = 'online';
    this.input.enabled = false;
    this.input.reset();
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.net = new NetMatch(this, conn, room, this.onlineMenu);
    if (this.debug) window.__OZ_NET = this.net;
    this.ui.showScreen('lobby');
  }

  async leaveOnline(message = '') {
    const net = this.net;
    this.net = null;
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.enabled = false;
    this.input.reset();
    if (net) { net.dispose(); await net.conn.leave(); }
    this.resetSession();
    this.state = 'menu';
    this.ui.showHUD(false);
    this.ui.showLockPrompt(false);
    this.onlineMenu.open(message);
  }

  copyRoomCode() {
    const code = this.net?.state?.code;
    if (!code) return;
    const done = () => this.onlineMenu.el.lobbyStatus.textContent = `Código ${code} copiado. Envie para seus amigos.`;
    try { navigator.clipboard.writeText(code).then(done, done); } catch { done(); }
  }

  enterMenu() {
    this.state = 'menu';
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.enabled = false;
    this.input.reset();
    this.resetSession();
    this.ui.showHUD(false);
    this.ui.showLockPrompt(false);
    this.ui.showScreen('menu');
  }

  /** Sessão preparada; aguardando a captura do mouse para começar. */
  enterReady() {
    this.state = 'ready';
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
    document.getElementById('pause-hint').textContent = 'O combate, os bots e os temporizadores estão congelados.';
    if (first) this.ui.message(`OBJETIVO: ELIMINE ${CONFIG.session.targetKills} ALVOS HOSTIS`, 'info', 3);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.weapon.adsT = 0;
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

  // ---- configurações ---------------------------------------------------------
  applySettings(s, persist) {
    const prevQuality = this.settings.quality;
    this.settings = { ...this.settings, ...s };
    const st = this.settings;
    this.player.setSensitivity(st.sensitivity);
    this.audio.setVolume(st.volume);
    this.enemyCtx.fireBack = st.botsFireBack;
    this.ui.setFpsVisible(st.showFps);
    this.ui.setCrosshairColor(st.crosshairColor);
    const preset = CONFIG.graphics.presets[st.quality] || CONFIG.graphics.presets[CONFIG.graphics.defaultQuality];
    const shadowsChanged = this.renderer.shadowMap.enabled !== preset.shadows;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.map.setShadowQuality(preset.shadows, preset.shadowMapSize);
    if (shadowsChanged) this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    if (prevQuality !== st.quality || !this._pixelRatioSet) { this._pixelRatioSet = true; this.onResize(); }
    if (persist) saveSettings(st);
  }

  onResize() {
    if (!this.renderer) return;
    const preset = CONFIG.graphics.presets[this.settings.quality] || CONFIG.graphics.presets.medium;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weapon.setAspect(w / h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.effects.setViewport(size.y, this.camera.fov);
    this.viewportHeight = h;
  }

  // ---- loop -----------------------------------------------------------------
  loop(now) {
    if (this.state === 'disposed') return;
    requestAnimationFrame(this._loop);
    let dt = (now - this.clock.last) / 1000;
    this.clock.last = now;
    if (!(dt > 0)) dt = 0;
    this.clock.real += Math.min(dt, 0.25);
    dt = Math.min(dt, CONFIG.perf.maxDelta);   // evita saltos após travamentos ou ao retomar

    this.fps.frames++;
    this.fps.acc += (now - (this.fps.lastNow || now)) / 1000;
    this.fps.lastNow = now;
    if (this.fps.acc >= 0.5) {
      this.ui.setFps(Math.round(this.fps.frames / this.fps.acc));
      this.fps.frames = 0; this.fps.acc = 0;
    }

    if (this.net) this.net.frame(dt);
    else if (this.state === 'playing') this.update(dt);
    else if (this.state === 'menu') this.updateMenuCamera(dt);
    // testes automatizados (somente com ?debug) podem pular a renderização para rodar a lógica em tempo real
    if (!(this.debug && this.debugSkipRender)) this.render();
  }

  update(dt) {
    const { player, weapon, input, smoke, enemies, ui, camera } = this;
    this.gameTime += dt;
    this.sessionTime += dt;

    player.update(dt, input, { lookEnabled: true, adsFactor: weapon.adsT });
    const movement = player.getMovementState();
    const eye = player.getEyePosition(this._eye);
    camera.updateMatrixWorld();

    // habilidade
    if (input.wasPressed(CONFIG.abilities.smoke.key)) {
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
    const spread = weapon.currentSpread;
    const gap = (Math.tan(spread) / Math.tan((camera.fov * Math.PI) / 360)) * (this.viewportHeight / 2);
    ui.setCrosshairGap(4 + gap);
    ui.setCrosshairVisible(weapon.adsT < 0.6 || weapon.current.def.id !== 'rifle');
    ui.setSmoke(smoke.immersion(camera.position) * 0.92);
    ui.update(dt, (src) => relativeYaw(player.position, player.yaw + player.recoilYaw, src));
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

  updateMenuCamera(dt) {
    const t = this.clock.real * 0.045;
    const cam = this.camera;
    cam.position.set(Math.sin(t) * 15, 7.0 + Math.sin(t * 0.7) * 0.5, -9 + Math.cos(t) * 25);
    cam.lookAt(Math.sin(t + 0.8) * 3, 2.2, -18);
    if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
    this.map.update(dt, this.clock.real);
    this.effects.update(dt);
  }

  render() {
    const r = this.renderer;
    r.clear();
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
    this.weapon?.dispose();
    this.smoke?.dispose();
    this.enemies?.dispose();
    this.effects?.dispose();
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
