// Precisão do combate: testes reprodutíveis com a física, as hitboxes e a validação reais do servidor.
// Cada caso responde "o tiro que o jogador mirou acertou o que deveria?" — cabeça, tronco, pernas,
// distância, movimento, pulo, alvo agachado/em movimento, paredes, cobertura parcial, alvos
// alinhados, morte durante a rajada e desconexão/reconexão.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRoom, addPlayer, placeAlive, startLive, frame, aim, tick, push, messagesTo, TEAM } from './helpers.js';
import { BTN, MSG } from '../../shared/protocol.js';
import { GAME } from '../../shared/game-config.js';
import { playerHitboxes, headOffset } from '../../shared/hitboxes.js';
import { writeMoveState } from '../src/systems/simulation.js';

const RIFLE = GAME.weapons.find((w) => w.id === 'rifle');

function setup({ shooterAt = [0, 22], targetAt = [0, 14], shooterYaw = 0 } = {}) {
  const room = createTestRoom('tdm');
  const a = addPlayer(room, { name: 'Atirador', team: TEAM.ALFA });
  const b = addPlayer(room, { name: 'Alvo', team: TEAM.OMEGA });
  startLive(room);
  placeAlive(room, a, shooterAt[0], shooterAt[1], shooterYaw);
  placeAlive(room, b, targetAt[0], targetAt[1], Math.PI);
  return { room, a, b };
}

/** Centro de uma zona da hitbox OFICIAL do alvo (a mesma que o servidor usa). */
function zoneCenter(rec, zone) {
  const s = rec.state;
  const boxes = playerHitboxes(s.x, s.y, s.z, s.h, undefined, { yaw: s.yaw, pitch: s.pitch, vx: s.vx, vz: s.vz });
  const b = boxes.find((x) => x.zone === zone);
  return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
}

function shoot(room, shooter, point, extra = {}) {
  const d = aim(shooter, point);
  push(room, shooter, frame({ btn: BTN.FIRE, yaw: d.yaw, pitch: d.pitch, dx: d.dx, dy: d.dy, dz: d.dz, ...extra }));
  tick(room);
  // espera a cadência antes do próximo disparo
  for (let i = 0; i < 8; i++) { push(room, shooter, frame({ yaw: d.yaw, pitch: d.pitch })); tick(room); }
  return messagesTo(shooter, MSG.HIT).at(-1);
}

const lastHitCount = (rec) => messagesTo(rec, MSG.HIT).length;

test('P1 — cabeça, tronco e pernas acertam a zona mirada (8 m, parados)', () => {
  for (const [zone, mult] of [['head', RIFLE.multipliers.head], ['body', 1], ['legs', RIFLE.multipliers.legs]]) {
    const { room, a, b } = setup();
    const hit = shoot(room, a, zoneCenter(b, zone));
    assert.equal(hit.z, zone, `zona ${zone}`);
    assert.equal(hit.d, Math.min(100, Math.round(RIFLE.damage * mult)));
  }
});

test('P2 — curta (1,5 m) e longa distância (45 m) acertam a cabeça', () => {
  const near = setup({ shooterAt: [0, 22], targetAt: [0, 20.5] });
  assert.equal(shoot(near.room, near.a, zoneCenter(near.b, 'head')).z, 'head');
  const far = setup({ shooterAt: [0, 40], targetAt: [0, -5] });
  assert.equal(shoot(far.room, far.a, zoneCenter(far.b, 'head')).z, 'head', '45 m');
});

test('P3 — atirador andando de lado e no ar: tiro centrado aceito e acerta', () => {
  const { room, a, b } = setup();
  // move para a direita por meio segundo e atira em movimento
  const d0 = aim(a, zoneCenter(b, 'body'));
  for (let i = 0; i < 30; i++) { push(room, a, frame({ mr: 1, yaw: d0.yaw, pitch: d0.pitch })); tick(room); }
  assert.ok(Math.hypot(a.move.vel.x, a.move.vel.z) > 2, 'atirador em movimento');
  const d = aim(a, zoneCenter(b, 'body'));
  push(room, a, frame({ mr: 1, btn: BTN.FIRE, yaw: d.yaw, pitch: d.pitch, dx: d.dx, dy: d.dy, dz: d.dz }));
  tick(room);
  assert.equal(messagesTo(a, MSG.HIT).at(-1)?.z, 'body', 'em movimento');
  for (let i = 0; i < 10; i++) { push(room, a, frame({ yaw: d.yaw })); tick(room); }
  // pulo: atira no ápice
  push(room, a, frame({ btn: BTN.JUMP, yaw: d.yaw })); tick(room);
  for (let i = 0; i < 12; i++) { push(room, a, frame({ yaw: d.yaw })); tick(room); }
  assert.equal(a.move.onGround, false, 'atirador no ar');
  const before = lastHitCount(a);
  const d2 = aim(a, zoneCenter(b, 'body'));
  push(room, a, frame({ btn: BTN.FIRE, yaw: d2.yaw, pitch: d2.pitch, dx: d2.dx, dy: d2.dy, dz: d2.dz }));
  tick(room);
  assert.equal(lastHitCount(a), before + 1, 'tiro no ar acertou');
});

