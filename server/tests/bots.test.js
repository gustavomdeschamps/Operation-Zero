// Bots autoritativos: identificação, percepção sem trapaça (paredes, campo de visão, fumaça),
// combate pelas mesmas regras dos jogadores, precisão limitada, dificuldades, navegação,
// audição, preenchimento das salas públicas, controles do anfitrião e partida tática completa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestRoom, addPlayer, placeAlive, startLive, tick, DT, PHASE, TEAM, messagesTo } from './helpers.js';
import { createRng } from '../../shared/math.js';
import { MSG, SPIKE } from '../../shared/protocol.js';
import { damageFor } from '../../shared/weapon-rules.js';
import { GAME } from '../../shared/game-config.js';
import { SmokeState } from '../src/schema/MatchState.js';
import { BOT_DIFFICULTIES, BOT_FILL } from '../src/ai/bot-config.js';
import { currentWeapon, resetLoadout } from '../src/systems/combat.js';

const yawTo = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[1] - from[1]));

/** Sala com um bot (Ômega) e um alvo humano parado (Alfa). */
function duel({ diff = 'normal', botAt = [0, 40], dummyAt = [0, 28], seed = 11, map = 'foundry7', primary = 'rifle' } = {}) {
  const room = createTestRoom('tdm', map);
  room.rng = createRng(seed);
  room.bots.setDifficulty(diff);
  const dummy = addPlayer(room, { name: 'Alvo', team: TEAM.ALFA });
  const bot = room.bots.add(TEAM.OMEGA);
  bot.primary = primary;
  startLive(room);
  placeAlive(room, dummy, dummyAt[0], dummyAt[1], yawTo(dummyAt, botAt));
  placeAlive(room, bot, botAt[0], botAt[1], yawTo(botAt, dummyAt));
  bot.state.yaw = yawTo(botAt, dummyAt);
  resetLoadout(bot);                 // aplica a arma escolhida
  bot.bot.reset();
  bot.bot.aimYaw = bot.state.yaw;
  let rejects = 0;
  const orig = room.rejectAction.bind(room);
  room.rejectAction = (rec, a, r, imp) => { if (rec.bot) rejects++; return orig(rec, a, r, imp); };
  return { room, bot, dummy, rejects: () => rejects };
}

const shotsBy = (room, rec) => room.broadcasts.filter((b) => b.type === MSG.SHOT && b.payload.s === rec.sid).map((b) => b.payload);

test('B1 — bots são identificados como bots e não têm cliente', () => {
  const room = createTestRoom('tdm');
  addPlayer(room, { name: 'Pessoa' });
  const bot = room.bots.add();
  assert.ok(bot.state.bot, 'campo bot replicado');
  assert.match(bot.state.name, /^\[BOT\] /, 'nome sempre com prefixo [BOT]');
  assert.equal(bot.client, null);
  assert.equal(bot.state.ready, true);
  assert.equal(room.state.players.get(bot.sid), bot.state);
});

test('B2 — visão: parede, campo de visão e fumaça bloqueiam; campo aberto não', () => {
  // campo aberto (mesma linha usada nos testes de precisão)
  let d = duel({ botAt: [0, 40], dummyAt: [0, 25] });
  const eye = d.bot.bot.eye();
  assert.equal(d.bot.bot.canSee(d.dummy, eye, []), true, 'vê em campo aberto');
  // fora do campo de visão (alvo atrás)
  d.bot.bot.aimYaw += Math.PI;
  assert.equal(d.bot.bot.canSee(d.dummy, eye, []), false, 'não vê atrás de si');
  d.bot.bot.aimYaw -= Math.PI;
  // fumaça no meio do caminho
  const sm = new SmokeState();
  sm.x = 0; sm.z = 32; sm.y = d.room.arena.groundHeight(0, 32, 3, 0.3); sm.remaining = 10;
  d.room.state.smokes.set('s1', sm);
  assert.equal(d.bot.bot.canSee(d.dummy, eye, d.bot.bot.smokeCenters()), false, 'fumaça bloqueia');
  // parede do corredor (x = 6) entre os dois
  d = duel({ botAt: [0, 20], dummyAt: [9, 20] });
  assert.equal(d.bot.bot.canSee(d.dummy, d.bot.bot.eye(), []), false, 'parede bloqueia');
});

