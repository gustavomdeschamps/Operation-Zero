// Névoa Ciano autoritativa: disponibilidade, ponto aprovado pelo servidor, duração e remoção.
import { SMOKE, computeSmokePlacement, smokeCenter } from '../../../shared/smoke-rules.js';
import { eyeHeight } from '../../../shared/movement.js';
import { MSG } from '../../../shared/protocol.js';
import { SmokeState } from '../schema/MatchState.js';

const MAX_ACTIVE_SMOKES = 8;

/** Tenta lançar a fumaça. Retorna { ok, reason?, point? }. */
export function tryAbility(room, rec, inp) {
  const s = rec.state;
  const reject = (reason) => { room.rejectAction(rec, 'ability', reason); return { ok: false, reason }; };
  if (!room.combatActive()) return reject('Habilidade indisponível agora');
  if (!s.alive) return reject('Eliminado');
  if (s.abilityCd > 0) return reject(`RECARGA ${Math.ceil(s.abilityCd)}s`);
  if (room.state.smokes.size + room.pendingSmokes.length >= MAX_ACTIVE_SMOKES) return reject('Limite de fumaças na arena');
  const eye = { x: rec.move.pos.x, y: rec.move.pos.y + eyeHeight(rec.move.height), z: rec.move.pos.z };
  const cp = Math.cos(inp.pitch);
  const dir = { x: -Math.sin(inp.yaw) * cp, y: Math.sin(inp.pitch), z: -Math.cos(inp.yaw) * cp };
  const placement = computeSmokePlacement(room.arena, eye, dir);
  if (!placement.ok) return reject(placement.reason);
  s.abilityCd = SMOKE.cooldown;
  const id = `s${++room.smokeCounter}`;
  room.pendingSmokes.push({ id, point: placement.point, delay: SMOKE.throwTime, team: s.team });
  room.broadcast(MSG.ABILITY, { id, s: rec.sid, f: [eye.x, eye.y - 0.25, eye.z].map(r3), t: [placement.point.x, placement.point.y, placement.point.z].map(r3) });
  return { ok: true, point: placement.point };
}

/** Avança lançamentos e nuvens ativas; remove as expiradas (duração em tempo de jogo). */
export function tickSmokes(room, dt) {
  for (let i = room.pendingSmokes.length - 1; i >= 0; i--) {
    const p = room.pendingSmokes[i];
    p.delay -= dt;
    if (p.delay <= 0) {
      const sm = new SmokeState();
      sm.x = p.point.x; sm.y = p.point.y; sm.z = p.point.z;
      sm.remaining = SMOKE.duration;
      sm.team = p.team;
      room.state.smokes.set(p.id, sm);
      room.pendingSmokes.splice(i, 1);
    }
  }
  const expired = [];
  room.state.smokes.forEach((sm, id) => {
    sm.remaining = Math.max(0, sm.remaining - dt);
    if (sm.remaining <= 0) expired.push(id);
  });
  for (const id of expired) room.state.smokes.delete(id);
}

/** Centros das nuvens ativas (para regras de visão). */
export function activeSmokeCenters(room) {
  const out = [];
  room.state.smokes.forEach((sm) => out.push(smokeCenter(sm)));
  return out;
}

export function clearSmokes(room) {
  room.pendingSmokes.length = 0;
  room.state.smokes.clear();
}

const r3 = (v) => Math.round(v * 1000) / 1000;