test('P4 — alvo agachado: a cabeça visual (deslocada pela postura) é a hitbox da cabeça', () => {
  const { room, a, b } = setup();
  // agacha o alvo de verdade (física compartilhada)
  for (let i = 0; i < 40; i++) { push(room, b, frame({ btn: BTN.CROUCH, yaw: Math.PI })); push(room, a, frame()); tick(room); }
  assert.ok(b.move.height < 1.3, `alvo agachado (h=${b.move.height.toFixed(2)})`);
  const off = headOffset(b.move.height, { yaw: b.state.yaw, pitch: 0, vx: 0, vz: 0 });
  assert.ok(off.fwd > 0.2 && off.side > 0.15, 'postura agachada desloca a cabeça como a animação');
  assert.equal(shoot(room, a, zoneCenter(b, 'head')).z, 'head');
});

test('P5 — alvo correndo (posição vista com compensação): acerta a cabeça inclinada', () => {
  const { room, a, b } = setup({ shooterAt: [-4, 20], targetAt: [3, 12] });
  for (let i = 0; i < 45; i++) { push(room, b, frame({ mf: 1, yaw: Math.PI / 2 })); push(room, a, frame()); tick(room); }
  assert.ok(Math.hypot(b.move.vel.x, b.move.vel.z) > 4.5, 'alvo correndo');
  assert.equal(shoot(room, a, zoneCenter(b, 'head')).z, 'head');
});

test('P6 — parede bloqueia; cobertura parcial bloqueia as pernas mas não a cabeça', () => {
  // parede do corredor (x = 6) entre os dois
  const wall = setup({ shooterAt: [0, 20], targetAt: [9, 20] });
  const before = wall.b.state.hp;
  shoot(wall.room, wall.a, zoneCenter(wall.b, 'body'));
  assert.equal(wall.b.state.hp, before, 'sem dano através da parede');
  // caixa de 1,15 m (x -3,3..-1,8; z 21,4..22,9) entre atirador e alvo
  const cover = setup({ shooterAt: [-2.5, 27], targetAt: [-2.5, 20.6] });
  shoot(cover.room, cover.a, zoneCenter(cover.b, 'legs'));
  assert.equal(cover.b.state.hp, 100, 'pernas protegidas pela cobertura');
  assert.equal(shoot(cover.room, cover.a, zoneCenter(cover.b, 'head')).z, 'head', 'cabeça exposta acima da cobertura');
});

test('P7 — dois alvos alinhados: só o mais próximo recebe o tiro', () => {
  const { room, a, b } = setup({ targetAt: [0, 16] });
  const c = addPlayer(room, { name: 'Atrás', team: TEAM.OMEGA });
  placeAlive(room, c, 0, 10, Math.PI);
  shoot(room, a, zoneCenter(c, 'body'));
  assert.ok(b.state.hp < 100, 'o da frente foi atingido');
  assert.equal(c.state.hp, 100, 'o de trás ficou protegido');
});

test('P8 — morte durante a rajada: corpo não recebe mais tiros; morto não atira', () => {
  const { room, a, b } = setup();
  for (let i = 0; i < 6; i++) shoot(room, a, zoneCenter(b, 'body'));
  assert.equal(b.state.alive, false);
  assert.equal(lastHitCount(a), 3, 'só 3 acertos registrados (34 × 3 ≥ 100)');
  assert.equal(room.broadcasts.filter((m) => m.type === MSG.KILL).length, 1);
  // o alvo eliminado tenta atirar: recusado
  const shotsBefore = room.broadcasts.filter((m) => m.type === MSG.SHOT).length;
  const d = aim(b, zoneCenter(a, 'body'));
  push(room, b, frame({ btn: BTN.FIRE, yaw: d.yaw, pitch: d.pitch, dx: d.dx, dy: d.dy, dz: d.dz })); tick(room);
  assert.equal(room.broadcasts.filter((m) => m.type === MSG.SHOT).length, shotsBefore);
  assert.equal(a.state.hp, 100);
});

test('P9 — queda de conexão: sem dano a "fantasma"; ao reconectar volta a ser atingível', () => {
  const { room, a, b } = setup();
  b.state.connected = false;                       // onDrop
  shoot(room, a, zoneCenter(b, 'body'));
  assert.equal(b.state.hp, 100, 'jogador desconectado não é alvo');
  b.state.connected = true;                        // onReconnect
  writeMoveState(b);
  assert.equal(shoot(room, a, zoneCenter(b, 'body')).z, 'body');
});

test('P10 — mirar na cabeça "antiga" (sem postura) de um alvo agachado não é tiro na cabeça', () => {
  // regressão do problema encontrado na auditoria: a caixa ficava centrada nos pés
  const { room, a, b } = setup();
  for (let i = 0; i < 40; i++) { push(room, b, frame({ btn: BTN.CROUCH, yaw: Math.PI })); push(room, a, frame()); tick(room); }
  const wrong = { x: b.move.pos.x, y: b.move.pos.y + b.move.height - 0.13, z: b.move.pos.z };   // centro da caixa antiga
  const hit = shoot(room, a, wrong);
  assert.notEqual(hit?.z, 'head');
});