test('B3 — com o alvo atrás da parede o bot não atira', () => {
  const d = duel({ botAt: [0, 20], dummyAt: [9, 20] });
  // mantém os dois parados no lugar (o bot procuraria rotas): só a decisão de atirar importa aqui
  for (let i = 0; i < 4 / DT; i++) {
    tick(d.room);
    const m = d.bot.move; m.pos.x = 0; m.pos.z = 20; m.vel.x = 0; m.vel.z = 0;
  }
  assert.equal(shotsBy(d.room, d.bot).length, 0);
  assert.equal(d.dummy.state.hp, 100);
});

test('B4 — combate pelas regras: munição, recarga e cone de dispersão aceitos pelo servidor', () => {
  const d = duel({ botAt: [0, 40], dummyAt: [0, 24] });
  const def = currentWeapon(d.bot);
  const start = def.magSize + def.reserve;
  let sawReload = false;
  for (let i = 0; i < 25 / DT; i++) {
    d.dummy.state.hp = 100;            // alvo "infinito" para observar várias recargas
    tick(d.room);
    if (d.bot.reloadEnd >= 0) sawReload = true;
  }
  const shots = shotsBy(d.room, d.bot).length;
  const a = d.bot.ammo.get(1);
  assert.ok(shots > def.magSize, `atirou o suficiente para recarregar (${shots})`);
  assert.ok(sawReload, 'recarregou');
  assert.equal(start - (a.mag + a.reserve), shots, 'cada disparo consumiu exatamente uma munição');
  assert.equal(d.rejects(), 0, 'nenhum disparo recusado pelo servidor (cadência/cone)');
  // dano por acerto igual às regras da arma (dificuldade nunca altera dano)
  const allowed = new Set(['head', 'body', 'legs'].map((z) => Math.min(100, damageFor(def, z))));
  const dmg = messagesTo(d.dummy, MSG.DAMAGED);
  assert.ok(dmg.length > 0);
  for (const m of dmg) assert.ok(allowed.has(m.d), `dano ${m.d} pertence à tabela da arma`);
});

/** Acertos/disparos e tempo até o 1º acerto num duelo de `secs` segundos. */
function duelStats(opts, secs = 8) {
  const d = duel(opts);
  let firstHit = null;
  for (let i = 0; i < secs / DT; i++) {
    d.dummy.state.hp = 100;
    const m = d.dummy.move; m.pos.x = opts.dummyAt[0]; m.pos.z = opts.dummyAt[1];
    tick(d.room);
    if (firstHit === null && messagesTo(d.dummy, MSG.DAMAGED).length) firstHit = i * DT;
  }
  const shots = shotsBy(d.room, d.bot);
  const hits = shots.filter((s) => s.k === 1).length;
  return { shots: shots.length, hits, firstHit: firstHit ?? secs };
}

test('B5 — o bot não acerta tudo e erra mais de longe', () => {
  let near = { shots: 0, hits: 0 }, far = { shots: 0, hits: 0 };
  for (const seed of [3, 5, 9]) {
    const n = duelStats({ botAt: [0, 40], dummyAt: [0, 29], seed }, 6);
    const f = duelStats({ botAt: [0, 40], dummyAt: [0, -4], seed, primary: 'rifle' }, 6);
    near.shots += n.shots; near.hits += n.hits; far.shots += f.shots; far.hits += f.hits;
  }
  const rn = near.hits / near.shots, rf = far.hits / far.shots;
  assert.ok(near.shots > 20 && far.shots > 20, 'atirou nos dois cenários');
  assert.ok(rn < 0.95, `perto não acerta 100% (${rn.toFixed(2)})`);
  assert.ok(rf < rn, `longe (${rf.toFixed(2)}) erra mais que perto (${rn.toFixed(2)})`);
  assert.ok(rf < 0.6, `longe a precisão é limitada (${rf.toFixed(2)})`);
});

