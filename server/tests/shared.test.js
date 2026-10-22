// Testes das regras compartilhadas (as mesmas usadas pelo cliente e pelo servidor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getArenaCollision } from '../../shared/arena-collision.js';
import { ONLINE_SPAWNS, BOT_SPAWNS, SITES, BOUNDS, OFFLINE_SPAWN } from '../../shared/arena-layout.js';
import { createMoveState, createCommand, stepMovement, copyMoveState } from '../../shared/movement.js';
import { GAME } from '../../shared/game-config.js';
import { computeSmokePlacement } from '../../shared/smoke-rules.js';
import { rayVsPlayer } from '../../shared/hitboxes.js';
import { computeSpread, damageFor, weaponBySlot } from '../../shared/weapon-rules.js';
import { sanitizeName, isValidRoomCode, normalizeRoomCode } from '../../shared/protocol.js';
import { sanitizeInput, validateJoinOptions } from '../src/services/validation.js';

const arena = getArenaCollision();
const DT = 1 / GAME.net.tickRate;
const P = GAME.player;

function at(x, z) {
  const s = createMoveState(x, arena.groundHeight(x, z, 3, P.radius), z);
  return s;
}
function run(s, seconds, fill) {
  const cmd = createCommand();
  const n = Math.round(seconds / DT);
  let maxY = s.pos.y;
  for (let i = 0; i < n; i++) {
    Object.assign(cmd, { f: 0, r: 0, jump: false, crouch: false, walk: false, ads: 0, yaw: 0 }, fill ? fill(i) : {});
    stepMovement(s, cmd, DT, arena);
    maxY = Math.max(maxY, s.pos.y);
  }
  return maxY;
}

test('arena: 187 colisores gerados do layout compartilhado', () => {
  assert.equal(arena.colliders.length, 187);
});

test('arena: todos os pontos de surgimento são válidos (no piso, fora de sólidos, dentro dos limites)', () => {
  const all = [...ONLINE_SPAWNS.tdm, ...ONLINE_SPAWNS[1], ...ONLINE_SPAWNS[2], ...BOT_SPAWNS, OFFLINE_SPAWN];
  for (const p of all) {
    assert.ok(arena.inBounds(p.x, p.z, P.radius), `fora dos limites: ${p.x},${p.z}`);
    const y = arena.groundHeight(p.x, p.z, 3, P.radius);
    const min = { x: p.x - P.radius, y: y + 0.01, z: p.z - P.radius };
    const max = { x: p.x + P.radius, y: y + P.height, z: p.z + P.radius };
    assert.equal(arena.overlapsSolid(min, max), false, `ponto dentro de sólido: ${p.x},${p.z}`);
  }
});

test('arena: objetivos A/B ficam dentro da arena e o centro é acessível', () => {
  for (const s of Object.values(SITES)) {
    assert.ok(s.minX >= BOUNDS.minX && s.maxX <= BOUNDS.maxX && s.minZ >= BOUNDS.minZ && s.maxZ <= BOUNDS.maxZ);
    const y = arena.groundHeight(s.cx, s.cz, 3, P.radius);
    assert.equal(arena.overlapsSolid({ x: s.cx - P.radius, y: y + 0.01, z: s.cz - P.radius }, { x: s.cx + P.radius, y: y + P.height, z: s.cz + P.radius }), false);
  }
});

test('movimento: gravidade leva ao chão', () => {
  const s = at(0, 20); s.pos.y = 6; s.onGround = false;
  run(s, 2);
  assert.ok(Math.abs(s.pos.y) < 1e-3 && s.onGround);
});

test('movimento: pulo de ~0,94 m e sem pulo infinito no ar', () => {
  const s = at(0, 20);
  const maxY = run(s, 1.5, () => ({ jump: true }));
  assert.ok(maxY > 0.85 && maxY < 1.05, `altura ${maxY}`);
});

test('movimento: parede bloqueia e alta velocidade não atravessa', () => {
  const s = at(0, 20);
  run(s, 3, () => ({ r: 1 }));
  assert.ok(s.pos.x <= 6 - P.radius + 1e-3);
  const f = at(4, 20); f.vel.x = 250;
  run(f, 3 * DT);
  assert.ok(f.pos.x < 6);
});

test('movimento: sobe a escada da torre e desce sem flutuar', () => {
  const s = at(14, -2.9);
  run(s, 3, () => ({ f: 1, yaw: -Math.PI / 2 }));
  assert.ok(Math.abs(s.pos.y - 2.4) < 0.02, `y=${s.pos.y}`);
  run(s, 3, () => ({ f: 1, yaw: Math.PI / 2 }));
  assert.ok(s.pos.y < 0.01 && s.onGround);
});

