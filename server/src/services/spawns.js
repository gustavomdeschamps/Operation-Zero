// Escolha de pontos de surgimento válidos e justos.
import { GAME } from '../../../shared/game-config.js';

/**
 * TDM: escolhe o ponto cuja menor distância até inimigos vivos é a maior, evitando ocupar
 * o mesmo lugar de outro jogador. Tático: posição fixa da equipe pelo índice do jogador.
 */
export function chooseSpawn(room, rec) {
  const mode = room.state.mode;
  if (mode === 'tactical') {
    const spawns = room.mapDef.onlineSpawns;
    const list = spawns[rec.state.team] || spawns.tdm;
    const teammates = [...room.records.values()].filter((r) => r.state.team === rec.state.team);
    const idx = Math.max(0, teammates.indexOf(rec)) % list.length;
    return list[idx];
  }
  const enemies = [];
  const everyone = [];
  for (const r of room.records.values()) {
    if (r === rec || !r.state.alive) continue;
    everyone.push(r.move.pos);
    if (r.state.team !== rec.state.team) enemies.push(r.move.pos);
  }
  let best = null, bestScore = -Infinity;
  for (const p of room.mapDef.onlineSpawns.tdm) {
    let minEnemy = Infinity;
    for (const e of enemies) minEnemy = Math.min(minEnemy, Math.hypot(e.x - p.x, e.z - p.z));
    let crowded = false;
    for (const o of everyone) if (Math.hypot(o.x - p.x, o.z - p.z) < 2) crowded = true;
    const score = (enemies.length ? Math.min(minEnemy, 60) : 0) - (crowded ? 1000 : 0) + room.rng() * 4;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

export const spawnHeight = (arena, p) => arena.groundHeight(p.x, p.z, 3, GAME.player.radius);
