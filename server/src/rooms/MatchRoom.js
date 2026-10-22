// Sala de partida do OPERATION ZERO 2.0. Uma única implementação de rede e de combate
// atende os dois modos (combate por equipes e tático por rodadas).
import { Room, ServerError } from '@colyseus/core';
import { GAME } from '../../../shared/game-config.js';
import { PHASE, TEAM, MSG, CMSG, NOTICE_TYPES, SPIKE } from '../../../shared/protocol.js';
import { getArenaCollision } from '../../../shared/arena-collision.js';
import { createMoveState } from '../../../shared/movement.js';
import { createRng, clamp } from '../../../shared/math.js';
import { MatchState, PlayerState, SpikeState, PlayerInput } from '../schema/MatchState.js';
import { SERVER_CONFIG } from '../config.js';
import { sanitizeInput, validateJoinOptions, validateCreateOptions, RateLimiter } from '../services/validation.js';
import { generateRoomCode, releaseRoomCode, activeRoomCount, acquireIpSlot, releaseIpSlot } from '../services/matchmaking.js';
import { chooseSpawn, spawnHeight } from '../services/spawns.js';
import { tickPlayers, writeMoveState } from '../systems/simulation.js';
import { resetLoadout, syncWeaponState } from '../systems/combat.js';
import { tickSmokes, clearSmokes } from '../systems/abilities.js';
import { MatchFlow } from '../systems/match-state.js';
import { TdmMode } from '../modes/tdm.js';
import { TacticalMode } from '../modes/tactical.js';
import { log } from '../services/logger.js';

const round3 = (v) => Math.round(v * 1000) / 1000;

export class MatchRoom extends Room {
  // canal de entrada do framework: um quadro por passo fixo, saneado antes de qualquer leitura
  inputs = this.defineInput(PlayerInput, { sanitize: sanitizeInput, bufferMaxSize: 32 });

  async onCreate(options = {}) {
    if (activeRoomCount() >= SERVER_CONFIG.maxRooms) throw new ServerError(503, 'Servidor lotado: limite de salas atingido. Tente novamente em instantes.');
    const opts = validateCreateOptions(options, SERVER_CONFIG.maxPlayersPerRoom);
    this.code = generateRoomCode();
    this.roomId = this.code;               // o código curto é o identificador da sala
    this.maxClients = opts.maxPlayers;

    const st = new MatchState();
    st.spike = new SpikeState();
    st.mode = opts.mode;
    st.code = this.code;
    st.isPrivate = opts.isPrivate;
    st.maxPlayers = opts.maxPlayers;
    st.minPlayers = SERVER_CONFIG.minPlayersToStart;
    st.roomName = opts.roomName || `SALA ${this.code}`;
    st.phase = PHASE.LOBBY;
    this.state = st;

    this.mode = opts.mode === 'tactical' ? TacticalMode : TdmMode;
    this.arena = getArenaCollision();
    this.records = new Map();
    this.flow = new MatchFlow(this);
    this.rng = createRng(Date.now() & 0xffffffff);
    this.pendingSmokes = [];
    this.smokeCounter = 0;

    if (opts.isPrivate) await this.setPrivate(true);
    await this.updateListing();

    this.patchRate = GAME.net.patchRateMs;
    // compensação de latência: histórico limitado das posições, consultado na resolução dos tiros
    this.rewind = this.allowRewindState({ maxRewindMs: GAME.net.maxRewindMs });
    this.rewind.attachAll(this.state.players, { fields: ['x', 'y', 'z', 'h'] });
    this.setFixedTimestep((ctx) => this.step(ctx), GAME.net.tickRate);

    this.onMessage(CMSG.READY, (client, msg) => this.withRecord(client, (rec) => {
      if (this.state.phase !== PHASE.LOBBY) return;
      rec.state.ready = !!(msg && msg.ready);
    }));
    this.onMessage(CMSG.START, (client) => this.withRecord(client, (rec) => {
      const res = this.flow.requestStart(rec);
      if (!res.ok) this.rejectAction(rec, 'start', res.reason, true);
    }));
    this.onMessage(CMSG.TEAM, (client, msg) => this.withRecord(client, (rec) => this.requestTeam(rec, msg && msg.team)));
    this.onMessage(CMSG.PING, (client, msg) => this.withRecord(client, (rec) => {
      const ms = Number(msg && msg.ms);
      if (Number.isFinite(ms)) rec.state.ping = clamp(Math.round(ms), 0, 999);
    }));

    log.info('room.create', { code: this.code, mode: st.mode, private: st.isPrivate, maxPlayers: st.maxPlayers });
  }

