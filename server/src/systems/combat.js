// Combate autoritativo: armas (munição, recarga, troca, cadência), validação de disparos,
// resolução com compensação de latência, dano, eliminação e placar.
import { GAME } from '../../../shared/game-config.js';
import { loadoutFor, maxSpreadFor, damageFor } from '../../../shared/weapon-rules.js';
import { rayVsPlayer } from '../../../shared/hitboxes.js';
import { movementState, eyeHeight } from '../../../shared/movement.js';
import { BTN, MSG } from '../../../shared/protocol.js';

const SWITCH_TIME = 0.36;          // igual à animação de troca do cliente
const SWITCH_SWAP = 0.5;           // a arma troca na metade da animação
const EPS = 1e-6;

/** Arma atualmente empunhada (do kit do jogador). */
export const currentWeapon = (rec) => rec.loadout[rec.slot];

/** Munição e estado de arma iniciais (respawn / nova rodada). Aplica o kit escolhido (rec.primary). */
export function resetLoadout(rec) {
  rec.loadout = loadoutFor(rec.primary);
  if (rec.state) rec.state.primary = rec.loadout[1].id;
  rec.ammo = new Map([1, 2].map((slot) => [slot, { mag: rec.loadout[slot].magSize, reserve: rec.loadout[slot].reserve }]));
  rec.slot = 1;
  rec.reloadEnd = -1;
  rec.switchStart = -1;
  rec.switchTarget = 1;
  rec.nextFire = rec.simTime;
  rec.bloom = 0;
  rec.lastShotTime = -10;
  rec.autoReloadAt = -1;
  syncWeaponState(rec);
}

export function syncWeaponState(rec) {
  const a = rec.ammo.get(rec.slot);
  const s = rec.state;
  s.slot = rec.slot;
  s.mag = a.mag;
  s.reserve = a.reserve;
  s.reloading = rec.reloadEnd >= 0;
  s.switching = rec.switchStart >= 0;
}

const forwardFrom = (yaw, pitch, out) => {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp; out.y = Math.sin(pitch); out.z = -Math.cos(yaw) * cp;
  return out;
};

/**
 * Processa as ações de arma de um quadro de entrada (já depois do movimento do mesmo quadro).
 * A ordem espelha WeaponSystem.update do cliente: troca → recarga → disparo.
 */
export function handleWeaponInput(room, rec, inp, dt) {
  const t = rec.simTime;

  // troca de arma (cancela recarga em andamento e a recarga automática)
  if (inp.slot !== rec.slot && rec.switchStart < 0 && rec.state.alive) {
    rec.reloadEnd = -1;
    rec.autoReloadAt = -1;
    rec.switchStart = t;
    rec.switchTarget = inp.slot;
  }
  if (rec.switchStart >= 0) {
    const p = (t - rec.switchStart) / SWITCH_TIME;
    if (p >= SWITCH_SWAP && rec.slot !== rec.switchTarget) { rec.slot = rec.switchTarget; rec.bloom = 0; }
    if (p >= 1) rec.switchStart = -1;
  }

  // recarga (não duplica; conclui pelo relógio de simulação do jogador)
  const ammo = rec.ammo.get(rec.slot);
  const cur = currentWeapon(rec);
  if (rec.autoReloadAt >= 0 && t + EPS >= rec.autoReloadAt) { rec.autoReloadAt = -1; if (rec.switchStart < 0) startReload(rec, cur); }
  if ((inp.btn & BTN.RELOAD) && rec.reloadEnd < 0 && rec.switchStart < 0) startReload(rec, cur);
  if (rec.reloadEnd >= 0 && t + EPS >= rec.reloadEnd) {
    const take = Math.min(cur.magSize - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    rec.reloadEnd = -1;
  }

  // recuperação da dispersão (espelha o cliente)
  const since = t - rec.lastShotTime;
  if (since > 0.12) rec.bloom = Math.max(0, rec.bloom - cur.spread.bloomRecovery * dt);
  if (since > cur.spread.firstShotGrace) rec.bloom = 0;

  if (inp.btn & BTN.FIRE) tryFire(room, rec, inp, dt);
  syncWeaponState(rec);
}

export function startReload(rec, def = currentWeapon(rec)) {
  const ammo = rec.ammo.get(rec.slot);
  rec.autoReloadAt = -1;
  if (rec.reloadEnd >= 0 || ammo.mag >= def.magSize || ammo.reserve <= 0) return false;
  rec.reloadEnd = rec.simTime + def.reloadTime;
  return true;
}

const _origin = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };
const _fwd = { x: 0, y: 0, z: 0 };

