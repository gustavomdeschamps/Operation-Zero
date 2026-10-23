// Controlador da partida online no cliente.
//
// - Entrada em passo fixo (1/60 s): cada quadro enviado corresponde a um passo simulado
//   localmente (predição) e, depois, pelo servidor (autoridade).
// - Reconciliação: a cada patch, o estado do próprio jogador volta ao valor oficial e as
//   entradas ainda não confirmadas são reaplicadas; pequenas diferenças são suavizadas na
//   câmera, grandes (teleporte/estado inválido) são corrigidas na hora.
// - Jogadores remotos: interpolação de snapshots no tempo do servidor (atraso fixo).
// - Combate: o cliente só mostra efeitos imediatos; dano, eliminações, munição oficial e
//   placar vêm do servidor.
import * as THREE from 'three';
import { GAME } from '../shared/game-config.js';
import { BTN, MSG, CMSG, PHASE, TEAM, TEAM_LABELS, MODE_LABELS, PHASE_LABELS, SPIKE, REASON_LABELS, NOTICE_TYPES } from '../shared/protocol.js';
import { stepMovement, createCommand } from '../shared/movement.js';
import { rayVsPlayer } from '../shared/hitboxes.js';
import { smokeCenter, smokeBlocksSegment, smokeImmersion } from '../shared/smoke-rules.js';
import { wrapAngle, clamp, damp, relativeYaw } from '../utils.js';
import { AvatarManager } from './avatars.js';
import { SpikeVisual } from './spike.js';
import { decodeEquipped } from '../shared/skins.js';

