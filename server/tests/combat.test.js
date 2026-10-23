// Regras autoritativas de combate, habilidade, anti-trapaça e modos — executadas pelos
// sistemas reais do servidor (sala construída a partir do protótipo de MatchRoom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestRoom, addPlayer, placeAlive, startLive, frame, aim, chestOf, headOf, tick, push, messagesTo, DT, TEAM, PHASE,
} from './helpers.js';
import { BTN, MSG, SPIKE } from '../../shared/protocol.js';
import { resetLoadout } from '../src/systems/combat.js';
import { GAME } from '../../shared/game-config.js';
import { AMMO_STATIONS } from '../../shared/arena-layout.js';
import { Rewind } from '@colyseus/core';

function duel(mode = 'tdm') {
  const room = createTestRoom(mode);
  const a = addPlayer(room, { name: 'Ana', team: TEAM.ALFA });
  const b = addPlayer(room, { name: 'Bia', team: TEAM.OMEGA });
  startLive(room);
  placeAlive(room, a, 0, 22);          // corredor central, linha de visão livre
  placeAlive(room, b, 0, 14);
  return { room, a, b };
}

const fireAt = (shooter, point, extra = {}) => {
  const d = aim(shooter, point);
  return frame({ btn: BTN.FIRE, yaw: d.yaw, pitch: d.pitch, dx: d.dx, dy: d.dy, dz: d.dz, ...extra });
};

/** Atira uma vez a cada `gap` ticks (cadência do fuzil ≈ 6,15 ticks). */
function burst(room, shooter, target, shots, gap = 7) {
  for (let i = 0; i < shots; i++) {
    push(room, shooter, fireAt(shooter, chestOf(target)));
    tick(room);
    for (let k = 1; k < gap; k++) { push(room, shooter, frame({ yaw: shooter.state.yaw })); tick(room); }
  }
}

test('disparo válido: servidor desconta munição, aplica dano e confirma para os dois lados', () => {
  const { room, a, b } = duel();
  push(room, a, fireAt(a, chestOf(b)));
  tick(room);
  assert.equal(a.state.mag, 24);
  assert.equal(b.state.hp, 100 - 34);
  assert.deepEqual(messagesTo(a, MSG.HIT).at(-1), { t: b.sid, z: 'body', d: 34, k: false });
  assert.equal(messagesTo(b, MSG.DAMAGED).at(-1).d, 34);
  assert.equal(room.broadcasts.filter((m) => m.type === MSG.SHOT).length, 1);
});

test('eliminação: 3 tiros no corpo, contada uma única vez, placar da equipe e respawn', () => {
  const { room, a, b } = duel();
  burst(room, a, b, 4);
  assert.equal(b.state.alive, false);
  assert.equal(b.state.deaths, 1);
  assert.equal(a.state.kills, 1);
  assert.equal(room.state.scoreAlfa, 1);
  assert.equal(room.broadcasts.filter((m) => m.type === MSG.KILL).length, 1, 'kill anunciada uma vez');
  assert.equal(messagesTo(a, MSG.HIT).length, 3, 'o 4º tiro não acerta um alvo eliminado');
  // respawn após o atraso, em posição válida
  for (let i = 0; i < Math.ceil(GAME.match.tdm.respawnDelay / DT) + 2; i++) tick(room);
  assert.equal(b.state.alive, true);
  assert.equal(b.state.hp, 100);
  const p = b.move.pos;
  assert.equal(room.arena.overlapsSolid({ x: p.x - 0.3, y: p.y + 0.01, z: p.z - 0.3 }, { x: p.x + 0.3, y: p.y + 1.8, z: p.z + 0.3 }), false);
});

test('tiro na cabeça elimina com um disparo', () => {
  const { room, a, b } = duel();
  push(room, a, fireAt(a, headOf(b)));
  tick(room);
  assert.equal(b.state.alive, false);
  assert.equal(room.broadcasts.find((m) => m.type === MSG.KILL).payload.hs, true);
});