/** Valida e resolve um disparo. Retorna { ok, reason?, hit? } (útil para testes). */
export function tryFire(room, rec, inp, dt) {
  const s = rec.state;
  const def = currentWeapon(rec);
  const ammo = rec.ammo.get(rec.slot);
  const t = rec.simTime;
  const reject = (reason) => { room.rejectAction(rec, 'fire', reason); return { ok: false, reason }; };

  if (!room.combatActive()) return reject('combate inativo');
  if (!s.alive) return reject('eliminado');
  if (rec.reloadEnd >= 0) return reject('recarregando');
  if (rec.switchStart >= 0) return reject('trocando de arma');
  if (ammo.mag <= 0) {
    if (ammo.reserve > 0) startReload(rec, def);
    return reject('sem munição');
  }
  // cadência — mesma aritmética do cliente (WeaponSystem.update)
  if (rec.nextFire < t - dt) rec.nextFire = t - dt;
  if (t + dt * 0.25 < rec.nextFire) return reject('cadência');

  // direção: unitária e dentro do cone de dispersão permitido em torno da mira
  const len = Math.hypot(inp.dx, inp.dy, inp.dz);
  if (!(len > 0.5 && len < 1.5)) return reject('direção inválida');
  _dir.x = inp.dx / len; _dir.y = inp.dy / len; _dir.z = inp.dz / len;
  forwardFrom(inp.yaw, inp.pitch, _fwd);
  const cos = _dir.x * _fwd.x + _dir.y * _fwd.y + _dir.z * _fwd.z;
  const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
  const allowed = maxSpreadFor(def, movementState(rec.move)) + GAME.net.maxShotAngleSlack;
  if (angle > allowed) return reject('fora do cone de precisão');

  // aceito: consome munição e avança a cadência
  ammo.mag -= 1;
  rec.nextFire += 1 / def.fireRate;
  rec.lastShotTime = t;
  rec.bloom = Math.min(def.spread.maxBloom, rec.bloom + def.spread.perShot);
  if (s.shielded) { s.shielded = false; rec.protectedT = 0; } // atirar encerra a proteção de surgimento
  if (ammo.mag === 0 && ammo.reserve > 0) rec.autoReloadAt = t + 0.3;

  // origem: olho autoritativo do atirador
  _origin.x = rec.move.pos.x; _origin.y = rec.move.pos.y + eyeHeight(rec.move.height); _origin.z = rec.move.pos.z;
  const hit = resolveShot(room, rec, _origin, _dir, def);
  room.broadcastShot(rec, _origin, hit);
  return { ok: true, hit };
}

/**
 * Raio contra a arena e contra os jogadores na posição em que o atirador os VIU
 * (histórico limitado pelo Rewind — maxRewindMs). O alvo mais próximo vence; paredes bloqueiam.
 */
export function resolveShot(room, shooter, origin, dir, def) {
  const world = room.arena.raycast(origin, dir, def.range, {});
  let best = world ? world.distance : def.range;
  let target = null, zone = null;
  for (const rec of room.records.values()) {
    if (rec === shooter || !rec.state.alive || !rec.state.connected) continue;
    if (!room.canDamage(shooter, rec)) continue;
    const seen = room.seenPosition(shooter, rec);
    const h = rayVsPlayer(origin, dir, best, seen.x, seen.y, seen.z, seen.h, seen.pose);
    if (h && h.t < best) { best = h.t; target = rec; zone = h.zone; }
  }
  const end = { x: origin.x + dir.x * best, y: origin.y + dir.y * best, z: origin.z + dir.z * best };
  if (target) {
    const amount = damageFor(def, zone);
    const res = applyDamage(room, shooter, target, amount, zone, def.id);
    return { kind: 'player', end, target: target.sid, zone, amount, killed: res.killed };
  }
  return { kind: world ? 'world' : 'none', end, surface: world?.surface };
}

/** Aplica dano autoritativo. A eliminação acontece uma única vez (transição alive → false). */
export function applyDamage(room, attacker, target, amount, zone, weaponId) {
  const s = target.state;
  if (!s.alive || s.shielded) return { applied: 0, killed: false };
  const applied = Math.min(s.hp, Math.max(0, Math.round(amount)));
  s.hp -= applied;
  target.lastDamageTime = target.simTime;
  if (room.bots) room.bots.damaged(target, attacker);
  room.sendTo(attacker, MSG.HIT, { t: target.sid, z: zone, d: applied, k: s.hp <= 0 });
  room.sendTo(target, MSG.DAMAGED, { a: attacker.sid, d: applied, x: round2(attacker.move.pos.x), y: round2(attacker.move.pos.y + 1.4), z: round2(attacker.move.pos.z) });
  if (s.hp <= 0) {
    killPlayer(room, target, attacker, zone === 'head', weaponId);
    return { applied, killed: true };
  }
  return { applied, killed: false };
}

export function killPlayer(room, victim, killer, headshot, weaponId) {
  const v = victim.state;
  if (!v.alive) return false;
  v.alive = false;
  v.hp = 0;
  v.deaths += 1;
  v.action = 0;
  victim.reloadEnd = -1;
  if (killer && killer !== victim) {
    if (killer.matchStats) {
      if (victim.bot) killer.matchStats.botKills += 1;
      if (headshot) killer.matchStats.headshots += 1;
    }
    killer.state.kills += 1;
    killer.state.score += headshot ? 150 : 100;
  }
  room.broadcastKill(killer, victim, headshot, weaponId);
  room.mode.onKill(room, killer, victim);
  return true;
}

/** Regeneração de vida (apenas modos que a permitem). */
export function updateRegen(rec, dt) {
  const s = rec.state;
  const cfg = GAME.player;
  if (s.alive && s.hp < cfg.maxHealth && rec.simTime - rec.lastDamageTime > cfg.regenDelay) {
    rec.regenAcc += cfg.regenRate * dt;
    const whole = Math.floor(rec.regenAcc);
    if (whole > 0) { s.hp = Math.min(cfg.maxHealth, s.hp + whole); rec.regenAcc -= whole; }
  }
}

const round2 = (v) => Math.round(v * 100) / 100;
