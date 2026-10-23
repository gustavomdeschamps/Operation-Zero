// Tático por rodadas (ataque e defesa): preparação, rodada, instalação/desarme do dispositivo
// nos objetivos A/B, eliminação, tempo esgotado, intervalo e ponto de partida.
import { GAME } from '../../../shared/game-config.js';
import { PHASE, TEAM, SPIKE, END_REASON, MSG, NOTICE_TYPES } from '../../../shared/protocol.js';
import { siteAt } from '../../../shared/arena-layout.js';
import { clearSmokes } from '../systems/abilities.js';

const CFG = GAME.match.tactical;
const STILL_SPEED = 0.6;

const other = (team) => (team === TEAM.ALFA ? TEAM.OMEGA : TEAM.ALFA);

export const TacticalMode = {
  id: 'tactical',
  allowsLateJoin: false,
  regen: false,

  start(room) {
    const st = room.state;
    st.scoreAlfa = 0; st.scoreOmega = 0;
    st.scoreLimit = 0;
    st.round = 0;
    st.roundsToWin = CFG.roundsToWin;
    st.attackers = TEAM.OMEGA;
    room.lock();
    startRound(room);
  },

  tick(room, dt) {
    const st = room.state;
    switch (st.phase) {
      case PHASE.ROUND_PREP:
        st.timeLeft = Math.max(0, st.timeLeft - dt);
        if (st.timeLeft <= 0) { st.phase = PHASE.ROUND_LIVE; st.timeLeft = CFG.roundTime; }
        break;
      case PHASE.ROUND_LIVE:
        tickObjective(room, dt);
        if (st.phase !== PHASE.ROUND_LIVE) break;
        checkElimination(room);
        if (st.phase !== PHASE.ROUND_LIVE) break;
        if (st.spike.state === SPIKE.PLANTED || st.spike.state === SPIKE.DEFUSING) {
          st.spike.timer = Math.max(0, st.spike.timer - dt);
          st.timeLeft = st.spike.timer;
          if (st.spike.timer <= 0) {
            st.spike.state = SPIKE.DETONATED;
            roundWin(room, st.attackers, END_REASON.DETONATED);
          }
        } else {
          st.timeLeft = Math.max(0, st.timeLeft - dt);
          if (st.timeLeft <= 0) roundWin(room, other(st.attackers), END_REASON.TIME);
        }
        break;
      case PHASE.ROUND_END:
        st.timeLeft = Math.max(0, st.timeLeft - dt);
        if (st.timeLeft <= 0) {
          if (st.scoreAlfa >= CFG.roundsToWin) room.flow.endMatch(TEAM.ALFA, st.endReason);
          else if (st.scoreOmega >= CFG.roundsToWin) room.flow.endMatch(TEAM.OMEGA, st.endReason);
          else startRound(room);
        }
        break;
      default: break;
    }
  },

  onKill(room, killer, victim) {
    victim.state.respawnIn = 0; // sem respawn dentro da rodada
    const spike = room.state.spike;
    if (spike.actor === victim.sid) cancelAction(room, victim);
  },

  onPlayerJoined() {},

  onPlayerLeft(room) {
    const st = room.state;
    if (st.phase === PHASE.LOBBY || st.phase === PHASE.COUNTDOWN || st.phase === PHASE.ENDED) return;
    const counts = room.teamCounts();
    if (counts[TEAM.ALFA] === 0 && counts[TEAM.OMEGA] > 0) room.flow.endMatch(TEAM.OMEGA, END_REASON.FORFEIT);
    else if (counts[TEAM.OMEGA] === 0 && counts[TEAM.ALFA] > 0) room.flow.endMatch(TEAM.ALFA, END_REASON.FORFEIT);
  },

  combatActive: (room) => room.state.phase === PHASE.ROUND_LIVE,
  movementAllowed: (room) => room.state.phase !== PHASE.ROUND_PREP,
};

function startRound(room) {
  const st = room.state;
  st.round += 1;
  st.phase = PHASE.ROUND_PREP;
  st.timeLeft = CFG.prepTime;
  st.winner = 0;
  const sp = st.spike;
  sp.state = SPIKE.NONE; sp.site = ''; sp.progress = 0; sp.timer = 0; sp.actor = '';
  clearSmokes(room);
  for (const rec of room.records.values()) {
    rec.state.abilityCd = 0;
    room.respawn(rec, { shield: false });
  }
}

