// Simulação de movimento em primeira pessoa — função pura e determinística.
// Executada pelo cliente (treino offline e predição online) e pelo servidor (autoridade),
// com o mesmo passo fixo online, para que a reconciliação reproduza exatamente o servidor.
import { GAME } from './game-config.js';
import { damp } from './math.js';

const EPS = 1e-4;

/** Estado mínimo necessário para simular (e re-simular) um jogador. */
export function createMoveState(x = 0, y = 0, z = 0, cfg = GAME.player) {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    height: cfg.height,
    crouching: false,
    onGround: true,
    coyoteT: 0,
    jumpBufferT: 0,
  };
}

/** Comando de entrada de um passo. f/r ∈ {-1,0,1}; jump é a borda (pressionado neste passo). */
export function createCommand() {
  return { f: 0, r: 0, jump: false, crouch: false, walk: false, ads: 0, yaw: 0 };
}

export function copyMoveState(dst, src) {
  dst.pos.x = src.pos.x; dst.pos.y = src.pos.y; dst.pos.z = src.pos.z;
  dst.vel.x = src.vel.x; dst.vel.y = src.vel.y; dst.vel.z = src.vel.z;
  dst.height = src.height; dst.crouching = src.crouching; dst.onGround = src.onGround;
  dst.coyoteT = src.coyoteT; dst.jumpBufferT = src.jumpBufferT;
  return dst;
}

const near = [];
const result = { jumped: false, landed: false, fallSpeed: 0, stepUp: 0, stepDown: 0, horizontalSpeed: 0, fellOut: false };

function gatherNear(s, arena, cfg, mx, my, mz) {
  const p = s.pos, r = cfg.radius + 1.0;
  const minX = p.x - r + Math.min(0, mx), maxX = p.x + r + Math.max(0, mx);
  const minY = p.y - 1.0 + Math.min(0, my), maxY = p.y + cfg.height + 1.0 + Math.max(0, my);
  const minZ = p.z - r + Math.min(0, mz), maxZ = p.z + r + Math.max(0, mz);
  near.length = 0;
  const cs = arena.colliders;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.max.x < minX || c.min.x > maxX || c.max.y < minY || c.min.y > maxY || c.max.z < minZ || c.min.z > maxZ) continue;
    near.push(c);
  }
}

function overlaps(c, x, y, z, h, r) {
  return x - r < c.max.x - EPS && x + r > c.min.x + EPS &&
         y < c.max.y - EPS && y + h > c.min.y + EPS &&
         z - r < c.max.z - EPS && z + r > c.min.z + EPS;
}

function overlapsAny(x, y, z, h, r) {
  for (let i = 0; i < near.length; i++) if (overlaps(near[i], x, y, z, h, r)) return true;
  return false;
}

/** O jogador cabe com a altura h na posição atual? (teto ao levantar/pular) */
export function canStandTo(s, h, arena, cfg = GAME.player) {
  gatherNear(s, arena, cfg, 0, 0, 0);
  return !overlapsAny(s.pos.x, s.pos.y, s.pos.z, h, cfg.radius);
}

function moveAxis(s, axis, delta, cfg, ctx) {
  const p = s.pos;
  const r = cfg.radius;
  const h = s.height;
  p[axis] += delta;
  for (let i = 0; i < near.length; i++) {
    const c = near[i];
    if (!overlaps(c, p.x, p.y, p.z, h, r)) continue;
    if (axis === 'y') {
      if (delta <= 0) { p.y = c.max.y; s.vel.y = 0; ctx.grounded = true; }
      else { p.y = c.min.y - h - EPS; s.vel.y = 0; }
      continue;
    }
    const stepUp = c.max.y - p.y;
    if (ctx.canStep && stepUp > 0 && stepUp <= cfg.stepHeight && !overlapsAny(p.x, c.max.y + EPS, p.z, h, r)) {
      result.stepUp += stepUp;
      p.y = c.max.y;
      continue;
    }
    p[axis] = delta > 0 ? c.min[axis] - r - EPS * 2 : c.max[axis] + r + EPS * 2;
    s.vel[axis] = 0;
  }
}

function groundBelow(s, maxDrop, cfg) {
  const p = s.pos, r = cfg.radius;
  let best = null;
  for (let i = 0; i < near.length; i++) {
    const c = near[i];
    if (p.x - r >= c.max.x || p.x + r <= c.min.x || p.z - r >= c.max.z || p.z + r <= c.min.z) continue;
    const top = c.max.y;
    if (top <= p.y + EPS && top >= p.y - maxDrop && (best === null || top > best)) best = top;
  }
  return best;
}

const ctx = { grounded: false, canStep: false };

/**
 * Avança o estado `s` em `dt` segundos aplicando o comando `cmd`.
 * Retorna um objeto de resultado REUTILIZADO (leia antes da próxima chamada).
 */