test('paredes bloqueiam: sem dano através da parede do corredor', () => {
  const { room, a, b } = duel();
  placeAlive(room, b, 9, 20);          // atrás da parede x = 6..6,6
  placeAlive(room, a, 0, 20);
  push(room, a, fireAt(a, chestOf(b)));
  tick(room);
  assert.equal(a.state.mag, 24, 'o disparo é válido e consome munição');
  assert.equal(b.state.hp, 100, 'mas a parede impede o dano');
});

test('cadência: disparos rápidos demais são rejeitados sem consumir munição', () => {
  const { room, a, b } = duel();
  push(room, a, fireAt(a, chestOf(b)), fireAt(a, chestOf(b)));
  tick(room); tick(room);
  assert.equal(a.state.mag, 24);
  assert.ok(messagesTo(a, MSG.REJECT).some((r) => r.r === 'cadência'));
});

test('recarga: sem tiros durante a recarga, R repetido não duplica, conclui no tempo certo', () => {
  const { room, a, b } = duel();
  burst(room, a, b, 2);
  const magBefore = a.state.mag;
  push(room, a, frame({ btn: BTN.RELOAD, yaw: a.state.yaw }));
  tick(room);
  const end = a.reloadEnd;
  assert.ok(a.state.reloading);
  push(room, a, frame({ btn: BTN.RELOAD }), fireAt(a, chestOf(b)));
  tick(room); tick(room);
  assert.equal(a.reloadEnd, end, 'R repetido não reinicia a recarga');
  assert.equal(a.state.mag, magBefore, 'nenhum tiro durante a recarga');
  const ticks = Math.ceil(GAME.weapons[0].reloadTime / DT);
  for (let i = 0; i < ticks; i++) { push(room, a, frame({ yaw: a.state.yaw })); tick(room); }
  assert.equal(a.state.reloading, false);
  assert.equal(a.state.mag, 25);
  assert.equal(a.state.reserve, 100 - (25 - magBefore));
});

test('munição nunca negativa e recarga automática ao esvaziar', () => {
  const { room, a, b } = duel();
  placeAlive(room, b, 20, -40);        // alvo fora da linha de tiro: só gasta munição
  const wall = { x: 0, y: 1.5, z: 40 };
  for (let i = 0; i < 60 * 7; i++) {
    push(room, a, i % 7 === 0 ? fireAt(a, wall) : frame({ yaw: a.state.yaw }));
    tick(room);
    assert.ok(a.state.mag >= 0 && a.state.reserve >= 0);
  }
  assert.ok(a.state.reserve < 100, 'a recarga automática usou a reserva');
});

test('compensação de atraso: acerta onde o atirador via, limitada a maxRewindMs', () => {
  const { room, a, b } = duel();
  // Rewind real do Colyseus (o mesmo que MatchRoom usa), alimentado a cada 50 ms como o patch
  const rewind = new Rewind(GAME.net.maxRewindMs).attachAll(room.state.players, { fields: ['x', 'y', 'z', 'h'] });
  let viewTime = 0;
  room.seenPosition = (shooter, target) => {
    const v = rewind.at(viewTime);
    return { x: v.value(target.state, 'x'), y: v.value(target.state, 'y'), z: v.value(target.state, 'z'), h: v.value(target.state, 'h') };
  };
  const oldChest = chestOf(b);           // B visto em x = 0
  rewind.record(1000, 50);
  placeAlive(room, b, 2.5, 14);          // B já saiu dali no servidor
  for (let t = 1050; t <= 1150; t += 50) rewind.record(t, 50);
  const idle = (n) => { for (let i = 0; i < n; i++) { push(room, a, frame({ yaw: a.state.yaw })); tick(room); } };

  // 150 ms atrás o atirador via B em x = 0: o acerto é aceito na posição vista
  viewTime = 1000;
  push(room, a, fireAt(a, oldChest)); tick(room);
  assert.ok(b.state.hp < 100, 'acerto compensado dentro da janela');
  const hp = b.state.hp;

  // 500 ms atrás: o pedido é limitado a 300 ms (B já em x = 2,5), então a posição antiga erra
  for (let t = 1200; t <= 1500; t += 50) rewind.record(t, 50);
  idle(8);
  push(room, a, fireAt(a, oldChest)); tick(room);
  assert.equal(b.state.hp, hp, 'sem acerto em posição mais antiga que maxRewindMs');

  // e a posição atual continua acertável
  idle(8);
  push(room, a, fireAt(a, chestOf(b))); tick(room);
  assert.ok(b.state.hp < hp);
});

