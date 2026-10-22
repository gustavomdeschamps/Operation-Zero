// Regras da Névoa Ciano: validação do ponto de lançamento e bloqueio de visão.
// Usadas pela habilidade offline e pelo servidor (que aprova o ponto e controla a duração).
import { GAME } from './game-config.js';
import { segmentIntersectsSphere, clamp } from './math.js';

export const SMOKE = GAME.abilities.smoke;

/**
 * Calcula onde a fumaça assenta a partir do olho e da direção da mira.
 * Retorna { ok:true, point:{x,y,z} } ou { ok:false, reason }.
 */
export function computeSmokePlacement(arena, eye, dir, cfg = SMOKE) {
  const hit = arena.raycast(eye, dir, cfg.maxRange, {});
  const dist = hit ? hit.distance - cfg.wallOffset : cfg.maxRange;
  if (dist < cfg.minRange) return { ok: false, reason: 'LOCAL INVÁLIDO — MUITO PRÓXIMO' };
  const tx = eye.x + dir.x * dist, ty = eye.y + dir.y * dist, tz = eye.z + dir.z * dist;
  if (!arena.inBounds(tx, tz, 0.5)) return { ok: false, reason: 'LOCAL INVÁLIDO — FORA DA ARENA' };
  const ground = arena.groundHeight(tx, tz, ty + 0.05, 0.25);
  const target = { x: tx, y: ty, z: tz };
  const low = { x: tx, y: ground + 0.3, z: tz };
  if (target.y - low.y > 0.05 && arena.segmentBlocked(target, low)) return { ok: false, reason: 'LOCAL INVÁLIDO — OBSTRUÍDO' };
  if (arena.overlapsSolid({ x: tx - 0.25, y: ground + 0.02, z: tz - 0.25 }, { x: tx + 0.25, y: ground + 0.6, z: tz + 0.25 })) {
    return { ok: false, reason: 'LOCAL INVÁLIDO — OBSTRUÍDO' };
  }
  return { ok: true, point: { x: tx, y: ground, z: tz } };
}

/** Centro volumétrico da nuvem para testes de linha de visão. */
export const smokeCenter = (p, cfg = SMOKE) => ({ x: p.x, y: p.y + cfg.height * 0.45, z: p.z });

/** O segmento a→b atravessa alguma das nuvens (lista de centros) com densidade suficiente? */
export function smokeBlocksSegment(centers, a, b, cfg = SMOKE) {
  for (const c of centers) if (segmentIntersectsSphere(a, b, c, cfg.radius * 0.85)) return true;
  return false;
}

/** Imersão (0..1) de um ponto numa nuvem: 1 no centro, 0 na borda. */
export function smokeImmersion(center, point, cfg = SMOKE) {
  const d = Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z) / (cfg.radius * 0.95);
  return clamp(1 - d, 0, 1);
}
