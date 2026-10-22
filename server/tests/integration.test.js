// Integração de rede ponta a ponta: servidor real (mesmo processo) + clientes reais do SDK
// conectados por WebSocket. Cobre salas, sincronização, combate, saída e reconexão.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { startServer } from '../src/index.js';
import { PROTOCOL_VERSION, ROOM_NAME, CMSG, MSG, BTN, PHASE, TEAM } from '../../shared/protocol.js';
import { GAME } from '../../shared/game-config.js';

const PORT = 25000 + Math.floor(Math.random() * 2000);
const URL = `http://127.0.0.1:${PORT}`;
let server;

before(async () => { server = await startServer({ port: PORT, host: '127.0.0.1' }); });
after(async () => { await server.gracefullyShutdown(false); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opts = (name, extra = {}) => ({ name, clientKey: randomUUID(), protocol: PROTOCOL_VERSION, mode: 'tdm', ...extra });
async function until(fn, timeout = 4000, step = 20) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (fn()) return true; await sleep(step); }
  return false;
}
function recorder(room) {
  const log = [];
  for (const t of Object.values(MSG)) room.onMessage(t, (m) => log.push({ type: t, m }));
  return log;
}
/** Envia quadros de entrada a 60 Hz enquanto `fill` não retornar null. */
async function drive(room, frames, fill) {
  const input = room.input({ renderDelay: GAME.net.interpDelayMs });
  for (let i = 0; i < frames; i++) {
    const d = input.data;
    d.mf = 0; d.mr = 0; d.btn = 0; d.dx = 0; d.dy = 0; d.dz = -1;
    if (fill) fill(d, i);
    input.send();
    await sleep(1000 / 60);
  }
  return input;
}

async function privateDuel() {
  const a = await new Client(URL).create(ROOM_NAME, opts('Ana', { private: true }));
  const b = await new Client(URL).joinById(a.roomId, opts('Bia'));
  return { a, b };
}

test('A — servidor responde à verificação de saúde e entrega o estado inicial ao entrar', async () => {
  const health = await (await fetch(`${URL}/health`)).json();
  assert.equal(health.status, 'ok');
  const { a, b } = await privateDuel();
  assert.ok(await until(() => a.state.players.size === 2 && b.state.players.size === 2));
  assert.equal(a.state.code, a.roomId);
  assert.equal(a.state.phase, PHASE.LOBBY);
  assert.equal(a.state.hostId, a.sessionId, 'quem cria é o anfitrião');
  const teams = [...a.state.players.values()].map((p) => p.team).sort();
  assert.deepEqual(teams, [TEAM.ALFA, TEAM.OMEGA], 'equipes equilibradas');
  await a.leave(); await b.leave();
});

test('A — erros de entrada claros: código inexistente, versão incompatível, nome inválido, aba duplicada, sala cheia', async () => {
  await assert.rejects(new Client(URL).joinById('ZZZZZ', opts('Caio')), (e) => /not found|não encontrada/i.test(e.message));
  await assert.rejects(new Client(URL).create(ROOM_NAME, { ...opts('Caio'), protocol: 1 }), /incompatível/);
  await assert.rejects(new Client(URL).create(ROOM_NAME, opts('x')), /Nome inválido/);
  const key = randomUUID();
  const host = await new Client(URL).create(ROOM_NAME, { ...opts('Host', { private: true, maxPlayers: 2 }), clientKey: key });
  await assert.rejects(new Client(URL).joinById(host.roomId, { ...opts('Clone'), clientKey: key }), /já está nesta sala/);
  const second = await new Client(URL).joinById(host.roomId, opts('Dois'));
  await assert.rejects(new Client(URL).joinById(host.roomId, opts('Tres')), (e) => /full|locked|cheia/i.test(e.message));
  const info = await (await fetch(`${URL}/api/rooms/${host.roomId}`)).json();
  assert.equal(info.status, 'full');
  await host.leave(); await second.leave();
});

test('B — dois jogadores: início pelo anfitrião, movimento e orientação sincronizados', async () => {
  const { a, b } = await privateDuel();
  const rejects = recorder(b);
  b.send(CMSG.START); // não é anfitrião
  assert.ok(await until(() => rejects.some((r) => r.type === MSG.REJECT && /anfitrião/.test(r.m.r))));
  a.send(CMSG.START);
  assert.ok(await until(() => a.state.phase === PHASE.COUNTDOWN));
  assert.ok(await until(() => a.state.phase === PHASE.LIVE, 8000));
  assert.ok(await until(() => [...b.state.players.values()].every((p) => p.alive)));
  const meOnB = () => b.state.players.get(a.sessionId);
  const start = { x: meOnB().x, z: meOnB().z };
  const yaw = a.state.players.get(a.sessionId).yaw;
  const input = await drive(a, 45, (d) => { d.mf = 1; d.yaw = yaw; d.pitch = 0.2; });
  assert.ok(await until(() => Math.hypot(meOnB().x - start.x, meOnB().z - start.z) > 2), 'B vê A se mover');
  assert.ok(Math.abs(meOnB().pitch - 0.2) < 1e-3, 'orientação sincronizada');
  assert.ok(await until(() => input.lastProcessed === input.sentCount), 'todas as entradas confirmadas');
  await a.leave(); await b.leave();
});

