// Ferramentas de teste: uma sala construída a partir do PROTÓTIPO REAL de MatchRoom (mesmos
// métodos de serviço, sistemas e modos), sem a camada de rede. As entradas são injetadas
// diretamente no canal, como o framework faria.
import { MatchRoom } from '../src/rooms/MatchRoom.js';
import { MatchState, PlayerState, SpikeState } from '../src/schema/MatchState.js';
import { getArenaCollision } from '../../shared/arena-collision.js';
import { getMapDef } from '../../shared/arena-layout.js';
import { createMoveState } from '../../shared/movement.js';
import { createRng } from '../../shared/math.js';
import { GAME } from '../../shared/game-config.js';
import { PHASE, TEAM } from '../../shared/protocol.js';
import { resetLoadout } from '../src/systems/combat.js';
import { writeMoveState } from '../src/systems/simulation.js';
import { MatchFlow } from '../src/systems/match-state.js';
import { TdmMode } from '../src/modes/tdm.js';
import { TacticalMode } from '../src/modes/tactical.js';
import { RateLimiter, sanitizeInput } from '../src/services/validation.js';
import { BotManager } from '../src/ai/bot-manager.js';
import { setEconomy } from '../src/economy/index.js';
import { Economy } from '../src/economy/economy.js';
import { EconomyStore } from '../src/economy/store.js';

// economia somente em memória nos testes (nenhum arquivo é gravado)
setEconomy(new Economy(new EconomyStore(null)));

export const DT = 1 / GAME.net.tickRate;

export function createTestRoom(mode = 'tdm', map = 'foundry7') {
  const room = Object.create(MatchRoom.prototype);
  const st = new MatchState();
  st.spike = new SpikeState();
  st.mode = mode;
  st.phase = PHASE.LOBBY;
  st.minPlayers = 2;
  st.maxPlayers = 10;
  room.state = st;
  room.code = 'TEST1';
  room.nonce = `n${Math.random().toString(36).slice(2, 8)}`;
  room.mode = mode === 'tactical' ? TacticalMode : TdmMode;
  st.map = map;
  room.mapDef = getMapDef(map);
  room.arena = getArenaCollision(map);
  room.records = new Map();
  room.flow = new MatchFlow(room);
  room.rng = createRng(7);
  room.pendingSmokes = [];
  room.smokeCounter = 0;
  room.sent = [];
  room.broadcasts = [];
  Object.defineProperty(room, 'locked', { value: false, writable: true });
  const queues = new Map();
  room.queues = queues;
  room.inputs = { get: (sid) => ({ next: () => (queues.get(sid) || []).shift() }) };
  room.broadcast = (type, payload) => room.broadcasts.push({ type, payload });
  room.lock = () => { room.locked = true; };
  room.unlock = () => { room.locked = false; };
  room.updateListing = () => {};
  room.seenPosition = (shooter, target) => {
    const s = target.state;
    return { x: s.x, y: s.y, z: s.z, h: s.h, pose: { yaw: s.yaw, pitch: s.pitch, vx: s.vx, vz: s.vz } };
  };
  room.bots = new BotManager(room);
  return room;
}

let nextId = 1;
export function addPlayer(room, { name = `P${nextId}`, team = null } = {}) {
  const sid = `sid${nextId++}`;
  const ps = new PlayerState();
  ps.name = name;
  ps.team = team ?? room.balancedTeam();
  const client = { sessionId: sid, sent: [], send(type, payload) { this.sent.push({ type, payload }); room.sent.push({ to: sid, type, payload }); } };
  const rec = {
    sid, client, clientKey: `key-${sid}`, ip: '127.0.0.1', state: ps, move: createMoveState(),
    simTime: 0, budget: 1, lastInputAt: Date.now(), lastHeldBtn: 0, lastDamageTime: -999, regenAcc: 0,
    protectedT: 0, interacting: false, stationCd: [0, 0], matchStats: { active: 0, botKills: 0, headshots: 0, plants: 0, defuses: 0 }, accountId: null,
    rejectLimiter: new RateLimiter(1000), msgLimiter: new RateLimiter(1000),
  };
  resetLoadout(rec);
  room.records.set(sid, rec);
  room.state.players.set(sid, ps);
  room.queues.set(sid, []);
  if (!room.state.hostId) room.state.hostId = sid;
  return rec;
}

/** Coloca o jogador vivo numa posição/orientação (sem proteção de surgimento). */
export function placeAlive(room, rec, x, z, yaw = 0) {
  const m = rec.move;
  m.pos.x = x; m.pos.y = room.arena.groundHeight(x, z, 3, GAME.player.radius); m.pos.z = z;
  m.vel.x = 0; m.vel.y = 0; m.vel.z = 0;
  m.onGround = true; m.crouching = false; m.height = GAME.player.height;
  rec.state.alive = true; rec.state.hp = 100; rec.state.shielded = false; rec.protectedT = 0;
  rec.state.yaw = yaw;
  writeMoveState(rec);
}

export function startLive(room) {
  room.state.phase = room.state.mode === 'tactical' ? PHASE.ROUND_LIVE : PHASE.LIVE;
  room.state.timeLeft = 100;
}

/** Cria um quadro de entrada saneado como o framework entregaria. */
export function frame(fields = {}) {
  const f = { mf: 0, mr: 0, btn: 0, yaw: 0, pitch: 0, slot: 1, dx: 0, dy: 0, dz: -1, ...fields };
  sanitizeInput(f);
  return f;
}

/** Direção/ângulos para mirar do olho de `from` até um ponto. */
export function aim(from, target) {
  const eye = { x: from.move.pos.x, y: from.move.pos.y + from.move.height - GAME.player.eyeFromTop, z: from.move.pos.z };
  const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
  const len = Math.hypot(dx, dy, dz);
  return { dx: dx / len, dy: dy / len, dz: dz / len, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

export const chestOf = (rec) => ({ x: rec.move.pos.x, y: rec.move.pos.y + 1.2, z: rec.move.pos.z });
export const headOf = (rec) => ({ x: rec.move.pos.x, y: rec.move.pos.y + rec.move.height - 0.12, z: rec.move.pos.z });

/** Enfileira e executa ticks. */
export function tick(room, n = 1) {
  for (let i = 0; i < n; i++) room.step({ dt: DT, dtMs: DT * 1000, tick: 0, subSteps: 1, subDt: DT, subDtMs: DT * 1000 });
}

export function push(room, rec, ...frames) { room.queues.get(rec.sid).push(...frames); }

export const messagesTo = (rec, type) => rec.client.sent.filter((m) => m.type === type).map((m) => m.payload);

export { TEAM, PHASE };
