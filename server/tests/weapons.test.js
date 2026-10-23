// LR-12 SENTINELA (fuzil de precisão) validado pelo servidor e acabamentos (skins) sem efeito nos
// atributos: dano, cadência, munição, cone de dispersão e hitboxes são os mesmos com ou sem skin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestRoom, addPlayer, placeAlive, startLive, frame, aim, chestOf, headOf, tick, push, TEAM } from './helpers.js';
import { BTN } from '../../shared/protocol.js';
import { resetLoadout, currentWeapon } from '../src/systems/combat.js';
import { validateLoadout } from '../src/services/validation.js';
import { weaponById, maxSpreadFor, damageFor } from '../../shared/weapon-rules.js';
import { PRIMARY_WEAPONS } from '../../shared/catalog.js';
import { SKINS, SKINNABLE_WEAPONS, encodeEquipped, decodeEquipped, ALL_ITEMS } from '../../shared/skins.js';
import { BOT_FILL } from '../src/ai/bot-config.js';

function duel(primary = 'sniper', skins = '') {
  const room = createTestRoom('tdm');
  const a = addPlayer(room, { name: 'Ana', team: TEAM.ALFA });
  const b = addPlayer(room, { name: 'Bia', team: TEAM.OMEGA });
  a.primary = primary;
  resetLoadout(a);
  a.state.skins = skins;
  startLive(room);
  placeAlive(room, a, 0, 22);
  placeAlive(room, b, 0, 14);
  return { room, a, b };
}
const fireAt = (shooter, point, extra = {}) => { const d = aim(shooter, point); return frame({ btn: BTN.FIRE | BTN.ADS, yaw: d.yaw, pitch: d.pitch, dx: d.dx, dy: d.dy, dz: d.dz, ...extra }); };

test('W1 — LR-12: arma primária válida, 5 tiros, dano 85 no tronco e eliminação com tiro na cabeça', () => {
  assert.ok(PRIMARY_WEAPONS.includes('sniper'));
  assert.equal(validateLoadout({ operator: 'gaviao', primary: 'sniper' }).primary, 'sniper');
  const { room, a, b } = duel();
  assert.equal(currentWeapon(a).id, 'sniper');
  assert.equal(a.ammo.get(1).mag, 5);
  push(room, a, fireAt(a, chestOf(b)));
  tick(room);
  assert.equal(b.state.hp, 15, 'tronco: 85 de dano');
  assert.equal(a.ammo.get(1).mag, 4);
  const { room: r2, a: a2, b: b2 } = duel();
  push(r2, a2, fireAt(a2, headOf(b2)));
  tick(r2);
  assert.equal(b2.state.alive, false, 'cabeça: eliminação com um disparo');
});

test('W2 — LR-12: ferrolho limita a cadência no servidor (segundo tiro imediato é recusado)', () => {
  const { room, a, b } = duel();
  push(room, a, fireAt(a, chestOf(b)));
  tick(room);
  for (let i = 0; i < 20; i++) { push(room, a, fireAt(a, chestOf(b))); tick(room); }
  assert.equal(a.ammo.get(1).mag, 4, 'nenhum disparo extra antes do ciclo do ferrolho (~1,05 s)');
  for (let i = 0; i < 50; i++) { push(room, a, frame({ yaw: a.state.yaw })); tick(room); }
  push(room, a, fireAt(a, legsOf(b)));
  tick(room);
  assert.equal(a.ammo.get(1).mag, 3, 'após o ciclo o disparo é aceito');
});
const legsOf = (rec) => ({ x: rec.move.pos.x, y: rec.move.pos.y + 0.4, z: rec.move.pos.z });

test('W3 — LR-12: direção fora do cone de dispersão (mesmo largo sem mirar) é recusada', () => {
  const { room, a, b } = duel();
  const d = aim(a, chestOf(b));
  const off = 0.2; // rad, maior que a dispersão máxima permitida
  push(room, a, frame({ btn: BTN.FIRE, yaw: d.yaw, pitch: d.pitch, dx: Math.sin(-d.yaw - off) * -1, dy: d.dy, dz: -Math.cos(d.yaw + off) }));
  tick(room);
  assert.equal(b.state.hp, 100);
  assert.equal(a.ammo.get(1).mag, 5, 'rejeitado sem consumir munição');
  assert.ok(maxSpreadFor(weaponById('sniper'), { state: 'idle', speed: 0, crouching: false }) < off);
});

test('W4 — bots não usam o fuzil de precisão', () => {
  const room = createTestRoom('tdm');
  addPlayer(room, { name: 'Pessoa' });
  for (let i = 0; i < BOT_FILL.maxPrivateBots; i++) room.bots.add();
  for (const r of room.records.values()) if (r.bot) assert.notEqual(r.primary, 'sniper');
});

test('W5 — acabamentos não alteram atributos: mesmo dano, munição e resultado com ou sem skin', () => {
  for (const weapon of ['rifle', 'smg', 'sniper']) {
    const plain = duel(weapon, '');
    const skinned = duel(weapon, encodeEquipped({ [weapon]: 'circuito', pistol: 'cobre' }));
    for (const d of [plain, skinned]) { push(d.room, d.a, fireAt(d.a, chestOf(d.b))); tick(d.room); }
    assert.equal(plain.b.state.hp, skinned.b.state.hp, `${weapon}: dano idêntico`);
    assert.equal(plain.a.ammo.get(1).mag, skinned.a.ammo.get(1).mag);
    assert.deepEqual(currentWeapon(plain.a), currentWeapon(skinned.a), 'definição da arma idêntica');
  }
  // o catálogo de skins não tem nenhum campo de atributo
  for (const s of SKINS) for (const k of ['damage', 'fireRate', 'spread', 'recoil', 'magSize', 'range', 'multipliers']) assert.equal(s[k], undefined);
  assert.equal(ALL_ITEMS.length, SKINS.length * SKINNABLE_WEAPONS.length);
  assert.deepEqual(decodeEquipped('rifle=circuito;smg=ouro;bazuca=cobre'), { rifle: 'circuito' }, 'valores desconhecidos são ignorados');
  assert.equal(damageFor(weaponById('sniper'), 'legs'), 68);
});