const DT = 1 / GAME.net.tickRate;
const STEP_MS = 1000 / GAME.net.tickRate;
const fround = Math.fround;
const IN_GAME = new Set([PHASE.LIVE, PHASE.ROUND_PREP, PHASE.ROUND_LIVE, PHASE.ROUND_END]);
const COMBAT = new Set([PHASE.LIVE, PHASE.ROUND_LIVE]);
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class NetMatch {
  constructor(game, conn, room, menu) {
    this.game = game;
    this.conn = conn;
    this.room = room;
    this.menu = menu;
    this.sid = room.sessionId;
    this.input = conn.input;
    this.acc = 0;
    this.latch = new Set();
    this.pendingShot = null;
    this.spawnSeq = -1;
    this.offset = new THREE.Vector3();
    this.forceSnap = true;
    this.cmd = createCommand();
    this.replayCmd = createCommand();
    this.lastStateAt = performance.now();
    this.pingTimer = 0;
    this.ping = 0;
    this.lobbyTimer = 0;
    this.deathT = 0;
    this.lastPhase = '';
    this.connection = 'connected';
    this.disposed = false;
    this.stats = { corrections: 0, snaps: 0, maxError: 0, rejects: 0 };
    this.avatars = new AvatarManager(game.scene);
    this.spike = new SpikeVisual(game.scene);
    const $ = (id) => document.getElementById(id);
    this.el = {
      hudNet: $('hud-net'), score1: $('net-score-1'), score2: $('net-score-2'), phase: $('net-phase'), timer: $('net-timer'), round: $('net-round'),
      clock: document.querySelector('.net-clock'), status: $('net-status'), ping: $('net-ping'), teamTag: $('net-team-tag'),
      objBar: $('objective-bar'), objLabel: $('objective-label'), objFill: $('objective-fill'),
      death: $('death-overlay'), deathDetail: $('death-detail'), banner: $('round-banner'), bannerTitle: $('round-banner-title'), bannerText: $('round-banner-text'),
      kd: $('net-kd'), scoreboard: $('scoreboard'), sb1: $('sb-team-1'), sb2: $('sb-team-2'), sbScore1: $('sb-score-1'), sbScore2: $('sb-score-2'),
      overlay: $('net-overlay'), overlayTitle: $('net-overlay-title'), overlayText: $('net-overlay-text'),
    };
    this.bannerT = 0;
    this.cache = {};
    this.tickInput = this.createTickInput();
    this.start();
  }

  // ---- ciclo de vida ------------------------------------------------------------
  start() {
    const g = this.game;
    document.body.classList.add('online-mode');
    g.enemies.group.visible = false;
    g.weapon.reset();
    g.weapon.shotResolver = (origin, dir, def, end) => this.resolveLocalShot(origin, dir, def, end);
    g.smoke.reset();
    g.smoke.netMode = true;
    g.effects.clear();
    g.ui.reset();
    this.el.hudNet.classList.remove('hidden');
    this.el.status.classList.remove('hidden');
    const room = this.room;
    room.onStateChange(() => this.onState());
    room.onMessage(MSG.SHOT, (m) => this.onShot(m));
    room.onMessage(MSG.HIT, (m) => this.onHit(m));
    room.onMessage(MSG.DAMAGED, (m) => this.onDamaged(m));
    room.onMessage(MSG.KILL, (m) => this.onKill(m));
    room.onMessage(MSG.NOTICE, (m) => this.onNotice(m));
    room.onMessage(MSG.REJECT, (m) => this.onReject(m));
    room.onMessage(MSG.ROUND, (m) => this.onRound(m));
    room.onMessage(MSG.ABILITY, (m) => this.onAbility(m));
    room.onMessage(MSG.REWARD, (m) => { this.reward = m; this.game.account.applyReward(m); this.lobbyTimer = 0; });
    room.onDrop((code) => this.setConnection('reconnecting', code));
    room.onReconnect(() => { this.setConnection('connected'); this.forceSnap = true; });
    room.onLeave((code) => { if (!this.disposed) this.onConnectionLost(code); });
    room.onError((code, message) => this.game.ui.killfeed(`ERRO DE REDE ${code}: ${message || ''}`, 'info'));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const g = this.game;
    document.body.classList.remove('online-mode');
    this.avatars.dispose();
    this.spike.dispose();
    g.enemies.group.visible = true;
    g.weapon.shotResolver = (origin, dir, def, end) => g.weapon.resolveOffline(origin, dir, def, end);
    g.smoke.reset();
    g.map.setSitesVisible(false);
    for (const k of ['hudNet', 'status', 'objBar', 'death', 'banner', 'scoreboard', 'overlay']) this.el[k].classList.add('hidden');
    g.weapon.current.model.root.visible = true;
  }

  get state() { return this.room.state; }
  get me() { return this.room.state && this.room.state.players ? this.room.state.players.get(this.sid) : null; }
  get phase() { return this.state ? this.state.phase : PHASE.LOBBY; }
  get inGame() { return IN_GAME.has(this.phase) || (this.phase === PHASE.COUNTDOWN && this.me && this.me.alive); }

  // ---- entradas ------------------------------------------------------------------
  /** Adaptador de entrada para a lógica de arma em passo fixo (bordas consumidas por tick). */
  createTickInput() {
    const input = this.game.input;
    const self = this;
    return {
      down: (a) => input.down(a),
      pressedAction: (a) => self.tickEdges.has(a),
      isButtonDown: (b) => input.isButtonDown(b),
      wasButtonPressed: (b) => input.wasButtonPressed(b),
    };
  }

  latchEdges() {
    const input = this.game.input;
    for (const action of ['jump', 'reload', 'ability', 'primary', 'secondary']) if (input.pressedAction(action)) this.latch.add(action);
  }

  // ---- quadro de renderização ----------------------------------------------------
  frame(dt) {
    const g = this.game;
    const me = this.me;
    if (!me) { g.updateMenuCamera(dt); return; }
    const playing = g.state === 'playing';
    this.updateScreens(dt);
    if (playing) { g.player.look(g.input, g.weapon.adsT, g.weapon.current.def.viewmodel.adsFovScale); this.latchEdges(); }
    else g.input.consumeMouse({ dx: 0, dy: 0 });

    // passos fixos de simulação/envio (limitado a 250 ms para não acumular após travamentos;
    // o loop do jogo limita dt a 50 ms, então quadros lentos usam o tempo real acumulado)
    this.acc = Math.min(this.acc + this.realDt() * 1000, STEP_MS * 15);
    let ticks = 0;
    while (this.acc >= STEP_MS) { this.acc -= STEP_MS; this.tick(playing); ticks++; }
    if (ticks > 0 || !playing) g.input.endFrame();

    // câmera, arma, efeitos
    this.offset.x = damp(this.offset.x, 0, 12, dt); this.offset.y = damp(this.offset.y, 0, 12, dt); this.offset.z = damp(this.offset.z, 0, 12, dt);
    if (this.inGame && me.alive) {
      this.deathT = 0;
      g.player.updateCamera(dt, this.offset.x, this.offset.y, this.offset.z);
      g.weapon.current.model.root.visible = true;
      g.weapon.animate(dt, g.player._mouse.dx, g.player._mouse.dy);
    } else if (this.inGame) {
      this.deathCamera(dt);
      g.weapon.current.model.root.visible = false;
    } else {
      g.updateMenuCamera(dt);
    }
    const fov = g.settings.fov * (me.alive ? g.weapon.fovScale : 1);
    if (this.inGame && Math.abs(g.camera.fov - fov) > 0.01) { g.camera.fov = fov; g.camera.updateProjectionMatrix(); }

    this.syncAvatars();
    const clock = this.room.clock;
    const renderT = clock.renderNow() - clock.smoothedRtt() / 2 - GAME.net.interpDelayMs;
    g.camera.updateMatrixWorld();
    g.camera.getWorldDirection(_fwd);
    this.avatars.update(dt, renderT, {
      eye: g.camera.position, forward: _fwd, myTeam: me.team, map: g.map,
      smokeBlocked: (a, b) => smokeBlocksSegment(this.smokeCenters, a, b),
    });
    this.syncSmokes();
    const st = this.state;
    this.spike.update(dt, st.spike, Math.max(0, st.spike.timer - (performance.now() - this.lastStateAt) / 1000), g.audio);
    g.smoke.update(dt);
    g.effects.update(dt);
    g.map.update(dt, g.clock.real);
    this.updateHud(dt);
    this.audioListener();

    this.pingTimer -= dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 2;
      this.ping = clock.smoothedRtt() || clock.rtt() || 0;
      this.conn.reportPing(this.ping);
    }
  }

  /** Tempo real desde o último quadro (o dt do jogo é limitado e subestimaria quadros lentos). */
  realDt() {
    const now = performance.now();
    const d = this.lastFrameAt ? (now - this.lastFrameAt) / 1000 : 0;
    this.lastFrameAt = now;
    return Math.min(d, 0.25);
  }

  /** Um passo fixo: lê o comando, prevê localmente e envia o quadro ao servidor. */
  tick(playing) {
    const g = this.game;
    const me = this.me;
    const p = g.player;
    const w = g.weapon;
    const input = g.input;
    this.tickEdges = this.latch;
    this.latch = new Set();
    const alive = me.alive && this.inGame;
    const canMove = alive && this.phase !== PHASE.ROUND_PREP;
    const canAct = playing && alive && COMBAT.has(this.phase);

    // visão quantizada exatamente como o servidor a recebe (float32, ângulo normalizado)
    const viewYaw = fround(wrapAngle(p.yaw + p.recoilYaw));
    const viewPitch = fround(clamp(p.pitch + p.recoilPitch, -GAME.pitchLimit, GAME.pitchLimit));
    const adsHeld = canAct && input.isButtonDown(2) && !w.reloading && !w.switching;
    const c = this.cmd;
    c.f = playing && canMove ? (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0) : 0;
    c.r = playing && canMove ? (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0) : 0;
    c.jump = playing && canMove && this.tickEdges.has('jump');
    c.crouch = playing && alive && input.down('crouch');
    c.walk = playing && input.down('walk');
    c.ads = adsHeld ? 1 : 0;
    c.yaw = viewYaw;

    if (alive) p.simulate(c, DT);
    // lógica da arma no mesmo passo (cadência/recarga em tempo de simulação, como no servidor)
    this.pendingShot = null;
    w.update(DT, playing ? this.tickInput : NO_INPUT, { movement: p.getMovementState(), canFire: canAct, animate: false });

    const d = this.input.data;
    d.mf = c.f; d.mr = c.r;
    let btn = 0;
    if (c.jump) btn |= BTN.JUMP;
    if (c.crouch) btn |= BTN.CROUCH;
    if (c.walk) btn |= BTN.WALK;
    if (c.ads) btn |= BTN.ADS;
    if (this.pendingShot) btn |= BTN.FIRE;
    if (playing && alive && this.tickEdges.has('reload')) btn |= BTN.RELOAD;
    if (canAct && this.tickEdges.has('ability')) btn |= BTN.ABILITY;
    if (playing && alive && input.down('interact')) btn |= BTN.INTERACT;
    d.btn = btn;
    d.yaw = viewYaw;
    d.pitch = viewPitch;
    d.slot = w.switching ? w.weapons[w.switchTarget].def.slot : w.current.def.slot;
    if (this.pendingShot) { d.dx = this.pendingShot.x; d.dy = this.pendingShot.y; d.dz = this.pendingShot.z; }
    this.input.send();
  }

  /** Disparo local: efeitos imediatos; o resultado oficial chega do servidor. */
  resolveLocalShot(origin, dir, def, end) {
    const g = this.game;
    this.pendingShot = { x: dir.x, y: dir.y, z: dir.z };
    // origem oficial: olho simulado (sem balanço de câmera)
    const eye = g.player.getEyePosition(_v);
    const world = g.map.raycast(eye, dir, def.range, this._worldOut || (this._worldOut = {}));
    let best = world ? world.distance : def.range;
    let hitAvatar = null;
    for (const a of this.avatars.avatars.values()) {
      if (!a.alive || !a.root.visible || a.team === this.me.team) continue;
      const h = rayVsPlayer(eye, dir, best, a.pos.x, a.pos.y, a.pos.z, a.h, a.pose());
      if (h && h.t < best) { best = h.t; hitAvatar = a; }
    }
    end.copy(eye).addScaledVector(dir, best);
    if (hitAvatar) g.effects.enemyHit(end, _v.copy(dir).negate(), false);
    else if (world) {
      g.effects.impact(world.point, world.normal, world.surface);
      g.audio.play('impact', { at: world.point, surface: world.surface });
    }
    return { hit: false };
  }

  // ---- estado oficial -----------------------------------------------------------
  onState() {
    this.lastStateAt = performance.now();
    const me = this.me;
    if (!me) return;
    // o mapa da sala é decidido pelo servidor: todos os jogadores carregam o mesmo
    if (this.state.map && this.state.map !== this.game.map.id) { this.game.setMap(this.state.map); this.forceSnap = true; }
    this.recordSnapshots();
    this.reconcile(me);
    this.syncWeapon(me);
    const g = this.game;
    g.player.health = me.hp;
    g.player.alive = me.alive;
    if (this.phase !== this.lastPhase) this.onPhaseChange(this.lastPhase, this.phase);
  }

  recordSnapshots() {
    const clock = this.room.clock;
    const t = clock.lastServerTime() || clock.serverNow();
    this.state.players.forEach((p, sid) => {
      if (sid === this.sid) return;
      const a = this.avatars.ensure(sid, p.team, p.name, p.operator);
      a.push(t, p, p.spawnSeq);
    });
  }

  reconcile(me) {
    const p = this.game.player;
    const m = p.move;
    const snap = this.forceSnap || me.spawnSeq !== this.spawnSeq;
    if (me.spawnSeq !== this.spawnSeq) {
      // novo surgimento: câmera e arma reiniciam na posição oficial
      this.spawnSeq = me.spawnSeq;
      p.yaw = me.yaw; p.pitch = 0; p.recoilPitch = 0; p.recoilYaw = 0;
      this.game.weapon.reset();
    }
    this.forceSnap = false;
    const bx = m.pos.x, by = m.pos.y, bz = m.pos.z;
    m.pos.set(me.x, me.y, me.z);
    m.vel.set(me.vx, me.vy, me.vz);
    m.height = me.h; m.crouching = me.crouch; m.onGround = me.ground; m.coyoteT = me.coyote; m.jumpBufferT = me.jbuf;
    const acked = this.input.lastProcessed;
    const sent = this.input.sentCount;
    if (me.alive) {
      const arena = this.game.map.collision;
      const canMove = this.phase !== PHASE.ROUND_PREP;
      const rc = this.replayCmd;
      for (let seq = acked + 1; seq <= sent; seq++) {
        const f = this.input.at(seq);
        if (!f) continue;
        rc.f = canMove ? f.mf : 0; rc.r = canMove ? f.mr : 0;
        rc.jump = canMove && (f.btn & BTN.JUMP) !== 0;
        rc.crouch = (f.btn & BTN.CROUCH) !== 0; rc.walk = (f.btn & BTN.WALK) !== 0;
        rc.ads = (f.btn & BTN.ADS) !== 0 ? 1 : 0; rc.yaw = f.yaw;
        stepMovement(m, rc, DT, arena);
      }
    }
    const err = Math.hypot(bx - m.pos.x, by - m.pos.y, bz - m.pos.z);
    this.stats.maxError = Math.max(this.stats.maxError, err);
    if (snap || err > GAME.net.snapDistance) {
      if (!snap) this.stats.snaps++;
      this.offset.set(0, 0, 0);
    } else if (err > 1e-4) {
      // correção suave: a câmera parte da posição prevista anterior e converge
      this.stats.corrections++;
      this.offset.x += bx - m.pos.x; this.offset.y += by - m.pos.y; this.offset.z += bz - m.pos.z;
    }
  }

  /** Munição oficial: aplicada quando não há disparo/recarga/troca local aguardando confirmação. */
  syncWeapon(me) {
    const w = this.game.weapon;
    // kit confirmado pelo servidor (a arma primária muda só no surgimento)
    w.setSkins(decodeEquipped(me.skins));
    if (me.primary && me.primary !== w.primaryId) { w.setLoadout(me.primary); w.emitAmmo(); }
    const acked = this.input.lastProcessed, sent = this.input.sentCount;
    for (let seq = acked + 1; seq <= sent; seq++) {
      const f = this.input.at(seq);
      if (f && ((f.btn & (BTN.FIRE | BTN.RELOAD)) || f.slot !== me.slot)) return;
    }
    if (w.switching) return;
    const cur = w.current;
    if (cur.def.slot !== me.slot) {
      const idx = w.weapons.findIndex((x) => x.def.slot === me.slot);
      if (idx >= 0) { cur.model.root.visible = false; w.index = idx; w.current.model.root.visible = true; }
    }
    const wc = w.current;
    if (wc.mag !== me.mag || wc.reserve !== me.reserve) {
      wc.mag = me.mag; wc.reserve = me.reserve;
      w.emitAmmo();
    }
    if (me.reloading && !w.reloading) w.startReload();
  }

  onPhaseChange(from, to) {
    this.lastPhase = to;
    const g = this.game;
    g.map.setSitesVisible(this.state.mode === 'tactical');
    if (to === PHASE.COUNTDOWN) this.banner('PARTIDA INICIANDO', MODE_LABELS[this.state.mode], 3);
    if (to === PHASE.LIVE) this.banner('COMBATE INICIADO', `${this.state.scoreLimit} eliminações para vencer`, 2.5);
    if (to === PHASE.ROUND_PREP) {
      const att = this.me && this.me.team === this.state.attackers;
      this.banner(`RODADA ${this.state.round}`, att ? 'ATAQUE — instale o dispositivo em A ou B' : 'DEFESA — proteja os objetivos A e B', 3);
    }
    if (to === PHASE.ROUND_LIVE) this.banner('VALENDO', '', 1.2);
    if (to === PHASE.COUNTDOWN) this.reward = null;
    if (to === PHASE.LOBBY && this.readyAgain) { this.readyAgain = false; this.room.send(CMSG.READY, { ready: true }); }
    if (to === PHASE.ENDED || to === PHASE.LOBBY) {
      if (document.pointerLockElement) document.exitPointerLock();
      g.state = 'online';
      g.input.enabled = false;
    }
    if (IN_GAME.has(to) && !IN_GAME.has(from)) this.enterGameView();
  }

  enterGameView() {
    const g = this.game;
    g.menu.exitLobbyOverlay();
    g.ui.showScreen(null);
    g.ui.showHUD(true);
    if (g.state !== 'playing') g.ui.showLockPrompt(true, 'CLIQUE PARA ENTRAR NA PARTIDA');
  }

  // ---- telas conforme a fase -----------------------------------------------------
  updateScreens(dt) {
    const g = this.game;
    const st = this.state;
    if (this.connection !== 'connected') return;
    if (st.phase === PHASE.LOBBY || (st.phase === PHASE.COUNTDOWN && !(this.me && this.me.alive))) {
      this.lobbyTimer -= dt;
      const allowed = g.ui.currentScreen === 'lobby' || g.ui.currentScreen === 'settings' || g.ui.currentScreen === 'controls' || (g.ui.currentScreen === 'menu' && g.menu.fromLobby);
      if (!allowed) {
        g.ui.showScreen('lobby');
        g.ui.showHUD(false);
        g.ui.showLockPrompt(false);
      }
      if (this.lobbyTimer <= 0) { this.lobbyTimer = 0.2; this.menu.renderLobby(st, this.sid, this.ping); }
    } else if (st.phase === PHASE.ENDED) {
      if (g.ui.currentScreen !== 'net-end') { g.ui.showScreen('net-end'); g.ui.showHUD(false); g.ui.showLockPrompt(false); }
      this.lobbyTimer -= dt;
      if (this.lobbyTimer <= 0) { this.lobbyTimer = 0.25; this.menu.renderEnd(st, this.sid, this.reward, this.readyAgain); }
    } else if (g.ui.currentScreen === 'lobby' || g.ui.currentScreen === 'net-end') {
      this.enterGameView();
    }
  }

  deathCamera(dt) {
    const g = this.game;
    const p = g.player;
    this.deathT += dt;
    const k = Math.min(1, this.deathT / 1.2);
    g.camera.position.set(p.position.x, p.position.y + 0.6 + k * 2.6, p.position.z + k * 1.8);
    g.camera.rotation.set(-0.35 - k * 0.6, p.yaw, 0);
  }

  // ---- avatares e fumaças -------------------------------------------------------
  syncAvatars() {
    const players = this.state.players;
    for (const [sid, a] of this.avatars.avatars) {
      const p = players.get(sid);
      if (!p) { this.avatars.remove(sid); continue; }
      a.setTeam(p.team);
      a.setName(p.name);
      a.setOperator(p.operator);
      a.setSkins(p.skins);
      a.setWeaponState(p.slot === 2 ? 'pistol' : p.primary, p.reloading);
      if (a.alive && !p.alive) this.game.audio.play('kill', { at: a.pos });
      a.alive = p.alive && IN_GAME.has(this.phase);
      a.connected = p.connected;
    }
  }

  syncSmokes() {
    const g = this.game;
    this.smokeCenters = [];
    const ids = new Set();
    this.state.smokes.forEach((s, id) => {
      ids.add(id);
      g.smoke.spawnNetSmoke(id, s.x, s.y, s.z, s.remaining);
      this.smokeCenters.push(smokeCenter(s));
    });
    for (const c of g.smoke.clouds) if (c.active && c.netId && !ids.has(c.netId)) g.smoke.removeNetSmoke(c.netId);
  }

  // ---- mensagens do servidor -------------------------------------------------------
  onShot(m) {
    const g = this.game;
    const a = this.avatars.avatars.get(m.s);
    const end = _v.set(m.e[0], m.e[1], m.e[2]);
    const from = a && a.root.visible ? a.getMuzzleWorld(new THREE.Vector3()) : new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
    if (a) a.fire();
    g.effects.tracer(from, end, 'enemy');
    const sp = this.state.players.get(m.s);
    g.audio.play(sp && sp.slot === 1 && sp.primary === 'sniper' ? 'remoteSniperShot' : 'enemyShot', { at: from });
    if (m.k === 0) {
      _dir.set(m.e[0] - m.o[0], m.e[1] - m.o[1], m.e[2] - m.o[2]).normalize();
      const hit = g.map.raycast(new THREE.Vector3(m.o[0], m.o[1], m.o[2]), _dir, 200, {});
      if (hit) g.effects.impact(hit.point, hit.normal, hit.surface);
    } else if (m.k === 1) {
      g.effects.enemyHit(end, _dir.set(m.o[0] - m.e[0], m.o[1] - m.e[1], m.o[2] - m.e[2]).normalize(), false);
    }
  }

  onHit(m) {
    const g = this.game;
    g.ui.hitmarker(m.k ? 'kill' : m.z === 'head' ? 'head' : 'body');
    g.audio.play(m.z === 'head' ? 'hitHead' : 'hitBody');
    const a = this.avatars.avatars.get(m.t);
    if (a) a.hit();
  }

  onDamaged(m) {
    const g = this.game;
    g.ui.damage({ x: m.x, y: m.y, z: m.z }, m.d);
    g.audio.play('hurt');
  }

  onKill(m) {
    const g = this.game;
    const mine = m.k === this.sid;
    const victimMe = m.v === this.sid;
    const text = m.k && m.k !== m.v ? `${m.kn}  ▸  ${m.vn}` : `${m.vn} ELIMINADO`;
    g.ui.killfeed(text, m.hs ? 'head' : mine || victimMe ? 'kill' : 'info');
    if (mine) g.audio.play('kill');
    if (victimMe) this.killedBy = m.kn || '';
  }

  onNotice(m) {
    const g = this.game;
    const labels = {
      [NOTICE_TYPES.JOIN]: `${m.n} ENTROU`, [NOTICE_TYPES.LEAVE]: `${m.n} SAIU`, [NOTICE_TYPES.DROP]: `${m.n} PERDEU A CONEXÃO`,
      [NOTICE_TYPES.RECONNECT]: `${m.n} RECONECTOU`, [NOTICE_TYPES.HOST]: `${m.n} AGORA É O ANFITRIÃO`,
    };
    if (m.t === 'ammo') { g.ui.message(m.m, 'good', 1.4); g.audio.play('ammoPickup'); return; }
    g.ui.killfeed(labels[m.t] || m.m, 'info');
    if (m.t === NOTICE_TYPES.INFO && m.m) g.ui.message(m.m, 'warn', 2.5);
  }

  onReject(m) {
    this.stats.rejects++;
    const g = this.game;
    if (m.a === 'ability' || m.a === 'start' || m.a === 'team') {
      g.ui.message(m.r.toUpperCase(), 'warn', 1.6);
      if (g.ui.currentScreen === 'lobby') this.menu.el.lobbyStatus.textContent = m.r;
    }
  }

  onRound(m) {
    const reason = REASON_LABELS[m.r] || '';
    this.banner(`RODADA ${m.n}: ${TEAM_LABELS[m.w]}`, reason, 3.5, m.w);
    this.game.audio.play(this.me && this.me.team === m.w ? 'victory' : 'defeat');
  }

  onAbility(m) {
    this.game.smoke.throwVisual(m.f, m.t);
    this.game.audio.play('smokeThrow', { at: { x: m.f[0], y: m.f[1], z: m.f[2] } });
  }

  // ---- conexão -------------------------------------------------------------------
  setConnection(status, code) {
    this.connection = status;
    const o = this.el.overlay;
    if (status === 'connected') { o.classList.add('hidden'); this.game.ui.killfeed('CONEXÃO RESTABELECIDA', 'info'); return; }
    this.el.overlayTitle.textContent = 'RECONECTANDO';
    this.el.overlayText.textContent = `A conexão com o servidor caiu${code ? ` (código ${code})` : ''}. Tentando recuperar sua vaga na partida…`;
    o.classList.remove('hidden');
  }

  onConnectionLost(code) {
    this.connection = 'lost';
    const o = this.el.overlay;
    this.el.overlayTitle.textContent = code === 4000 || code === 1000 ? 'SALA ENCERRADA' : 'CONEXÃO PERDIDA';
    this.el.overlayText.textContent = code === 4000 || code === 1000
      ? 'A sala foi encerrada pelo servidor.'
      : `Não foi possível reconectar (código ${code}). Sua participação nesta partida terminou.`;
    o.querySelector('.spinner').style.display = 'none';
    o.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---- HUD ------------------------------------------------------------------------
  banner(title, text, seconds, team = 0) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerText.textContent = text;
    this.el.banner.className = team === TEAM.ALFA ? 'alfa' : team === TEAM.OMEGA ? 'omega' : '';
    this.bannerT = seconds;
  }

  set(key, fn, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  updateHud(dt) {
    const g = this.game;
    const ui = g.ui;
    const st = this.state;
    const me = this.me;
    const tactical = st.mode === 'tactical';
    const timeLeft = Math.max(0, st.timeLeft - (performance.now() - this.lastStateAt) / 1000);
    const planted = st.spike.state === SPIKE.PLANTED || st.spike.state === SPIKE.DEFUSING;
    this.set('s1', (v) => { this.el.score1.textContent = v; }, String(st.scoreAlfa));
    this.set('s2', (v) => { this.el.score2.textContent = v; }, String(st.scoreOmega));
    this.set('timer', (v) => { this.el.timer.textContent = v; }, `${Math.floor(timeLeft / 60)}:${String(Math.floor(timeLeft % 60)).padStart(2, '0')}`);
    this.set('phase', (v) => { this.el.phase.textContent = v; }, planted ? 'DISPOSITIVO ATIVO' : PHASE_LABELS[st.phase] || '');
    this.set('round', (v) => { this.el.round.textContent = v; }, tactical ? `RODADA ${st.round} · MELHOR DE ${st.roundsToWin * 2 - 1}` : `LIMITE ${st.scoreLimit}`);
    this.set('planted', (v) => this.el.clock.classList.toggle('planted', v), planted);
    // latência numérica só se o jogador quiser (o ponto de conexão fica sempre visível)
    this.set('ping', (v) => { this.el.ping.textContent = v; this.el.ping.hidden = !v; }, this.game.settings.showPing ? `${Math.round(this.ping)} ms` : '');
    const quality = this.ping > 180 || this.connection !== 'connected' ? 'bad' : this.ping > 100 ? 'warn' : '';
    this.set('quality', (v) => { this.el.status.className = v; }, quality);
    this.set('team', (v) => { this.el.teamTag.textContent = TEAM_LABELS[v]; this.el.teamTag.className = `team-tag ${v === TEAM.ALFA ? 'alfa' : 'omega'}`; }, me.team);
    // objetivo
    let objective;
    if (tactical) {
      const attacking = me.team === st.attackers;
      if (planted) objective = attacking ? 'Defenda o dispositivo até a detonação' : 'Desarme o dispositivo [F segurado]';
      else objective = attacking ? 'Instale o dispositivo em A ou B [F segurado]' : 'Defenda os objetivos A e B';
    } else objective = `Equipe ${TEAM_LABELS[me.team]}: ${st.scoreLimit} eliminações para vencer`;
    ui.setObjective(objective);
    ui.setZone(g.map.zoneAt(g.player.position.x, g.player.position.z));
    // ação de objetivo
    const acting = st.spike.actor === this.sid && me.action > 0;
    this.set('objBar', (v) => this.el.objBar.classList.toggle('hidden', !v), acting);
    if (acting) {
      this.el.objLabel.textContent = me.action === 1 ? 'INSTALANDO' : 'DESARMANDO';
      this.el.objFill.style.transform = `scaleX(${st.spike.progress.toFixed(3)})`;
    }
    // eliminado
    const dead = this.inGame && !me.alive;
    this.set('dead', (v) => this.el.death.classList.toggle('hidden', !v), dead);
    if (dead) {
      const by = this.killedBy ? `Eliminado por ${this.killedBy} · ` : '';
      this.el.deathDetail.textContent = tactical ? `${by}aguarde a próxima rodada` : `${by}retorno em ${Math.max(0, me.respawnIn).toFixed(1)} s`;
    }
    if (!dead) this.killedBy = '';
    // faixa de rodada
    if (this.bannerT > 0) this.bannerT -= dt;
    this.set('banner', (v) => this.el.banner.classList.toggle('hidden', !v), this.bannerT > 0);
    // placar (Tab)
    const showBoard = g.state === 'playing' && g.input.down('scoreboard');
    this.set('board', (v) => this.el.scoreboard.classList.toggle('hidden', !v), showBoard);
    if (showBoard) this.renderScoreboard();
    // vida, estado, habilidade, mira (valores oficiais do servidor)
    ui.setHealth(me.hp);
    ui.setMovementState(g.player.getMovementState().state);
    const cd = me.abilityCd;
    ui.setAbility({ ready: cd <= 0 && me.alive, cooldown: cd, cooldownFrac: clamp(cd / GAME.abilities.smoke.cooldown, 0, 1), activeRemaining: 0 });
    ui.setReload(g.weapon.getReloadProgress(), g.weapon.reloading);
    g.updateCrosshair(g.player.getMovementState(), me.alive);
    this.set('kd', (v) => { this.el.kd.textContent = v; }, `${me.kills} E · ${me.deaths} M`);
    // minimapa: você e ALIADOS apenas (posições inimigas nunca são desenhadas)
    const allies = this._allies || (this._allies = []);
    allies.length = 0;
    for (const a of this.avatars.avatars.values()) if (a.team === me.team && a.connected) allies.push({ x: a.pos.x, z: a.pos.z, yaw: a.yaw, alive: a.alive });
    const spike = st.spike;
    g.updateMinimap(dt, allies, { spike: { x: spike.x, z: spike.z, active: planted } });
    let imm = 0;
    for (const c of this.smokeCenters || []) imm = Math.max(imm, smokeImmersion(c, g.camera.position));
    ui.setSmoke(Math.min(1, imm * 1.8) * 0.92);
    ui.update(dt, (src) => relativeYaw(g.player.position, g.player.yaw + g.player.recoilYaw, src));
  }

  renderScoreboard() {
    const st = this.state;
    const rows = { [TEAM.ALFA]: [], [TEAM.OMEGA]: [] };
    [...st.players.entries()].sort((a, b) => b[1].score - a[1].score).forEach(([sid, p]) => {
      const tr = document.createElement('tr');
      tr.className = `${sid === this.sid ? 'me' : ''} ${p.alive ? '' : 'dead'}`;
      [p.name + (p.connected ? '' : ' (offline)'), p.kills, p.deaths, p.score, p.bot ? 'BOT' : p.ping].forEach((v) => { const td = document.createElement('td'); td.textContent = String(v); tr.append(td); });
      (rows[p.team] || rows[TEAM.ALFA]).push(tr);
    });
    this.el.sb1.replaceChildren(...rows[TEAM.ALFA]);
    this.el.sb2.replaceChildren(...rows[TEAM.OMEGA]);
    this.el.sbScore1.textContent = String(st.scoreAlfa);
    this.el.sbScore2.textContent = String(st.scoreOmega);
  }

  audioListener() {
    const g = this.game;
    g.audio.setListener(g.camera.position, g.player.yaw);
  }

  // ---- ações do lobby ---------------------------------------------------------------
  toggleReady() { const me = this.me; if (me) this.room.send(CMSG.READY, { ready: !me.ready }); }

  requestStart() { this.room.send(CMSG.START); }

  switchTeam() { const me = this.me; if (me) this.room.send(CMSG.TEAM, { team: me.team === TEAM.ALFA ? TEAM.OMEGA : TEAM.ALFA }); }

  /** Pós-partida: continuar na sala e entrar pronto na próxima partida. */
  playAgain() {
    this.readyAgain = true;
    this.lobbyTimer = 0;
    if (this.state.phase === PHASE.LOBBY) { this.readyAgain = false; this.room.send(CMSG.READY, { ready: true }); }
  }

  /** Bots da sala privada (o servidor valida anfitrião, fase e limites). */
  bots(op, extra = {}) { this.room.send(CMSG.BOTS, { op, ...extra }); }
}

const NO_INPUT = { down: () => false, pressedAction: () => false, isDown: () => false, wasPressed: () => false, isButtonDown: () => false, wasButtonPressed: () => false };