test('estação de munição reabastece por proximidade, com recarga de 12 s', () => {
  const { room, a } = duel();
  const st = AMMO_STATIONS[1];
  const rifle = GAME.weapons[0];
  a.ammo.get(rifle.slot).reserve = 10;
  placeAlive(room, a, st.x + 1.2, st.z);
  tick(room);
  assert.equal(a.ammo.get(rifle.slot).reserve, rifle.reserve, 'reserva cheia ao chegar na estação');
  a.ammo.get(rifle.slot).reserve = 5;
  tick(room, 60 * 2);
  assert.equal(a.ammo.get(rifle.slot).reserve, 5, 'estação em recarga não reabastece');
  tick(room, 60 * (GAME.ammoStation.cooldown - 1));
  assert.equal(a.ammo.get(rifle.slot).reserve, rifle.reserve, 'reabastece de novo após a recarga');
  placeAlive(room, a, st.x + 6, st.z);
  a.ammo.get(rifle.slot).reserve = 5;
  tick(room, 60 * 13);
  assert.equal(a.ammo.get(rifle.slot).reserve, 5, 'longe da estação não reabastece');
});

test('kit: submetralhadora tem munição, cadência e dano próprios (5 tiros no corpo)', () => {
  const { room, a, b } = duel();
  a.primary = 'smg';
  resetLoadout(a);
  assert.equal(a.state.primary, 'smg');
  assert.equal(a.state.mag, 32, 'carregador da SMG');
  burst(room, a, b, 4, 5);                       // 13,3 disparos/s ≈ 4,5 ticks entre tiros
  assert.equal(b.state.hp, 100 - 4 * 24);
  assert.ok(b.state.alive);
  burst(room, a, b, 1, 5);
  assert.equal(b.state.alive, false, 'quinto tiro elimina');
  assert.equal(a.state.mag, 32 - 5);
});

test('kit: troca de operador/arma validada no servidor (lobby) e recusa de identificadores falsos', () => {
  const room = createTestRoom('tdm');
  const a = addPlayer(room, { name: 'Ana', team: TEAM.ALFA });
  room.rejectAction = (rec, action, reason) => { room.rejected = { action, reason }; };
  room.requestLoadout(a, { operator: 'lince', primary: 'smg' });
  assert.equal(a.state.operator, 'lince');
  assert.equal(a.state.primary, 'smg');
  assert.equal(a.state.mag, 32);
  room.requestLoadout(a, { operator: 'robo-9', primary: 'smg' });
  assert.equal(room.rejected.reason, 'Operador desconhecido.');
  assert.equal(a.state.operator, 'lince', 'operador inexistente não é aplicado');
  room.requestLoadout(a, { operator: 'corvo', primary: 'railgun' });
  assert.match(room.rejected.reason, /Arma primária/);
  assert.equal(a.state.primary, 'smg');
  // em combate e vivo: a arma nova só entra no próximo surgimento
  startLive(room);
  placeAlive(room, a, 0, 22);
  room.requestLoadout(a, { operator: 'corvo', primary: 'rifle' });
  assert.equal(a.state.primary, 'smg', 'sem troca de arma no meio da vida');
  assert.equal(a.state.operator, 'lince');
  room.respawn(a);
  assert.equal(a.state.primary, 'rifle');
  assert.equal(a.state.operator, 'corvo');
  assert.equal(a.state.mag, 25);
});

test('direção fora do cone de precisão é rejeitada', () => {
  const { room, a, b } = duel();
  const d = aim(a, chestOf(b));
  push(room, a, frame({ btn: BTN.FIRE, yaw: d.yaw + 0.6, pitch: d.pitch, dx: d.dx, dy: d.dy, dz: d.dz }));
  tick(room);
  assert.equal(b.state.hp, 100);
  assert.equal(a.state.mag, 25);
  assert.ok(messagesTo(a, MSG.REJECT).some((r) => /cone/.test(r.r)));
});