test('C — combate autoritativo: munição, dano visto pelos dois, eliminação única, placar e respawn', async () => {
  const { a, b } = await privateDuel();
  const logA = recorder(a), logB = recorder(b);
  a.send(CMSG.START);
  assert.ok(await until(() => a.state.phase === PHASE.LIVE, 8000));
  // coloca os dois frente a frente no corredor central (privilégio de teste no servidor)
  const room = matchMaker.getLocalRoomById(a.roomId);
  const ra = room.records.get(a.sessionId), rb = room.records.get(b.sessionId);
  const put = (rec, x, z) => { rec.move.pos.x = x; rec.move.pos.y = 0; rec.move.pos.z = z; rec.move.vel.x = rec.move.vel.y = rec.move.vel.z = 0; rec.state.shielded = false; rec.protectedT = 0; };
  put(ra, 0, 22); put(rb, 0, 14);
  await sleep(500); // deixa o histórico de compensação registrar as novas posições
  const eyeY = 1.8 - GAME.player.eyeFromTop;
  const dy = 1.2 - eyeY, dz = -8;
  const len = Math.hypot(dy, dz);
  let fired = 0;
  await drive(a, 7 * 4, (d, i) => {
    d.yaw = 0; d.pitch = Math.atan2(dy, 8);
    if (i % 7 === 0) { d.btn = BTN.FIRE; d.dx = 0; d.dy = dy / len; d.dz = dz / len; fired++; }
  });
  assert.ok(await until(() => logB.some((e) => e.type === MSG.KILL)), 'eliminação anunciada');
  const bOnA = a.state.players.get(b.sessionId);
  assert.equal(bOnA.alive, false);
  assert.equal(bOnA.deaths, 1);
  assert.equal(a.state.players.get(a.sessionId).kills, 1);
  assert.equal(a.state.scoreAlfa + a.state.scoreOmega, 1);
  assert.equal(logA.filter((e) => e.type === MSG.KILL).length, 1, 'kill contada uma única vez');
  assert.equal(logA.filter((e) => e.type === MSG.HIT).length, 3, 'três acertos confirmados (o 4º tiro não acerta um eliminado)');
  assert.equal(a.state.players.get(a.sessionId).mag, 25 - fired, 'munição autoritativa');
  assert.ok(logB.some((e) => e.type === MSG.DAMAGED));
  assert.ok(await until(() => bOnA.alive && bOnA.hp === 100, (GAME.match.tdm.respawnDelay + 2) * 1000), 'respawn');
  await a.leave(); await b.leave();
});

test('D — saída e reconexão: sem entidades fantasmas nem duplicadas; sala vazia é encerrada', async () => {
  const { a, b } = await privateDuel();
  b.reconnection.minUptime = 0;
  const code = a.roomId;
  const room = matchMaker.getLocalRoomById(code);
  const logA = recorder(a);
  let reconnected = false;
  b.onReconnect(() => { reconnected = true; });
  // a reconexão só é oferecida a quem concluiu a entrada (handshake confirmado)
  assert.ok(await until(() => b.state?.players?.size === 2));
  await sleep(300);
  // queda de rede abrupta do lado do servidor
  const serverClient = room.clients.find((c) => c.sessionId === b.sessionId);
  serverClient.ref.terminate();
  assert.ok(await until(() => logA.some((e) => e.type === MSG.NOTICE && e.m.t === 'drop')), 'A é avisado da queda de B');
  assert.ok(await until(() => reconnected, 8000), 'B reconecta automaticamente');
  assert.ok(await until(() => logA.some((e) => e.type === MSG.NOTICE && e.m.t === 'reconnect')), 'A é avisado da reconexão');
  assert.ok(await until(() => a.state.players.get(b.sessionId)?.connected === true));
  assert.equal(a.state.players.size, 2, 'sem duplicação após reconexão');
  assert.equal(room.records.size, 2);
  // saída voluntária
  await b.leave();
  assert.ok(await until(() => a.state.players.size === 1), 'A deixa de ver B');
  assert.ok(logA.some((e) => e.type === MSG.NOTICE && e.m.t === 'leave'));
  await a.leave();
  assert.ok(await until(async () => true));
  await sleep(300);
  assert.equal(matchMaker.getLocalRoomById(code), undefined, 'sala vazia encerrada');
});

test('E — busca pública: entra na mesma sala do mesmo modo; modos diferentes não se misturam; listagem', async () => {
  const c1 = await new Client(URL).joinOrCreate(ROOM_NAME, opts('Um'));
  const c2 = await new Client(URL).joinOrCreate(ROOM_NAME, opts('Dois'));
  const t1 = await new Client(URL).joinOrCreate(ROOM_NAME, opts('Tres', { mode: 'tactical' }));
  assert.equal(c1.roomId, c2.roomId);
  assert.notEqual(c1.roomId, t1.roomId);
  const list = await (await fetch(`${URL}/api/rooms`)).json();
  const mine = list.rooms.find((r) => r.code === c1.roomId);
  assert.equal(mine.players, 2);
  assert.equal(mine.mode, 'tdm');
  assert.ok(!list.rooms.some((r) => r.code && r.name === undefined));
  await c1.leave(); await c2.leave(); await t1.leave();
});

test('E — entrada tardia bloqueada em partida tática em andamento', async () => {
  const a = await new Client(URL).create(ROOM_NAME, opts('Ana', { mode: 'tactical', private: true }));
  const b = await new Client(URL).joinById(a.roomId, opts('Bia'));
  a.send(CMSG.START);
  assert.ok(await until(() => a.state.phase === PHASE.ROUND_PREP, 8000));
  await assert.rejects(new Client(URL).joinById(a.roomId, opts('Caio')));
  await a.leave(); await b.leave();
});
