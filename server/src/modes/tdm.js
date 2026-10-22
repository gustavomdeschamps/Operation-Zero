// Combate por equipes: respawn, limite de pontos e de tempo, entrada tardia permitida.
import { GAME } from '../../../shared/game-config.js';
import { PHASE, TEAM, END_REASON } from '../../../shared/protocol.js';

const CFG = GAME.match.tdm;

export const TdmMode = {
  id: 'tdm',
  allowsLateJoin: true,
  regen: true,

  start(room) {
    const st = room.state;
    st.scoreAlfa = 0; st.scoreOmega = 0;
    st.scoreLimit = CFG.scoreLimit;
    st.roundsToWin = 0; st.round = 0;
    st.phase = PHASE.LIVE;
    st.timeLeft = CFG.timeLimit;
    for (const rec of room.records.values()) room.respawn(rec);
  },

  tick(room, dt) {
    const st = room.state;
    if (st.phase !== PHASE.LIVE) return;
    for (const rec of room.records.values()) {
      const s = rec.state;
      if (!s.alive && s.connected && s.respawnIn > 0) {
        s.respawnIn = Math.max(0, s.respawnIn - dt);
        if (s.respawnIn <= 0) room.respawn(rec);
      }
    }
    st.timeLeft = Math.max(0, st.timeLeft - dt);
    if (st.timeLeft <= 0) {
      const w = st.scoreAlfa === st.scoreOmega ? TEAM.NONE : st.scoreAlfa > st.scoreOmega ? TEAM.ALFA : TEAM.OMEGA;
      room.flow.endMatch(w, END_REASON.TIME);
    }
  },

  onKill(room, killer, victim) {
    const st = room.state;
    victim.state.respawnIn = CFG.respawnDelay;
    if (st.phase !== PHASE.LIVE || !killer || killer === victim) return;
    if (killer.state.team === victim.state.team) return;
    if (killer.state.team === TEAM.ALFA) st.scoreAlfa += 1; else st.scoreOmega += 1;
    if (st.scoreAlfa >= CFG.scoreLimit) room.flow.endMatch(TEAM.ALFA, END_REASON.SCORE);
    else if (st.scoreOmega >= CFG.scoreLimit) room.flow.endMatch(TEAM.OMEGA, END_REASON.SCORE);
  },

  onPlayerJoined(room, rec) {
    if (room.state.phase === PHASE.LIVE) room.respawn(rec);
  },

  onPlayerLeft(room) {
    const st = room.state;
    if (st.phase !== PHASE.LIVE) return;
    const counts = room.teamCounts();
    if (counts[TEAM.ALFA] === 0 && counts[TEAM.OMEGA] > 0) room.flow.endMatch(TEAM.OMEGA, END_REASON.FORFEIT);
    else if (counts[TEAM.OMEGA] === 0 && counts[TEAM.ALFA] > 0) room.flow.endMatch(TEAM.ALFA, END_REASON.FORFEIT);
  },

  combatActive: (room) => room.state.phase === PHASE.LIVE,
  movementAllowed: () => true,
};