  onAuth(client, options, context) {
    let identity;
    try { identity = validateJoinOptions(options); } catch (err) { throw new ServerError(400, err.message); }
    const phase = this.state.phase;
    if (!this.mode.allowsLateJoin && phase !== PHASE.LOBBY && phase !== PHASE.COUNTDOWN) {
      throw new ServerError(409, 'Partida tática em andamento: aguarde o fim ou procure outra sala.');
    }
    for (const rec of this.records.values()) {
      if (rec.clientKey === identity.clientKey) throw new ServerError(409, 'Esta aba do navegador já está nesta sala.');
    }
    if (!acquireIpSlot(context.ip, SERVER_CONFIG.maxConnectionsPerIp)) throw new ServerError(429, 'Muitas conexões deste endereço.');
    return { ...identity, ip: context.ip };
  }

  onJoin(client, options, auth) {
    const ps = new PlayerState();
    ps.name = this.uniqueName(auth.name);
    ps.team = this.balancedTeam();
    ps.connected = true;
    const rec = {
      sid: client.sessionId, client, clientKey: auth.clientKey, ip: auth.ip,
      state: ps, move: createMoveState(), simTime: 0, budget: 1, lastInputAt: Date.now(), lastHeldBtn: 0,
      lastDamageTime: -999, regenAcc: 0, protectedT: 0, interacting: false, stationCd: [0, 0],
      rejectLimiter: new RateLimiter(4), msgLimiter: new RateLimiter(8),
    };
    resetLoadout(rec);
    // até entrar em combate, o jogador fica na área de preparação (sem estar "vivo")
    const p = chooseSpawn(this, rec);
    rec.move.pos.x = p.x; rec.move.pos.y = spawnHeight(this.arena, p); rec.move.pos.z = p.z;
    ps.yaw = p.yaw;
    writeMoveState(rec);
    this.records.set(rec.sid, rec);
    this.state.players.set(rec.sid, ps);
    if (!this.state.hostId || !this.records.has(this.state.hostId)) this.state.hostId = rec.sid;
    this.broadcast(MSG.NOTICE, { t: NOTICE_TYPES.JOIN, n: ps.name, m: '' }, { except: client });
    this.mode.onPlayerJoined(this, rec);
    this.updateListing();
    log.info('player.join', { code: this.code, sid: rec.sid, name: ps.name, team: ps.team });
  }

  /** Queda inesperada: mantém a vaga por alguns segundos, sem entidade "fantasma" em combate. */
  onDrop(client) {
    const rec = this.records.get(client.sessionId);
    if (!rec) return;
    rec.state.connected = false;
    rec.interacting = false;
    this.cancelObjectiveAction(rec);
    this.broadcast(MSG.NOTICE, { t: NOTICE_TYPES.DROP, n: rec.state.name, m: '' });
    log.info('player.drop', { code: this.code, sid: rec.sid });
    // a promessa é rejeitada quando a janela expira (o framework então chama onLeave)
    Promise.resolve(this.allowReconnection(client, SERVER_CONFIG.reconnectSeconds)).catch(() => {});
  }

  onReconnect(client) {
    const rec = this.records.get(client.sessionId);
    if (!rec) return;
    rec.client = client;
    rec.state.connected = true;
    rec.lastInputAt = Date.now();
    this.broadcast(MSG.NOTICE, { t: NOTICE_TYPES.RECONNECT, n: rec.state.name, m: '' }, { except: client });
    log.info('player.reconnect', { code: this.code, sid: rec.sid });
  }

  onLeave(client) {
    const rec = this.records.get(client.sessionId);
    if (!rec) return;
    this.cancelObjectiveAction(rec);
    this.records.delete(rec.sid);
    this.state.players.delete(rec.sid);
    releaseIpSlot(rec.ip);
    this.broadcast(MSG.NOTICE, { t: NOTICE_TYPES.LEAVE, n: rec.state.name, m: '' });
    if (this.state.hostId === rec.sid) {
      const next = this.records.values().next().value;
      this.state.hostId = next ? next.sid : '';
      if (next) this.broadcast(MSG.NOTICE, { t: NOTICE_TYPES.HOST, n: next.state.name, m: '' });
    }
    this.mode.onPlayerLeft(this, rec);
    this.updateListing();
    log.info('player.leave', { code: this.code, sid: rec.sid });
  }

  onDispose() {
    releaseRoomCode(this.code);
    for (const rec of this.records.values()) releaseIpSlot(rec.ip);
    this.records.clear();
    log.info('room.dispose', { code: this.code });
  }

  // ---- simulação -------------------------------------------------------------
  step(ctx) {
    tickPlayers(this, ctx);
    tickSmokes(this, ctx.dt);
    this.flow.tick(ctx.dt);
  }

  // ---- serviços usados pelos sistemas ------------------------------------------
  combatActive() { return this.mode.combatActive(this); }

  movementAllowed() { return this.mode.movementAllowed(this); }

  canDamage(attacker, target) { return attacker !== target && attacker.state.team !== target.state.team; }

  /** Posição do alvo no instante em que o atirador o viu (limitada a maxRewindMs). */
  seenPosition(shooter, target) {
    const view = this.rewind.lastSeenBy(shooter.sid);
    return { x: view.value(target.state, 'x'), y: view.value(target.state, 'y'), z: view.value(target.state, 'z'), h: view.value(target.state, 'h') };
  }

