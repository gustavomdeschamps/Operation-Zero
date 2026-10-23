// Gerenciador dos bots de uma sala: criação/remoção, política de preenchimento das salas públicas,
// controle do anfitrião nas privadas, eventos de som (tiros e passos) e plano de equipe no tático.
//
// Os bots são participantes do servidor (sem cliente): aparecem no estado com `bot = true` e o nome
// sempre com o prefixo [BOT]. Uma única instância da IA roda no servidor — todos os clientes veem o
// mesmo inimigo.
import { PHASE, TEAM, NOTICE_TYPES, MSG } from '../../../shared/protocol.js';
import { createMoveState, MOVE_STATES } from '../../../shared/movement.js';
import { getNavGrid } from '../../../shared/ai/navgrid.js';
import { OPERATORS } from '../../../shared/catalog.js';
import { PlayerState } from '../schema/MatchState.js';
import { resetLoadout } from '../systems/combat.js';
import { writeMoveState } from '../systems/simulation.js';
import { chooseSpawn, spawnHeight } from '../services/spawns.js';
import { RateLimiter } from '../services/validation.js';
import { BotBrain, TeamIntel } from './bot-brain.js';
import { BOT_DIFFICULTIES, BOT_NAMES, BOT_FILL, isValidDifficulty } from './bot-config.js';
import { log } from '../services/logger.js';

const NOISE_WINDOW = 3;       // s de eventos de som mantidos
const STEP_INTERVAL = 0.45;   // s entre "passos audíveis" de quem corre

export class BotManager {
  constructor(room, { difficulty = BOT_FILL.publicDifficulty } = {}) {
    this.room = room;
    this.difficulty = isValidDifficulty(difficulty) ? difficulty : BOT_FILL.publicDifficulty;
    this.time = 0;
    this.seq = 0;
    this.fillWait = 0;
    this.stepT = 0;
    this.noise = [];
    this.intel = new TeamIntel();
    this.plan = { site: 'A', round: -1 };
    this.nav = getNavGrid(room.state.map);
  }

  get bots() { return [...this.room.records.values()].filter((r) => r.bot); }
  get humans() { return [...this.room.records.values()].filter((r) => !r.bot); }
  get count() { let n = 0; for (const r of this.room.records.values()) if (r.bot) n++; return n; }

  setDifficulty(id) {
    if (!isValidDifficulty(id)) return false;
    this.difficulty = id;
    for (const r of this.room.records.values()) if (r.bot) { r.bot.cfg = BOT_DIFFICULTIES[id]; r.bot.difficulty = id; }
    this.room.state.botDifficulty = id;
    return true;
  }

  /** Cria um bot (mesmo registro e regras de um jogador, sem cliente). */
  add(team = null) {
    const room = this.room;
    if (room.records.size >= room.state.maxPlayers) return null;
    const n = this.seq++;
    const sid = `bot-${room.code}-${n}`;
    const used = new Set([...room.records.values()].map((r) => r.state.name));
    let base = BOT_NAMES[n % BOT_NAMES.length];
    for (const nm of BOT_NAMES) if (!used.has(`[BOT] ${nm}`)) { base = nm; break; }
    const ps = new PlayerState();
    ps.name = room.uniqueName(`[BOT] ${base}`);
    ps.bot = true;
    ps.team = team === TEAM.ALFA || team === TEAM.OMEGA ? team : room.balancedTeam();
    ps.operator = OPERATORS[n % OPERATORS.length].id;
    ps.connected = true;
    ps.ready = true;
    const rng = room.rng;
    const rec = {
      sid, client: null, clientKey: sid, ip: null, isBot: true, botIndex: n,
      state: ps, move: createMoveState(), simTime: 0, budget: 1, lastInputAt: Date.now(), lastHeldBtn: 0,
      lastDamageTime: -999, regenAcc: 0, protectedT: 0, interacting: false, stationCd: room.mapDef.ammoStations.map(() => 0),
      rejectLimiter: new RateLimiter(4), msgLimiter: new RateLimiter(8),
      primary: rng() < 0.6 ? 'rifle' : 'smg',
    };
    resetLoadout(rec);
    const p = chooseSpawn(room, rec);
    rec.move.pos.x = p.x; rec.move.pos.y = spawnHeight(room.arena, p); rec.move.pos.z = p.z;
    ps.yaw = p.yaw;
    writeMoveState(rec);
    rec.bot = new BotBrain(room, rec, this.difficulty, BOT_DIFFICULTIES[this.difficulty], rng);
    room.records.set(sid, rec);
    room.state.players.set(sid, ps);
    room.broadcast(MSG.NOTICE, { t: NOTICE_TYPES.JOIN, n: ps.name, m: '' });
    room.mode.onPlayerJoined(room, rec);
    room.updateListing();
    log.info('bot.add', { code: room.code, sid, team: ps.team, difficulty: this.difficulty });
    return rec;
  }