test('movimento: determinístico — reproduzir as mesmas entradas dá o mesmo estado (base da reconciliação)', () => {
  const inputs = Array.from({ length: 240 }, (_, i) => ({ f: i % 50 < 30 ? 1 : 0, r: i % 70 < 20 ? -1 : 0, jump: i % 90 === 10, crouch: i > 200, walk: false, ads: 0, yaw: i * 0.01 }));
  const a = at(0, 30);
  const snapshot = copyMoveState(createMoveState(), a);
  for (const c of inputs) stepMovement(a, c, DT, arena);
  const b = copyMoveState(createMoveState(), snapshot);
  for (const c of inputs) stepMovement(b, c, DT, arena);
  assert.deepEqual(b, a);
});

test('fumaça: ponto aberto é aceito; colado na parede e fora da arena são recusados', () => {
  const ok = computeSmokePlacement(arena, { x: 0, y: 1.67, z: -3 }, { x: 0, y: 0, z: -1 });
  assert.equal(ok.ok, true);
  const near = computeSmokePlacement(arena, { x: 5.2, y: 1.67, z: 20 }, { x: 1, y: 0, z: 0 });
  assert.equal(near.ok, false);
  assert.match(near.reason, /MUITO PRÓXIMO/);
});

test('hitboxes: cabeça, corpo e pernas; agachar abaixa a cabeça', () => {
  const o = { x: 0, y: 0, z: 10 };
  const d = { x: 0, y: 0, z: -1 };
  assert.equal(rayVsPlayer({ ...o, y: 1.7 }, d, 50, 0, 0, 0, 1.8).zone, 'head');
  assert.equal(rayVsPlayer({ ...o, y: 1.2 }, d, 50, 0, 0, 0, 1.8).zone, 'body');
  assert.equal(rayVsPlayer({ ...o, y: 0.4 }, d, 50, 0, 0, 0, 1.8).zone, 'legs');
  assert.equal(rayVsPlayer({ ...o, x: 1, y: 1.2 }, d, 50, 0, 0, 0, 1.8), null);
  assert.equal(rayVsPlayer({ ...o, y: 1.7 }, d, 50, 0, 0, 0, 1.22), null, 'agachado: tiro na altura da cabeça em pé passa por cima');
});

test('armas: 3 tiros no corpo eliminam; dispersão cresce com o movimento', () => {
  const rifle = weaponBySlot(1);
  assert.ok(damageFor(rifle, 'body') * 3 >= 100 && damageFor(rifle, 'body') * 2 < 100);
  assert.ok(damageFor(rifle, 'head') >= 100);
  const st = (state, speed, crouching = false) => ({ state, speed, crouching });
  const v = [st('crouch', 0, true), st('idle', 0), st('walk', 2.7), st('run', 5.6), st('air', 5.6)].map((m) => computeSpread(rifle, m));
  for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1]);
});

test('validação: entrada maliciosa é saneada (NaN, infinitos, ângulos enormes, bits desconhecidos)', () => {
  const f = { mf: 5, mr: -9, btn: 0xffff, yaw: 1e30, pitch: NaN, slot: 7, dx: Infinity, dy: -Infinity, dz: NaN };
  sanitizeInput(f);
  assert.equal(f.mf, 1); assert.equal(f.mr, -1);
  assert.equal(f.btn, 255);
  assert.ok(f.yaw >= -Math.PI && f.yaw <= Math.PI);
  assert.equal(f.pitch, 0);
  assert.equal(f.slot, 1);
  for (const k of ['dx', 'dy', 'dz']) assert.ok(Number.isFinite(f[k]) && Math.abs(f[k]) <= 1);
});

test('validação: nomes, códigos de sala e opções de entrada', () => {
  assert.equal(sanitizeName('  Ana   Paula '), 'Ana Paula');
  assert.equal(sanitizeName('<script>'), 'script');
  assert.equal(sanitizeName('a'), null);
  assert.equal(sanitizeName('x'.repeat(30)), null);
  assert.equal(isValidRoomCode(normalizeRoomCode(' ab-cd2 ')), true);
  assert.equal(isValidRoomCode('ABC0O'), false);
  assert.throws(() => validateJoinOptions({ name: 'Ana', clientKey: 'abcdefgh12', protocol: 1 }), /incompatível/);
  assert.throws(() => validateJoinOptions({ name: '', clientKey: 'abcdefgh12', protocol: 2 }), /Nome inválido/);
  assert.deepEqual(validateJoinOptions({ name: 'Ana', clientKey: 'abcdefgh12', protocol: 2 }), { name: 'Ana', clientKey: 'abcdefgh12' });
});
