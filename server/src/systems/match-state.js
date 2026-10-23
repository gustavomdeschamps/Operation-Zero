// Fluxo da partida comum a todos os modos: lobby → contagem → modo ativo → resultado → lobby.
import { GAME } from '../../../shared/game-config.js';
import { PHASE, TEAM, MSG, NOTICE_TYPES } from '../../../shared/protocol.js';
import { clearSmokes } from './abilities.js';
import { payMatchRewards, newMatchStats } from '../economy/match-rewards.js';

const PUBLIC_AUTO_START = 20; // s após atingir o mínimo de jogadores (salas públicas)

export class MatchFlow {
  constructor(room) {
    this.room = room;
    this.lobbyWait = 0;
    this.matchSeq = 0;      // partidas jogadas nesta sala (parte do identificador de conclusão)
    this.matchTime = 0;     // s de partida em andamento
  }

  get phase() { return this.room.state.phase; }

  tick(dt) {
    const room = this.room;
    const st = room.state;
    switch (st.phase) {
      case PHASE.LOBBY: {
        // salas públicas iniciam sozinhas: todos prontos, ou espera máxima após o mínimo
        if (!st.isPrivate && this.canStart().ok) {
          this.lobbyWait += dt;
          const allReady = [...room.records.values()].every((r) => r.state.ready || !r.state.connected);
          st.timeLeft = Math.max(0, PUBLIC_AUTO_START - this.lobbyWait);
          if (allReady || this.lobbyWait >= PUBLIC_AUTO_START) this.startCountdown();
        } else {
          this.lobbyWait = 0;
          st.timeLeft = 0;
        }
        break;
      }
      case PHASE.COUNTDOWN:
        if (!this.canStart().ok) { this.backToLobby('Jogadores insuficientes — contagem cancelada'); break; }
        st.timeLeft = Math.max(0, st.timeLeft - dt);
        if (st.timeLeft <= 0) this.beginMatch();
        break;
      case PHASE.ENDED:
        st.timeLeft = Math.max(0, st.timeLeft - dt);
        if (st.timeLeft <= 0) this.backToLobby();
        break;
      default:
        this.matchTime += dt;
        room.mode.tick(room, dt);
    }
  }

  /** Requisitos para iniciar: mínimo de jogadores conectados e, no tático, as duas equipes ocupadas. */
  canStart() {
    const room = this.room;
    const counts = room.teamCounts();
    const total = counts[TEAM.ALFA] + counts[TEAM.OMEGA];
    // bots completam a contagem, mas nunca há partida sem ao menos uma pessoa conectada
    if (![...room.records.values()].some((r) => !r.bot && r.state.connected)) return { ok: false, reason: 'Aguardando jogadores' };
    if (total < room.state.minPlayers) return { ok: false, reason: `São necessários ${room.state.minPlayers} jogadores` };
    if (room.state.mode === 'tactical' && room.state.minPlayers > 1 && (counts[TEAM.ALFA] === 0 || counts[TEAM.OMEGA] === 0)) {
      return { ok: false, reason: 'As duas equipes precisam de jogadores' };
    }
    return { ok: true };
  }

  /** Pedido do anfitrião (salas privadas) ou início automático (públicas). */
  requestStart(rec) {
    const room = this.room;
    if (room.state.phase !== PHASE.LOBBY) return { ok: false, reason: 'A partida já começou' };
    if (rec && rec.sid !== room.state.hostId) return { ok: false, reason: 'Apenas o anfitrião pode iniciar' };
    const can = this.canStart();
    if (!can.ok) return can;
    this.startCountdown();
    return { ok: true };
  }

  startCountdown() {
    const st = this.room.state;
    st.phase = PHASE.COUNTDOWN;
    st.timeLeft = GAME.match.countdown;
    this.room.updateListing();
  }

  beginMatch() {
    const room = this.room;
    for (const rec of room.records.values()) {
      const s = rec.state;
      s.kills = 0; s.deaths = 0; s.score = 0;
      rec.matchStats = newMatchStats();
    }
    this.matchSeq += 1;
    this.matchTime = 0;
    room.state.winner = 0;
    room.state.endReason = '';
    room.mode.start(room);
    room.updateListing();
  }

  endMatch(winner, reason) {
    const room = this.room;
    const st = room.state;
    if (st.phase === PHASE.ENDED || st.phase === PHASE.LOBBY) return; // resultado é definido uma única vez
    st.phase = PHASE.ENDED;
    st.winner = winner;
    st.endReason = reason;
    st.timeLeft = GAME.match.resultsTime;
    for (const rec of room.records.values()) { rec.state.action = 0; rec.interacting = false; }
    try { payMatchRewards(room, winner); } catch (err) { console.error('[rewards]', err); }
    room.updateListing();
  }

  backToLobby(message) {
    const room = this.room;
    const st = room.state;
    st.phase = PHASE.LOBBY;
    st.timeLeft = 0;
    this.lobbyWait = 0;
    st.scoreAlfa = 0; st.scoreOmega = 0; st.round = 0; st.winner = 0;
    st.spike.state = 0; st.spike.actor = ''; st.spike.progress = 0;
    clearSmokes(room);
    for (const rec of room.records.values()) {
      rec.state.alive = false;
      rec.state.ready = false;
      rec.state.respawnIn = 0;
      rec.state.action = 0;
    }
    room.unlock();
    room.updateListing();
    if (message) room.broadcast(MSG.NOTICE, { t: NOTICE_TYPES.INFO, n: '', m: message });
  }
}