function roundWin(room, team, reason) {
  const st = room.state;
  if (st.phase !== PHASE.ROUND_LIVE) return; // nunca encerra duas vezes
  if (team === TEAM.ALFA) st.scoreAlfa += 1; else st.scoreOmega += 1;
  st.phase = PHASE.ROUND_END;
  st.timeLeft = CFG.roundEndTime;
  st.winner = team;
  st.endReason = reason;
  for (const rec of room.records.values()) rec.state.action = 0;
  room.broadcast(MSG.ROUND, { w: team, r: reason, n: st.round });
}

function aliveCount(room, team) {
  let n = 0;
  for (const rec of room.records.values()) if (rec.state.team === team && rec.state.alive && rec.state.connected) n++;
  return n;
}

function checkElimination(room) {
  const st = room.state;
  const att = aliveCount(room, st.attackers);
  const def = aliveCount(room, other(st.attackers));
  if (def === 0) roundWin(room, st.attackers, END_REASON.ELIMINATION);
  else if (att === 0 && st.spike.state !== SPIKE.PLANTED && st.spike.state !== SPIKE.DEFUSING) {
    roundWin(room, other(st.attackers), END_REASON.ELIMINATION);
  }
}

function cancelAction(room, rec) {
  const sp = room.state.spike;
  rec.state.action = 0;
  if (sp.actor !== rec.sid) return;
  sp.actor = '';
  sp.progress = 0;
  if (sp.state === SPIKE.PLANTING) sp.state = SPIKE.NONE;
  else if (sp.state === SPIKE.DEFUSING) sp.state = SPIKE.PLANTED;
}

/** Instalação (atacantes, dentro de um objetivo) e desarme (defensores, junto ao dispositivo). */
function tickObjective(room, dt) {
  const st = room.state;
  const sp = st.spike;
  for (const rec of room.records.values()) {
    const s = rec.state;
    const pos = rec.move.pos;
    const still = rec.move.onGround && Math.hypot(rec.move.vel.x, rec.move.vel.z) < STILL_SPEED;
    const wants = rec.interacting && s.alive && s.connected && still;
    if (s.team === st.attackers) {
      const site = siteAt(pos.x, pos.z, st.map);
      if ((sp.state === SPIKE.NONE || (sp.state === SPIKE.PLANTING && sp.actor === rec.sid)) && wants && site) {
        sp.state = SPIKE.PLANTING; sp.actor = rec.sid; sp.site = site;
        s.action = 1;
        sp.progress = Math.min(1, sp.progress + dt / CFG.plantTime);
        if (sp.progress >= 1) {
          sp.state = SPIKE.PLANTED; sp.actor = ''; sp.progress = 0;
          sp.x = pos.x; sp.y = pos.y; sp.z = pos.z;
          sp.timer = CFG.detonateTime;
          s.action = 0;
          s.score += 300;
          if (rec.matchStats) rec.matchStats.plants += 1;
          room.broadcast(MSG.NOTICE, { t: NOTICE_TYPES.INFO, n: s.name, m: `DISPOSITIVO INSTALADO NO OBJETIVO ${site}` });
        }
      } else if (sp.actor === rec.sid && sp.state === SPIKE.PLANTING) cancelAction(room, rec);
    } else {
      const near = Math.hypot(pos.x - sp.x, pos.z - sp.z) <= CFG.interactRange && Math.abs(pos.y - sp.y) < 1.5;
      if ((sp.state === SPIKE.PLANTED || (sp.state === SPIKE.DEFUSING && sp.actor === rec.sid)) && wants && near) {
        sp.state = SPIKE.DEFUSING; sp.actor = rec.sid;
        s.action = 2;
        sp.progress = Math.min(1, sp.progress + dt / CFG.defuseTime);
        if (sp.progress >= 1) {
          sp.state = SPIKE.DEFUSED; sp.actor = ''; s.action = 0;
          s.score += 300;
          if (rec.matchStats) rec.matchStats.defuses += 1;
          roundWin(room, s.team, END_REASON.DEFUSED);
          return;
        }
      } else if (sp.actor === rec.sid && sp.state === SPIKE.DEFUSING) cancelAction(room, rec);
    }
  }
}
