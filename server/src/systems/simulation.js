// Simulação autoritativa por jogador: consome os quadros de entrada (com orçamento anti-aceleração),
// aplica o movimento compartilhado e dispara as ações (armas, habilidade, interação).
import { GAME } from '../../../shared/game-config.js';
import { stepMovement, movementState, MOVE_STATES } from '../../../shared/movement.js';
import { BTN } from '../../../shared/protocol.js';
import { handleWeaponInput, updateRegen } from './combat.js';
import { tryAbility } from './abilities.js';
import { sanitizeInput } from '../services/validation.js';

const IDLE_INPUT = Object.freeze({ mf: 0, mr: 0, btn: 0, yaw: 0, pitch: 0, slot: 1, dx: 0, dy: 0, dz: -1 });

/**
 * Um passo fixo para todos os jogadores. Cada entrada recebida corresponde a exatamente um passo
 * de 1/tickRate do cliente. O orçamento impede que um cliente avance mais rápido que o tempo real
 * (envio acelerado de entradas = "speed hack"), mas tolera rajadas curtas após oscilação de rede.
 */
export function tickPlayers(room, ctx) {
  const dt = ctx.dt;
  const now = Date.now();
  const maxBudget = 1 + GAME.net.maxInputBurst;
  for (const rec of room.records.values()) {
    rec.budget = Math.min(maxBudget, rec.budget + 1);
    if (!rec.state.connected) continue;
    if (rec.bot) {
      // bot: o quadro vem da IA do servidor e passa pela mesma física, armas e validação
      const inp = room.bots.input(rec, dt);
      sanitizeInput(inp);
      processInput(room, rec, inp, dt, false);
      tickTimers(room, rec, dt);
      continue;
    }
    let processed = 0;
    const channel = room.inputs.get(rec.sid);
    // checa o orçamento ANTES de consumir: um quadro consumido é confirmado (ack) ao cliente,
    // então nunca pode ser retirado do buffer sem ser simulado
    while (rec.budget >= 1) {
      const inp = channel.next();
      if (!inp) break;
      rec.budget -= 1;
      processInput(room, rec, inp, dt, false);
      processed++;
    }
    if (processed > 0) rec.lastInputAt = now;
    else if (now - rec.lastInputAt > GAME.net.idleAfterMs) {
      // sem entradas: o mundo continua (gravidade), mas nenhuma ação é executada
      processInput(room, rec, idleFor(rec), dt, true);
    }
    tickTimers(room, rec, dt);
  }
}

/** Quadro neutro: mantém mira e agachamento/caminhada, sem deslocamento nem ações (bordas). */
function idleFor(rec) {
  return { ...IDLE_INPUT, yaw: rec.state.yaw, pitch: rec.state.pitch, slot: rec.slot, btn: rec.lastHeldBtn };
}

const cmd = { f: 0, r: 0, jump: false, crouch: false, walk: false, ads: 0, yaw: 0 };

export function processInput(room, rec, inp, dt, idle) {
  const s = rec.state;
  if (!idle) {
    rec.simTime += dt;
    rec.lastHeldBtn = inp.btn & (BTN.CROUCH | BTN.WALK);
    // tempo jogando de fato (para recompensas: ficar parado/ausente não rende créditos)
    if (rec.matchStats && s.alive && (inp.mf || inp.mr || (inp.btn & (BTN.FIRE | BTN.JUMP | BTN.INTERACT)))) rec.matchStats.active += dt;
  }
  const canMove = s.alive && room.movementAllowed(rec);
  cmd.f = canMove ? inp.mf : 0;
  cmd.r = canMove ? inp.mr : 0;
  cmd.jump = canMove && (inp.btn & BTN.JUMP) !== 0;
  cmd.crouch = s.alive && (inp.btn & BTN.CROUCH) !== 0;
  cmd.walk = (inp.btn & BTN.WALK) !== 0;
  cmd.ads = s.alive && (inp.btn & BTN.ADS) !== 0 ? 1 : 0;
  cmd.yaw = inp.yaw;

  if (s.alive) {
    const res = stepMovement(rec.move, cmd, dt, room.arena);
    if (res.fellOut) room.respawn(rec);
  }
  s.yaw = inp.yaw;
  s.pitch = inp.pitch;
  writeMoveState(rec);
  if (idle || !s.alive) return;

  handleWeaponInput(room, rec, inp, dt);
  if (inp.btn & BTN.ABILITY) tryAbility(room, rec, inp);
  rec.interacting = (inp.btn & BTN.INTERACT) !== 0;
}

/** Copia o estado de movimento para o Schema (replicado; usado na reconciliação do dono). */
export function writeMoveState(rec) {
  const m = rec.move, s = rec.state;
  s.x = m.pos.x; s.y = m.pos.y; s.z = m.pos.z;
  s.vx = m.vel.x; s.vy = m.vel.y; s.vz = m.vel.z;
  s.h = m.height; s.crouch = m.crouching; s.ground = m.onGround;
  s.coyote = m.coyoteT; s.jbuf = m.jumpBufferT;
  s.move = MOVE_STATES.indexOf(movementState(m).state);
}

/** Temporizadores por jogador em tempo de jogo: recarga de habilidade, proteção, regeneração, munição. */
function tickTimers(room, rec, dt) {
  const s = rec.state;
  if (s.abilityCd > 0) s.abilityCd = Math.max(0, s.abilityCd - dt);
  if (s.shielded) {
    rec.protectedT -= dt;
    if (rec.protectedT <= 0) s.shielded = false;
  }
  if (room.mode.regen && s.alive) updateRegen(rec, dt);
  if (!s.alive) return;
  // estações de munição (por jogador, com recarga individual)
  const stations = room.mapDef.ammoStations;
  for (let i = 0; i < stations.length; i++) {
    if (rec.stationCd[i] > 0) { rec.stationCd[i] -= dt; continue; }
    const st = stations[i];
    if (Math.hypot(st.x - rec.move.pos.x, st.z - rec.move.pos.z) > GAME.ammoStation.radius) continue;
    let refilled = false;
    for (const slot of [1, 2]) {
      const w = rec.loadout[slot];
      const a = rec.ammo.get(slot);
      if (a.reserve < w.reserve) { a.reserve = w.reserve; refilled = true; }
    }
    if (refilled) {
      rec.stationCd[i] = GAME.ammoStation.cooldown;
      room.notifyAmmo(rec);
    }
  }
}