test('B6 — dificuldade muda reação e precisão (não dano, munição ou visão através de paredes)', () => {
  const agg = {};
  for (const diff of ['normal', 'elite']) {
    agg[diff] = { shots: 0, hits: 0, first: 0 };
    for (const seed of [2, 4, 6, 8, 10]) {
      const s = duelStats({ diff, botAt: [0, 40], dummyAt: [0, 20], seed }, 6);
      agg[diff].shots += s.shots; agg[diff].hits += s.hits; agg[diff].first += s.firstHit / 5;
    }
  }
  const rn = agg.normal.hits / agg.normal.shots, re = agg.elite.hits / agg.elite.shots;
  assert.ok(agg.elite.first < agg.normal.first, `Elite reage antes (${agg.elite.first.toFixed(2)}s vs ${agg.normal.first.toFixed(2)}s)`);
  assert.ok(re > rn, `Elite mais preciso (${re.toFixed(2)} vs ${rn.toFixed(2)})`);
  assert.ok(re < 0.95, `nem o Elite acerta tudo (${re.toFixed(2)})`);
  for (const cfg of Object.values(BOT_DIFFICULTIES)) {
    for (const forbidden of ['damage', 'fireRate', 'magSize', 'speed', 'wallhack']) assert.equal(cfg[forbidden], undefined);
  }
});

test('B7 — navegação: chega aos destinos pelos dois mapas sem ficar preso', () => {
  for (const map of ['foundry7', 'vesper']) {
    const room = createTestRoom('tdm', map);
    room.rng = createRng(21);
    const human = addPlayer(room, { name: 'Pessoa', team: TEAM.ALFA });
    const bot = room.bots.add(TEAM.OMEGA);
    startLive(room);
    human.state.alive = false;   // ninguém para engajar: só navegação
    const nav = room.bots.nav;
    const p0 = nav.randomPoint(room.rng);
    placeAlive(room, bot, p0.x, p0.z, 0);
    bot.bot.reset();
    let reached = 0;
    const goals = 8;
    for (let g = 0; g < goals; g++) {
      const goal = nav.randomPoint(room.rng);
      bot.bot.mode = 'roam';
      bot.bot.setGoal(goal.x, goal.z, 'roam');
      let best = Infinity;
      for (let i = 0; i < 30 / DT; i++) {
        tick(room);
        best = Math.min(best, Math.hypot(bot.move.pos.x - goal.x, bot.move.pos.z - goal.z));
        if (best < 1.5) break;
        if (bot.bot.goal && (bot.bot.goal.x !== goal.x || bot.bot.goal.z !== goal.z) && best >= 1.5) bot.bot.setGoal(goal.x, goal.z, 'roam');
      }
      if (best < 1.5) reached++;
    }
    assert.ok(reached >= goals - 1, `${map}: alcançou ${reached}/${goals} destinos`);
  }
});

test('B8 — audição: um tiro próximo (fora do campo de visão) faz o bot investigar', () => {
  const d = duel({ botAt: [0, 25], dummyAt: [0, 40] });
  d.bot.bot.aimYaw = 0;                 // olhando para -Z: o alvo está às costas
  d.bot.state.yaw = 0;
  d.room.bots.shot(d.dummy);
  let reacted = false;
  for (let i = 0; i < 3 / DT && !reacted; i++) {
    tick(d.room);
    const b = d.bot.bot;
    const g = b.goal;
    if (b.target === d.dummy || (g && Math.hypot(g.x - 0, g.z - 40) < 6)) reacted = true;
  }
  assert.ok(reacted, 'investigou a origem do som ou encontrou o atirador');
});

test('B9 — sala pública: completa com bots, libera vaga para pessoas e nunca joga só com bots', () => {
  const room = createTestRoom('tdm');
  room.state.isPrivate = false;
  const a = addPlayer(room, { name: 'Ana' });
  for (let i = 0; i < (BOT_FILL.fillDelay - 1) / DT; i++) tick(room);
  assert.equal(room.bots.count, 0, 'aguarda pessoas antes de completar');
  for (let i = 0; i < 3 / DT; i++) tick(room);
  const target = BOT_FILL.publicTarget.tdm;
  assert.equal(room.records.size, target, `completou até ${target} participantes`);
  assert.equal(room.bots.count, target - 1);
  // equipes equilibradas
  const c = room.teamCounts();
  assert.ok(Math.abs(c[TEAM.ALFA] - c[TEAM.OMEGA]) <= 1);
  // uma pessoa entra: um bot sai
  const b = addPlayer(room, { name: 'Bia' });
  room.bots.onHumanJoined(b);
  assert.equal(room.records.size, target);
  assert.equal(room.bots.count, target - 2);
  // sem pessoas conectadas: não inicia e os bots saem
  for (const r of [a, b]) { room.records.delete(r.sid); room.state.players.delete(r.sid); }
  assert.equal(room.flow.canStart().ok, false);
  tick(room);
  assert.equal(room.bots.count, 0);
});