  remove(rec) {
    const room = this.room;
    if (!rec || !rec.bot) return false;
    room.cancelObjectiveAction(rec);
    room.records.delete(rec.sid);
    room.state.players.delete(rec.sid);
    room.broadcast(MSG.NOTICE, { t: NOTICE_TYPES.LEAVE, n: rec.state.name, m: '' });
    room.mode.onPlayerLeft(room, rec);
    room.updateListing();
    log.info('bot.remove', { code: room.code, sid: rec.sid });
    return true;
  }

  /** Remove um bot (da equipe indicada ou da maior), preferindo os já eliminados. */
  removeOne(team = null) {
    const c = this.room.teamCounts();
    const from = team || (c[TEAM.ALFA] >= c[TEAM.OMEGA] ? TEAM.ALFA : TEAM.OMEGA);
    const list = this.bots.filter((r) => r.state.team === from);
    const pool = list.length ? list : this.bots;
    if (!pool.length) return false;
    pool.sort((a, b) => Number(a.state.alive) - Number(b.state.alive));
    return this.remove(pool[0]);
  }

  removeAll() { for (const r of this.bots) this.remove(r); }

  /** Um jogador entrou: libera vaga e mantém as equipes equilibradas. */
  onHumanJoined(rec) {
    const st = this.room.state;
    const target = BOT_FILL.publicTarget[st.mode] || 6;
    const over = this.room.records.size - (st.isPrivate ? st.maxPlayers : Math.max(target, this.humans.length));
    if (this.count > 0 && over > 0) this.removeOne(rec.state.team);
  }

  /** Som de tiro (ouvido por bots próximos). */
  shot(rec) {
    this.noise.push({ t: this.time, kind: 'shot', team: rec.state.team, x: rec.move.pos.x, z: rec.move.pos.z });
  }

  /** Um bot foi atingido: reage e, se possível, aliados próximos vêm ajudar. */
  damaged(target, attacker) {
    if (target.bot) target.bot.onDamaged(attacker);
    for (const r of this.room.records.values()) {
      if (!r.bot || r === target || !r.state.alive || r.state.team !== target.state.team) continue;
      if (r.bot.mode === 'engage' || r.bot.mode === 'objective') continue;
      const d = Math.hypot(r.move.pos.x - target.move.pos.x, r.move.pos.z - target.move.pos.z);
      if (d < 28) r.bot.support(target.move.pos.x, target.move.pos.z);
    }
  }

  // ---- passo -----------------------------------------------------------------------
  tick(dt) {
    const room = this.room, st = room.state;
    this.time += dt;
    while (this.noise.length && this.noise[0].t < this.time - NOISE_WINDOW) this.noise.shift();
    // passos de quem corre (bots ouvem; andar devagar/agachado é silencioso)
    this.stepT -= dt;
    if (this.stepT <= 0) {
      this.stepT = STEP_INTERVAL;
      const RUN = MOVE_STATES.indexOf('run');
      for (const r of room.records.values()) {
        if (r.state.alive && r.state.move === RUN) this.noise.push({ t: this.time, kind: 'step', team: r.state.team, x: r.move.pos.x, z: r.move.pos.z });
      }
    }
    // plano de rodada (tático): objetivo sorteado a cada rodada
    if (st.mode === 'tactical' && st.round !== this.plan.round) {
      this.plan.round = st.round;
      this.plan.site = room.rng() < 0.5 ? 'A' : 'B';
      this.intel.clear();
      this.assignRoutes();
    }
    if (st.phase === PHASE.LOBBY && !st.isPrivate) this.autoFill(dt);
  }

  /** Atacantes com flanco (Difícil/Elite) dividem-se: parte vai por uma rota alternativa. */
  assignRoutes() {
    const room = this.room, st = room.state;
    const sites = room.mapDef.sites;
    const site = sites[this.plan.site];
    const other = sites[this.plan.site === 'A' ? 'B' : 'A'];
    let k = 0;
    for (const r of room.records.values()) {
      if (!r.bot) continue;
      r.bot.flankVia = null; r.bot.flankDone = false;
      if (r.state.team !== st.attackers || !r.bot.cfg.flank) continue;
      if (k++ % 2 === 1) {
        // passa pelo meio do caminho entre os dois objetivos antes de entrar
        r.bot.flankVia = { x: (site.cx + other.cx) / 2, z: (site.cz + other.cz) / 2 + (room.rng() - 0.5) * 6 };
      }
    }
  }

  /**
   * Salas públicas: com ao menos uma pessoa no lobby, completa com bots após `fillDelay` s e
   * retira bots excedentes quando pessoas entram. Nunca há partida só de bots.
   */
  autoFill(dt) {
    const room = this.room, st = room.state;
    const humans = this.humans.filter((r) => r.state.connected).length;
    if (humans === 0) { this.fillWait = 0; if (this.count) this.removeAll(); return; }
    const target = Math.min(st.maxPlayers, BOT_FILL.publicTarget[st.mode] || 6);
    this.fillWait += dt;
    if (this.fillWait < BOT_FILL.fillDelay) return;
    const total = room.records.size;
    if (total < target) this.add();
    else if (total > target && this.count > 0) this.removeOne();
  }

  /** Quadro de entrada do bot neste passo. */
  input(rec, dt) { return rec.bot.step(dt); }
}
