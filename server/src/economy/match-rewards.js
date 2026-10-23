// Pagamento das recompensas ao fim de uma partida. Somente quem está na sala (conectado) no
// momento do resultado recebe; quem abandona não recebe nada — terminar é sempre melhor.
// Todos os números vêm do estado autoritativo da sala; nada vem do cliente.
import { MSG } from '../../../shared/protocol.js';
import { Economy } from './economy.js';
import { getEconomy } from './index.js';
import { log } from '../services/logger.js';

export function newMatchStats() {
  return { active: 0, botKills: 0, headshots: 0, plants: 0, defuses: 0 };
}

export function payMatchRewards(room, winner) {
  const economy = getEconomy();
  const matchSeconds = room.flow.matchTime;
  const results = [];
  for (const rec of room.records.values()) {
    if (rec.bot || !rec.state.connected) continue;
    const ms = rec.matchStats || newMatchStats();
    const kills = Math.max(0, rec.state.kills - ms.botKills);
    const breakdown = Economy.computeReward({
      won: winner !== 0 && rec.state.team === winner,
      kills, botKills: ms.botKills, headshots: ms.headshots, plants: ms.plants, defuses: ms.defuses,
      activeSeconds: ms.active, matchSeconds,
    });
    const stats = { kills, botKills: ms.botKills, headshots: ms.headshots, plants: ms.plants, defuses: ms.defuses };
    const acc = rec.accountId ? economy.data.accounts[rec.accountId] : null;
    if (!acc) {
      room.sendTo(rec, MSG.REWARD, { guest: true, ...breakdown, stats });
      continue;
    }
    const completionId = `${room.nonce}:${room.flow.matchSeq}:${acc.id}`;
    let paid;
    try {
      if (breakdown.eligible) {
        paid = economy.grantMatchReward(acc, completionId, breakdown, { room: room.code, mode: room.state.mode, map: room.state.map });
      } else paid = { ...breakdown, granted: 0, capped: false, balance: acc.credits };
    } catch (err) {
      // falha ao registrar: nada é creditado (a operação foi desfeita) e o jogador é avisado
      log.error('match.reward_failed', { code: room.code, sid: rec.sid, error: err.message });
      paid = { ...breakdown, granted: 0, capped: false, balance: acc.credits, failed: true };
    }
    room.sendTo(rec, MSG.REWARD, { ...paid, stats });
    results.push({ sid: rec.sid, ...paid });
  }
  log.info('match.rewards', { code: room.code, seq: room.flow.matchSeq, paid: results.map((r) => [r.sid, r.granted]) });
  return results;
}