test('jogador eliminado não atira; fogo amigo desativado', () => {
  const { room, a, b } = duel();
  const c = addPlayer(room, { name: 'Caio', team: TEAM.ALFA });
  placeAlive(room, c, 0, 14);
  placeAlive(room, b, 3, 14);
  push(room, a, fireAt(a, chestOf(c)));
  tick(room);
  assert.equal(c.state.hp, 100, 'companheiro de equipe não recebe dano');
  a.state.alive = false;
  push(room, a, fireAt(a, chestOf(b)));
  tick(room);
  assert.equal(b.state.hp, 100);
});

test('fora da fase de combate (lobby) os disparos são rejeitados', () => {
  const { room, a, b } = duel();
  room.state.phase = PHASE.LOBBY;
  push(room, a, fireAt(a, chestOf(b)));
  tick(room);
  assert.equal(b.state.hp, 100);
  assert.equal(a.state.mag, 25);
});

test('fumaça: aprovada pelo servidor, recarga autoritativa, dura 5 s de jogo e é removida', () => {
  const { room, a } = duel();
  placeAlive(room, a, 0, -3);
  push(room, a, frame({ btn: BTN.ABILITY, yaw: 0, pitch: 0 }));
  tick(room);
  assert.equal(a.state.abilityCd, GAME.abilities.smoke.cooldown - DT, 'recarga começou');
  assert.equal(room.pendingSmokes.length, 1);
  push(room, a, frame({ btn: BTN.ABILITY }));
  tick(room);
  assert.ok(messagesTo(a, MSG.REJECT).some((r) => /RECARGA/.test(r.r)), 'segunda ativação recusada');
  const throwTicks = Math.ceil(GAME.abilities.smoke.throwTime / DT);
  for (let i = 0; i < throwTicks; i++) tick(room);
  assert.equal(room.state.smokes.size, 1);
  for (let i = 0; i < Math.round((GAME.abilities.smoke.duration - 0.1) / DT); i++) tick(room);
  assert.equal(room.state.smokes.size, 1, 'ainda ativa antes de 5 s');
  for (let i = 0; i < 12; i++) tick(room);
  assert.equal(room.state.smokes.size, 0, 'removida depois de 5 s');
});

test('anti-aceleração: entradas em excesso não fazem o jogador simular mais rápido que o tempo real', () => {
  const { room, a } = duel();
  const flood = Array.from({ length: 600 }, () => frame({ mf: 1, yaw: 0 }));
  push(room, a, ...flood);
  tick(room, 10);
  const processed = Math.round(a.simTime / DT);
  assert.ok(processed <= 10 + GAME.net.maxInputBurst, `processou ${processed} entradas em 10 ticks`);
});

test('movimento continua bloqueado pela arena no servidor', () => {
  const { room, a } = duel();
  placeAlive(room, a, 0, 20);
  for (let i = 0; i < 180; i++) { push(room, a, frame({ mr: 1, yaw: 0 })); tick(room); }
  assert.ok(a.move.pos.x <= 6 - GAME.player.radius + 1e-3);
});

test('TDM: limite de pontos encerra a partida uma única vez', () => {
  const { room, a, b } = duel();
  room.state.scoreAlfa = GAME.match.tdm.scoreLimit - 1;
  push(room, a, fireAt(a, headOf(b)));
  tick(room);
  assert.equal(room.state.phase, PHASE.ENDED);
  assert.equal(room.state.winner, TEAM.ALFA);
  room.flow.endMatch(TEAM.OMEGA, 'time');
  assert.equal(room.state.winner, TEAM.ALFA, 'resultado não muda depois de definido');
});