  respawn(rec, { shield = true } = {}) {
    const s = rec.state;
    const p = chooseSpawn(this, rec);
    const m = rec.move;
    m.pos.x = p.x; m.pos.y = spawnHeight(this.arena, p); m.pos.z = p.z;
    m.vel.x = 0; m.vel.y = 0; m.vel.z = 0;
    m.height = GAME.player.height; m.crouching = false; m.onGround = true; m.coyoteT = 0; m.jumpBufferT = 0;
    s.yaw = p.yaw; s.pitch = 0;
    s.hp = GAME.player.maxHealth;
    s.alive = true;
    s.respawnIn = 0;
    s.action = 0;
    rec.regenAcc = 0;
    rec.lastDamageTime = -999;
    rec.interacting = false;
    resetLoadout(rec);
    const protect = shield && this.state.mode === 'tdm';
    s.shielded = protect;
    rec.protectedT = protect ? GAME.match.tdm.spawnProtection : 0;
    writeMoveState(rec);
    s.spawnSeq = (s.spawnSeq + 1) % 65536;
  }

  teamCounts(onlyConnected = false) {
    const c = { [TEAM.ALFA]: 0, [TEAM.OMEGA]: 0 };
    for (const r of this.records.values()) if (!onlyConnected || r.state.connected) c[r.state.team] = (c[r.state.team] || 0) + 1;
    return c;
  }

  balancedTeam() {
    const c = this.teamCounts();
    return c[TEAM.OMEGA] < c[TEAM.ALFA] ? TEAM.OMEGA : TEAM.ALFA;
  }

  requestTeam(rec, team) {
    if (this.state.phase !== PHASE.LOBBY) return this.rejectAction(rec, 'team', 'Troca de equipe só no lobby', true);
    if (team !== TEAM.ALFA && team !== TEAM.OMEGA || team === rec.state.team) return undefined;
    const c = this.teamCounts();
    const target = c[team] + 1, origin = c[rec.state.team] - 1;
    if (Math.abs(target - origin) > 1) return this.rejectAction(rec, 'team', 'As equipes ficariam desequilibradas', true);
    rec.state.team = team;
    rec.state.ready = false;
    return undefined;
  }

  uniqueName(base) {
    const taken = new Set([...this.records.values()].map((r) => r.state.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; n < 100; n++) {
      const candidate = `${base.slice(0, 13)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${base.slice(0, 10)} ${this.rng().toString(36).slice(2, 6)}`;
  }

  cancelObjectiveAction(rec) {
    const sp = this.state.spike;
    if (sp.actor !== rec.sid) return;
    sp.actor = '';
    sp.progress = 0;
    if (sp.state === SPIKE.PLANTING) sp.state = SPIKE.NONE;
    else if (sp.state === SPIKE.DEFUSING) sp.state = SPIKE.PLANTED;
    rec.state.action = 0;
  }

  // ---- mensagens ---------------------------------------------------------------
  withRecord(client, fn) {
    const rec = this.records.get(client.sessionId);
    if (!rec || !rec.msgLimiter.allow()) return;
    fn(rec);
  }

  sendTo(rec, type, payload) {
    if (rec && rec.state.connected && rec.client) rec.client.send(type, payload);
  }

  /** Rejeições informam o autor (com limite de frequência para não inundar a rede). */
  rejectAction(rec, action, reason, important = false) {
    if (!important && !rec.rejectLimiter.allow()) return;
    this.sendTo(rec, MSG.REJECT, { a: action, r: reason });
  }

  broadcastShot(rec, origin, hit) {
    const kind = hit.kind === 'player' ? 1 : hit.kind === 'world' ? 0 : 2;
    const payload = { s: rec.sid, o: [round3(origin.x), round3(origin.y), round3(origin.z)], e: [round3(hit.end.x), round3(hit.end.y), round3(hit.end.z)], k: kind, f: hit.surface || '' };
    this.broadcast(MSG.SHOT, payload, { except: rec.client });
  }

  broadcastKill(killer, victim, headshot, weaponId) {
    this.broadcast(MSG.KILL, {
      k: killer ? killer.sid : '', kn: killer ? killer.state.name : '', kt: killer ? killer.state.team : 0,
      v: victim.sid, vn: victim.state.name, vt: victim.state.team, hs: !!headshot, w: weaponId || '',
    });
  }

  notifyAmmo(rec) {
    syncWeaponState(rec);
    this.sendTo(rec, MSG.NOTICE, { t: 'ammo', n: '', m: 'MUNIÇÃO REABASTECIDA' });
  }

  async updateListing() {
    const st = this.state;
    try {
      await this.setMetadata({ name: st.roomName, mode: st.mode, phase: st.phase, players: this.records.size });
    } catch (err) {
      log.warn('room.metadata', { code: this.code, error: err.message });
    }
  }

  clearArena() { clearSmokes(this); }
}
