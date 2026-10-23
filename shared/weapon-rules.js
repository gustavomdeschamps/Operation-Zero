// Regras das armas compartilhadas: dispersão, recuo e dano.
// O cliente usa para a mira/precisão; o servidor usa para validar e resolver disparos.
import { GAME } from './game-config.js';
import { lerp, invLerp } from './math.js';

export const WEAPONS = GAME.weapons;

export const weaponById = (id) => WEAPONS.find((w) => w.id === id) || null;

/**
 * Kit do jogador: slot 1 = arma primária escolhida (fuzil ou submetralhadora), slot 2 = pistola.
 * Retorna { 1: def, 2: def }. Identificadores inválidos caem no padrão (o servidor já valida antes).
 */
export function loadoutFor(primary = 'rifle') {
  const p = weaponById(primary);
  return { 1: p && p.slot === 1 ? p : weaponById('rifle'), 2: weaponById('pistol') };
}

/** Arma do slot para um kit (padrão: fuzil + pistola). */
export const weaponBySlot = (slot, primary = 'rifle') => loadoutFor(primary)[slot] || null;

/**
 * Dispersão (raio angular, rad) para um estado de movimento.
 * movement = { state, speed, crouching } (ver movementState em movement.js).
 */
export function computeSpread(def, movement, adsT = 0, bloom = 0, cfg = GAME.player) {
  const s = def.spread;
  let base;
  if (movement.state === 'air') base = s.air;
  else {
    base = movement.crouching ? s.crouch : s.idle;
    const sp = movement.speed;
    if (sp > 0.25) {
      base = sp <= cfg.walkSpeed
        ? lerp(base, movement.crouching ? s.walk * 0.7 : s.walk, invLerp(0.25, cfg.walkSpeed, sp))
        : lerp(s.walk, s.run, invLerp(cfg.walkSpeed, cfg.runSpeed, sp));
    }
  }
  return base * (1 - adsT * (1 - s.adsMultiplier)) + bloom;
}

/** Maior dispersão aceitável pelo servidor (sem ADS, com bloom máximo). */
export const maxSpreadFor = (def, movement) => computeSpread(def, movement, 0, def.spread.maxBloom);

/** Recuo [pitch, yaw] em graus do n-ésimo disparo da sequência (padrão determinístico). */
export function recoilKick(def, shotIndex) {
  const pat = def.recoil.pattern;
  const i = shotIndex;
  const idx = i < pat.length ? i : Math.max(0, pat.length - 8) + ((i - pat.length) % Math.min(8, pat.length));
  return pat[idx];
}

export const damageFor = (def, zone) => Math.round(def.damage * (def.multipliers[zone] ?? 1));