test('B10 — sala privada: só o anfitrião controla bots, só no lobby', () => {
  const room = createTestRoom('tdm');
  room.state.isPrivate = true;
  const host = addPlayer(room, { name: 'Host' });
  const guest = addPlayer(room, { name: 'Convidado' });
  room.requestBots(guest, { op: 'add' });
  assert.equal(room.bots.count, 0);
  assert.ok(messagesTo(guest, MSG.REJECT).some((m) => m.a === 'bots'));
  room.requestBots(host, { op: 'add', team: TEAM.OMEGA });
  room.requestBots(host, { op: 'add' });
  assert.equal(room.bots.count, 2);
  room.requestBots(host, { op: 'difficulty', difficulty: 'elite' });
  assert.equal(room.state.botDifficulty, 'elite');
  for (const r of room.records.values()) if (r.bot) assert.equal(r.bot.difficulty, 'elite');
  room.requestBots(host, { op: 'difficulty', difficulty: 'impossivel' });
  assert.equal(room.state.botDifficulty, 'elite');
  room.requestBots(host, { op: 'remove' });
  assert.equal(room.bots.count, 1);
  // a sala privada não é preenchida automaticamente
  for (let i = 0; i < 12 / DT; i++) tick(room);
  assert.equal(room.bots.count, 1);
  room.state.phase = PHASE.LIVE;
  room.requestBots(host, { op: 'add' });
  assert.equal(room.bots.count, 1, 'não altera bots com a partida em andamento');
  // salas públicas recusam o controle manual
  const pub = createTestRoom('tdm');
  const p = addPlayer(pub, { name: 'Pub' });
  pub.requestBots(p, { op: 'add' });
  assert.equal(pub.bots.count, 0);
});

test('B11 — tático: defensor bot vai até o dispositivo e desarma', () => {
  const room = createTestRoom('tactical');
  room.rng = createRng(5);
  const att = addPlayer(room, { name: 'Atacante', team: TEAM.OMEGA });
  const bot = room.bots.add(TEAM.ALFA);
  room.state.attackers = TEAM.OMEGA;
  startLive(room);
  room.state.round = 1;
  att.state.alive = false;
  const site = room.mapDef.sites.A;
  const sp = room.state.spike;
  sp.state = SPIKE.PLANTED; sp.site = 'A'; sp.x = site.cx; sp.z = site.cz; sp.y = room.arena.groundHeight(site.cx, site.cz, 3, 0.3);
  sp.timer = GAME.match.tactical.detonateTime;
  const p = room.bots.nav.randomPoint(room.rng, { minX: site.cx + 12, maxX: site.cx + 20, minZ: site.cz - 4, maxZ: site.cz + 4 }) || { x: site.cx + 8, z: site.cz };
  placeAlive(room, bot, p.x, p.z, 0);
  bot.bot.reset();
  for (let i = 0; i < 30 / DT && room.state.phase === PHASE.ROUND_LIVE; i++) tick(room);
  assert.equal(sp.state, SPIKE.DEFUSED, `desarmou (estado ${sp.state})`);
});

test('B12 — partida tática só com bots e uma pessoa ociosa chega ao fim sem erros', () => {
  const room = createTestRoom('tactical', 'vesper');
  room.rng = createRng(99);
  addPlayer(room, { name: 'Pessoa' });
  for (let i = 0; i < 5; i++) room.bots.add();
  room.flow.startCountdown();
  let planted = false, ticks = 0;
  const t0 = performance.now();
  for (let i = 0; i < 600 / DT && room.state.phase !== PHASE.ENDED; i++) {
    tick(room); ticks++;
    if (room.state.spike.state === SPIKE.PLANTED) planted = true;
  }
  const ms = (performance.now() - t0) / ticks;
  assert.equal(room.state.phase, PHASE.ENDED, 'a partida terminou');
  assert.ok(room.state.endReason, 'com um motivo');
  assert.ok(planted, 'os atacantes instalaram o dispositivo ao menos uma vez');
  assert.ok(ms < 3, `custo médio por passo com 5 bots: ${ms.toFixed(3)} ms`);
});
