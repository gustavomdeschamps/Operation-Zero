// Hitboxes dos jogadores (cabeça, corpo, pernas) — as MESMAS no cliente, no servidor e nos bots.
//
// Convenção espacial (metros; Y para cima; yaw 0 olha para -Z):
//   pés em (x, y, z) · altura atual h (1,80 em pé, 1,22 agachado) · olhos em h - 0,13.
//   frente F = (-sin yaw, 0, -cos yaw) · direita R = (cos yaw, 0, -sin yaw).
//
// As caixas são independentes da malha gráfica, mas seguem a POSTURA que a animação produz
// (medida nos modelos animados — ver NEXT_GEN_AUDIT.md): agachado, a cabeça vai ~0,25 m à frente e
// ~0,19 m para a direita (ombro esquerdo à frente); correndo, ~0,19 m à frente e 0,11 m mais baixa;
// mirando para baixo, ela inclina para a frente. Assim a cabeça visual e a hitbox coincidem.
import { rayAABB } from './math.js';

export const HITBOX = {
  standHeight: 1.8,
  crouchHeight: 1.22,
  head: { half: 0.16, top: 0.03, size: 0.32 },   // relativo ao topo da cabeça
  body: { half: 0.27, legsRatio: 0.47 },
  legs: { half: 0.2 },
  pose: { crouchForward: 0.25, crouchSide: 0.19, runForward: 0.19, runDrop: 0.11, crouchWalkDrop: 0.07, pitchLean: 0.15 },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Deslocamento da cabeça pela postura. pose = { yaw, pitch, vx, vz } (ausente → em pé, parado).
 * Retorna { fwd, side, drop } em metros.
 */
export function headOffset(h, pose, out = { fwd: 0, side: 0, drop: 0 }) {
  const P = HITBOX.pose;
  const c = clamp01((HITBOX.standHeight - h) / (HITBOX.standHeight - HITBOX.crouchHeight));
  const speed = pose ? Math.hypot(pose.vx || 0, pose.vz || 0) : 0;
  const run = clamp01((speed - 3) / 2.5) * (1 - c);
  const pitch = pose ? Math.max(-0.6, Math.min(0.6, pose.pitch || 0)) : 0;
  out.fwd = P.crouchForward * c + P.runForward * run - pitch * P.pitchLean;
  out.side = P.crouchSide * c;
  out.drop = P.runDrop * run + P.crouchWalkDrop * c * clamp01(speed / 2);
  return out;
}

const _off = { fwd: 0, side: 0, drop: 0 };

/** Preenche `out` com as três caixas do jogador (pés em x,y,z; altura h; postura opcional). */
export function playerHitboxes(x, y, z, h, out = createHitboxSet(), pose = null) {
  const yaw = pose ? pose.yaw || 0 : 0;
  headOffset(h, pose, _off);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const hx = x + fx * _off.fwd + rx * _off.side, hz = z + fz * _off.fwd + rz * _off.side;
  const top = y + h - _off.drop;
  const headBottom = top - (HITBOX.head.size - HITBOX.head.top);
  const legsTop = y + h * HITBOX.body.legsRatio;
  setBox(out[0], hx, hz, HITBOX.head.half, headBottom, top + HITBOX.head.top);
  // o tronco acompanha metade do deslocamento da cabeça (inclinação a partir do quadril)
  setBox(out[1], x + (hx - x) * 0.5, z + (hz - z) * 0.5, HITBOX.body.half, legsTop, headBottom);
  setBox(out[2], x, z, HITBOX.legs.half, y, legsTop);
  return out;
}

export function createHitboxSet() {
  return ['head', 'body', 'legs'].map((zone) => ({ zone, min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }));
}

function setBox(b, x, z, half, y0, y1) {
  b.min.x = x - half; b.min.y = y0; b.min.z = z - half;
  b.max.x = x + half; b.max.y = y1; b.max.z = z + half;
}

const scratch = createHitboxSet();
const n = { x: 0, y: 0, z: 0 };
/** Raio contra um jogador. Retorna { t, zone } do acerto mais próximo ou null. */
export function rayVsPlayer(origin, dir, maxDist, x, y, z, h, pose = null) {
  playerHitboxes(x, y, z, h, scratch, pose);
  let best = maxDist, zone = null;
  for (const b of scratch) {
    const t = rayAABB(origin, dir, b.min, b.max, best, n);
    if (t >= 0 && t < best) { best = t; zone = b.zone; }
  }
  return zone ? { t: best, zone } : null;
}