export function stepMovement(s, cmd, dt, arena, cfg = GAME.player) {
  result.jumped = false; result.landed = false; result.stepUp = 0; result.stepDown = 0; result.fellOut = false;

  // ---- agachamento (com checagem de teto ao levantar)
  if (cmd.crouch) s.crouching = true;
  else if (s.crouching && canStandTo(s, cfg.height, arena, cfg)) s.crouching = false;
  const targetH = s.crouching ? cfg.crouchHeight : cfg.height;
  const newH = damp(s.height, targetH, cfg.crouchLerp, dt);
  if (newH < s.height || canStandTo(s, newH, arena, cfg)) s.height = Math.abs(newH - targetH) < 0.002 ? targetH : newH;

  // ---- direção desejada (diagonal normalizada)
  const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
  let wx = -sin * cmd.f + cos * cmd.r;
  let wz = -cos * cmd.f - sin * cmd.r;
  const wishLen = Math.hypot(wx, wz);
  if (wishLen > 0) { wx /= wishLen; wz /= wishLen; }
  let maxSpeed = s.crouching ? cfg.crouchSpeed : cmd.walk ? cfg.walkSpeed : cfg.runSpeed;
  maxSpeed *= 1 - cmd.ads * (1 - cfg.adsSpeedMultiplier);

  // ---- aceleração / desaceleração
  const v = s.vel;
  if (s.onGround) {
    let dx = wx * maxSpeed - v.x, dz = wz * maxSpeed - v.z;
    const dLen = Math.hypot(dx, dz);
    const maxStep = (wishLen > 0 ? cfg.groundAccel : cfg.groundDecel) * dt;
    if (dLen > maxStep) { dx *= maxStep / dLen; dz *= maxStep / dLen; }
    v.x += dx; v.z += dz;
  } else if (wishLen > 0) {
    const before = Math.hypot(v.x, v.z);
    v.x += wx * cfg.airAccel * dt;
    v.z += wz * cfg.airAccel * dt;
    const after = Math.hypot(v.x, v.z);
    const cap = Math.max(before, maxSpeed);
    if (after > cap) { v.x *= cap / after; v.z *= cap / after; }
  }

  // ---- pulo (buffer + coyote time)
  s.jumpBufferT = cmd.jump ? cfg.jumpBuffer : Math.max(0, s.jumpBufferT - dt);
  s.coyoteT = s.onGround ? cfg.coyoteTime : Math.max(0, s.coyoteT - dt);
  if (s.jumpBufferT > 0 && s.coyoteT > 0 && canStandTo(s, s.height + 0.05, arena, cfg)) {
    v.y = cfg.jumpVelocity;
    s.jumpBufferT = 0;
    s.coyoteT = 0;
    result.jumped = true;
  }

  // ---- gravidade
  v.y -= cfg.gravity * dt;
  const wasOnGround = s.onGround && !result.jumped;
  result.fallSpeed = v.y;

  // ---- movimento com sub-passos (evita atravessar paredes)
  const mx = v.x * dt, my = v.y * dt, mz = v.z * dt;
  gatherNear(s, arena, cfg, mx, my, mz);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my), Math.abs(mz)) / 0.12));
  ctx.grounded = false;
  ctx.canStep = wasOnGround;
  for (let i = 0; i < steps; i++) {
    if (mx) moveAxis(s, 'x', mx / steps, cfg, ctx);
    if (mz) moveAxis(s, 'z', mz / steps, cfg, ctx);
    moveAxis(s, 'y', (v.y * dt) / steps, cfg, ctx);
  }

  // ---- aderência ao descer degraus
  if (!ctx.grounded && wasOnGround && v.y <= 0) {
    const top = groundBelow(s, cfg.stepHeight, cfg);
    if (top !== null) {
      result.stepDown = s.pos.y - top;
      s.pos.y = top;
      v.y = 0;
      ctx.grounded = true;
    }
  }
  result.landed = ctx.grounded && !s.onGround;
  s.onGround = ctx.grounded;

  // ---- limites da arena e plano de queda
  arena.clampToBounds(s.pos, cfg.radius);
  if (s.pos.y < cfg.killPlaneY) result.fellOut = true;
  result.horizontalSpeed = Math.hypot(v.x, v.z);
  return result;
}

/** Estado de movimento (usado pela dispersão das armas, HUD e animação). */
export function movementState(s, cfg = GAME.player) {
  const speed = Math.hypot(s.vel.x, s.vel.z);
  let state;
  if (!s.onGround) state = 'air';
  else if (s.crouching) state = speed > 0.4 ? 'crouch-move' : 'crouch';
  else if (speed < 0.3) state = 'idle';
  else if (speed <= cfg.walkSpeed + 0.35) state = 'walk';
  else state = 'run';
  return { state, speed, crouching: s.crouching, onGround: s.onGround };
}

export const MOVE_STATES = ['idle', 'walk', 'run', 'air', 'crouch', 'crouch-move'];

export const eyeHeight = (height, cfg = GAME.player) => height - cfg.eyeFromTop;