test('tático: instalação no objetivo e detonação dão a rodada aos atacantes', () => {
  const room = createTestRoom('tactical');
  const def = addPlayer(room, { name: 'Def', team: TEAM.ALFA });
  const att = addPlayer(room, { name: 'Att', team: TEAM.OMEGA });
  room.flow.beginMatch();
  assert.equal(room.state.phase, PHASE.ROUND_PREP);
  // preparação congela o movimento
  const before = { ...att.move.pos };
  for (let i = 0; i < 30; i++) { push(room, att, frame({ mf: 1 })); tick(room); }
  assert.equal(att.move.pos.x, before.x); assert.equal(att.move.pos.z, before.z);
  for (let i = 0; i < Math.ceil(GAME.match.tactical.prepTime / DT); i++) tick(room);
  assert.equal(room.state.phase, PHASE.ROUND_LIVE);
  placeAlive(room, att, -17, 16);       // dentro do objetivo A
  placeAlive(room, def, 15, -30);       // longe
  for (let i = 0; i < Math.ceil(GAME.match.tactical.plantTime / DT) + 2; i++) { push(room, att, frame({ btn: BTN.INTERACT })); tick(room); }
  assert.equal(room.state.spike.state, SPIKE.PLANTED);
  assert.equal(room.state.spike.site, 'A');
  for (let i = 0; i < Math.ceil(GAME.match.tactical.detonateTime / DT) + 2; i++) tick(room);
  assert.equal(room.state.phase, PHASE.ROUND_END);
  assert.equal(room.state.scoreOmega, 1);
  assert.equal(room.broadcasts.filter((m) => m.type === MSG.ROUND).length, 1);
});

test('tático: desarme dá a rodada aos defensores; eliminação total encerra a rodada', () => {
  const room = createTestRoom('tactical');
  const def = addPlayer(room, { name: 'Def', team: TEAM.ALFA });
  const att = addPlayer(room, { name: 'Att', team: TEAM.OMEGA });
  room.flow.beginMatch();
  for (let i = 0; i < Math.ceil(GAME.match.tactical.prepTime / DT) + 1; i++) tick(room);
  placeAlive(room, att, 14, 20);        // objetivo B
  for (let i = 0; i < Math.ceil(GAME.match.tactical.plantTime / DT) + 2; i++) { push(room, att, frame({ btn: BTN.INTERACT })); tick(room); }
  assert.equal(room.state.spike.state, SPIKE.PLANTED);
  placeAlive(room, def, 14.5, 20.5);
  for (let i = 0; i < Math.ceil(GAME.match.tactical.defuseTime / DT) + 2; i++) { push(room, def, frame({ btn: BTN.INTERACT })); tick(room); }
  assert.equal(room.state.spike.state, SPIKE.DEFUSED);
  assert.equal(room.state.scoreAlfa, 1);
  // próxima rodada: eliminar o único defensor dá a rodada aos atacantes
  for (let i = 0; i < Math.ceil(GAME.match.tactical.roundEndTime / DT) + 1; i++) tick(room);
  assert.equal(room.state.round, 2);
  for (let i = 0; i < Math.ceil(GAME.match.tactical.prepTime / DT) + 1; i++) tick(room);
  placeAlive(room, att, 0, 22); placeAlive(room, def, 0, 14);
  push(room, att, fireAt(att, headOf(def)));
  tick(room); tick(room);
  assert.equal(room.state.phase, PHASE.ROUND_END);
  assert.equal(room.state.scoreOmega, 1);
});

test('tático: sem entrada tardia e a partida termina ao atingir as rodadas necessárias', () => {
  const room = createTestRoom('tactical');
  addPlayer(room, { team: TEAM.ALFA }); addPlayer(room, { team: TEAM.OMEGA });
  room.flow.beginMatch();
  assert.equal(room.locked, true);
  assert.equal(room.mode.allowsLateJoin, false);
  room.state.scoreOmega = GAME.match.tactical.roundsToWin;
  room.state.phase = PHASE.ROUND_END; room.state.timeLeft = 0.01;
  tick(room);
  assert.equal(room.state.phase, PHASE.ENDED);
  assert.equal(room.state.winner, TEAM.OMEGA);
  for (let i = 0; i < Math.ceil(GAME.match.resultsTime / DT) + 1; i++) tick(room);
  assert.equal(room.state.phase, PHASE.LOBBY, 'volta ao lobby');
  assert.equal(room.locked, false);
});
