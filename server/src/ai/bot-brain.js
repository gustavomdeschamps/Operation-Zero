// Inteligência de um bot (executada SOMENTE no servidor, dentro da simulação autoritativa).
//
// A cada passo fixo o bot produz um quadro de entrada igual ao de um jogador (mf, mr, botões, yaw,
// pitch, direção do tiro). O quadro passa pela MESMA física, validação de arma, munição, recarga e
// cone de dispersão dos jogadores — o bot não tem atalhos.
//
// Percepção (sem conhecimento sobrenatural):
//  - visão: alcance + campo de visão a partir da mira + linha de visão contra a colisão real e a fumaça;
//  - audição: tiros e passos de corrida próximos, com erro de posição;
//  - dano recebido: direção aproximada de quem atirou (como o indicador de dano do jogador);
//  - rádio (só Elite): o que os aliados viram, com atraso.
// Decisões: patrulhar, investigar, engajar (rajadas, desvio lateral, agachar), buscar cobertura,
// recuar, recarregar, apoiar aliados e jogar o objetivo do modo tático (instalar/desarmar).
import { GAME } from '../../../shared/game-config.js';
import { BTN, PHASE, SPIKE, TEAM } from '../../../shared/protocol.js';
import { eyeHeight, movementState } from '../../../shared/movement.js';
import { computeSpread } from '../../../shared/weapon-rules.js';
import { playerHitboxes, createHitboxSet } from '../../../shared/hitboxes.js';
import { smokeCenter, smokeBlocksSegment } from '../../../shared/smoke-rules.js';
import { wrapAngle, clamp, damp } from '../../../shared/math.js';
import { currentWeapon } from '../systems/combat.js';

const THINK_INTERVAL = 0.12;     // decisões ~8×/s; mira e movimento a cada passo
const ARRIVE = 0.6;
const STEP_HEAR_RANGE = 12;
const _boxes = createHitboxSet();

const rand = (rng, [a, b]) => a + (b - a) * rng();
function gauss(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

export class BotBrain {
  constructor(room, rec, difficulty, cfg, rng) {
    this.room = room;
    this.rec = rec;
    this.difficulty = difficulty;
    this.cfg = cfg;
    this.rng = rng;
    this.flankVia = null;
    this.flankDone = false;
    this.reset();
  }

  reset() {
    this.mode = 'roam';
    this.goal = null;
    this.path = null;
    this.pathIdx = 0;
    this.repathAt = 0;
    this.thinkT = 0;
    this.time = 0;
    this.aimYaw = this.rec.state.yaw;
    this.aimPitch = 0;
    this.errYaw = 0; this.errPitch = 0; this.errTargetYaw = 0; this.errTargetPitch = 0; this.errT = 0;
    this.target = null;           // registro do inimigo engajado
    this.seenT = 0;               // há quanto tempo o alvo está visível
    this.memory = new Map();      // sid → { x, y, z, t } (última posição vista)
    this.burstLeft = 0;
    this.burstPauseT = 0;
    this.strafeDir = 0; this.strafeT = 0;
    this.crouchT = 0;
    this.coverT = 0;
    this.lookAroundT = 0;
    this.lastHp = this.rec.state.hp;
    this.stuck = { x: this.rec.move.pos.x, z: this.rec.move.pos.z, t: 0, jumps: 0 };
    this.heardAt = -1;
    this.interact = false;
    this.spawnSeq = this.rec.state.spawnSeq;
    this.alertYaw = undefined;
    // flankVia/flankDone (rota da rodada) são definidos pelo gerenciador e sobrevivem ao surgimento
  }

  // ---- percepção -------------------------------------------------------------------
  eye(rec = this.rec, out = { x: 0, y: 0, z: 0 }) {
    out.x = rec.move.pos.x; out.y = rec.move.pos.y + eyeHeight(rec.move.height); out.z = rec.move.pos.z;
    return out;
  }

  /** Pontos visíveis do alvo (cabeça e peito da hitbox oficial). */
  aimPoints(t) {
    const s = t.state;
    playerHitboxes(s.x, s.y, s.z, s.h, _boxes, { yaw: s.yaw, pitch: s.pitch, vx: s.vx, vz: s.vz });
    const c = (b) => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 });
    return { head: c(_boxes[0]), chest: c(_boxes[1]) };
  }

  smokeCenters() {
    const list = [];
    this.room.state.smokes.forEach((sm) => list.push(smokeCenter(sm)));
    return list;
  }

  canSee(t, eye, smokes) {
    const dx = t.move.pos.x - eye.x, dz = t.move.pos.z - eye.z;
    const dist = Math.hypot(dx, dz);
    if (dist > this.cfg.visionRange) return false;
    // campo de visão a partir da mira (muito perto o bot percebe de qualquer forma)
    if (dist > 2.5) {
      const ang = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - this.aimYaw));
      if (ang > this.cfg.fov / 2) return false;
    }
    const p = this.aimPoints(t);
    for (const pt of [p.chest, p.head]) {
      if (this.room.arena.segmentBlocked(eye, pt)) continue;
      if (smokes.length && smokeBlocksSegment(smokes, eye, pt)) continue;
      return true;
    }
    return false;
  }

  enemies() {
    const out = [];
    for (const r of this.room.records.values()) {
      if (r === this.rec || !r.state.alive || !r.state.connected || r.state.team === this.rec.state.team) continue;
      out.push(r);
    }
    return out;
  }

  /** Dano recebido: direção aproximada de quem atirou (erro de ~1,5 m), como o indicador do jogador. */
  onDamaged(attacker) {
    if (!attacker) return;
    const e = 1.5;
    this.investigate(attacker.move.pos.x + gauss(this.rng) * e, attacker.move.pos.z + gauss(this.rng) * e, true);
    this.alertYaw = Math.atan2(-(attacker.move.pos.x - this.rec.move.pos.x), -(attacker.move.pos.z - this.rec.move.pos.z));
  }

  /** Vai verificar um ponto; fora de urgência, não interrompe um combate ou a cobertura. */
  investigate(x, z, urgent = false) {
    if (!urgent && (this.mode === 'engage' || this.mode === 'cover')) return;
    this.setGoal(x, z, 'investigate');
  }

  // ---- decisões --------------------------------------------------------------------
  think() {
    const room = this.room, rec = this.rec, st = room.state, cfg = this.cfg;
    const eye = this.eye();
    const smokes = this.smokeCenters();
    // 1) quem estou vendo?
    let best = null, bestD = Infinity;
    for (const e of this.enemies()) {
      if (!this.canSee(e, eye, smokes)) continue;
      const d = Math.hypot(e.move.pos.x - eye.x, e.move.pos.z - eye.z);
      this.memory.set(e.sid, { x: e.move.pos.x, y: e.move.pos.y, z: e.move.pos.z, t: this.time });
      if (cfg.comms) room.bots.intel.report(rec.state.team, e, room.bots.time);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      if (this.target !== best) { this.target = best; this.seenT = 0; this.reaction = rand(this.rng, cfg.reaction); this.trackT = 0; this.useHead = this.rng() < cfg.headChance; }
      if (this.mode !== 'cover' && this.mode !== 'retreat') this.mode = 'engage';
      this.interact = false;
    } else if (this.target) {
      // perdeu o alvo de vista: vai até a última posição conhecida
      const m = this.memory.get(this.target.sid);
      this.target = null;
      if (m && this.mode === 'engage') this.setGoal(m.x, m.z, 'investigate');
    }

    // 2) vida baixa ou sem munição sob fogo: cobertura (conforme a dificuldade)
    const hp = rec.state.hp;
    const tookDamage = hp < this.lastHp;
    this.lastHp = hp;
    const ammo = rec.ammo.get(rec.slot);
    if (this.mode === 'engage' && this.target && this.mode !== 'cover') {
      const needCover = (hp <= cfg.retreatHp && tookDamage) || (ammo.mag === 0 && this.rng() < cfg.coverChance);
      if (needCover && this.rng() < cfg.coverChance + 0.15) {
        const c = this.findCover(this.target);
        if (c) { this.coverT = rand(this.rng, cfg.peekTime) + 1.5; this.setGoal(c.x, c.z, 'cover'); }
        else if (hp <= cfg.retreatHp) this.retreat(this.target);
      }
    }

    // 3) sem alvo: ouvir, rádio, objetivo ou patrulha
    if (this.mode !== 'engage' && this.mode !== 'cover' && this.mode !== 'retreat') {
      const heard = this.listen();
      if (heard) this.setGoal(heard.x, heard.z, 'investigate');
      else if (cfg.comms && this.mode === 'roam') {
        const intel = room.bots.intel.recent(rec.state.team, room.bots.time, 0.8, 8);
        if (intel) this.setGoal(intel.x + gauss(this.rng), intel.z + gauss(this.rng), 'investigate');
      }
      if (st.mode === 'tactical') this.thinkObjective();
      if (!this.goal || this.arrived()) {
        if (this.mode === 'investigate') { this.mode = 'search'; this.lookAroundT = 1.6; this.goal = null; }
        else if (this.mode === 'search' && this.lookAroundT <= 0) this.mode = 'roam';
        if (this.mode === 'roam' && st.mode !== 'tactical') this.pickRoamGoal();
      }
    }

    // 4) recarga tática quando não há ameaça à vista
    this.wantReload = !this.target && ammo.mag < currentWeapon(rec).magSize * 0.4 && ammo.reserve > 0;
  }

  listen() {
    const room = this.room, rec = this.rec;
    let best = null;
    const noise = room.bots.noise;
    for (const n of noise) {
      if (n.t <= this.heardAt || n.team === rec.state.team) continue;
      const range = n.kind === 'shot' ? this.cfg.hearing : STEP_HEAR_RANGE;
      const d = Math.hypot(n.x - rec.move.pos.x, n.z - rec.move.pos.z);
      if (d > range) continue;
      if (!best || n.t > best.t) best = n;
    }
    if (noise.length) this.heardAt = noise[noise.length - 1].t;
    if (!best) return null;
    const err = 1 + Math.hypot(best.x - rec.move.pos.x, best.z - rec.move.pos.z) * 0.08;
    return { x: best.x + gauss(this.rng) * err, z: best.z + gauss(this.rng) * err };
  }

  /** Modo tático: atacantes instalam (A ou B, com flanco), defensores seguram e desarmam. */
  thinkObjective() {
    const room = this.room, st = room.state, rec = this.rec, sp = st.spike;
    const attacking = rec.state.team === st.attackers;
    const sites = room.mapDef.sites;
    this.interact = false;
    if (attacking) {
      if (sp.state === SPIKE.NONE || (sp.state === SPIKE.PLANTING && sp.actor === rec.sid)) {
        const site = sites[room.bots.plan.site] || Object.values(sites)[0];
        if (this.flankVia && !this.flankDone) {
          if (this.dist2(this.flankVia) < 4) this.flankDone = true;
          else { this.setGoal(this.flankVia.x, this.flankVia.z, 'objective'); return; }
        }
        const inSite = rec.move.pos.x > site.minX + 0.5 && rec.move.pos.x < site.maxX - 0.5 && rec.move.pos.z > site.minZ + 0.5 && rec.move.pos.z < site.maxZ - 0.5;
        if (inSite) { this.goal = null; this.path = null; this.interact = true; this.mode = 'objective'; return; }
        this.setGoal(site.cx + (this.rng() - 0.5) * 3, site.cz + (this.rng() - 0.5) * 3, 'objective');
      } else if (sp.state === SPIKE.PLANTED || sp.state === SPIKE.DEFUSING) {
        if (this.dist2(sp) > 64 || this.arrived()) this.setGoal(sp.x + (this.rng() - 0.5) * 10, sp.z + (this.rng() - 0.5) * 10, 'objective');
      }
    } else if (sp.state === SPIKE.PLANTED || (sp.state === SPIKE.DEFUSING && sp.actor === rec.sid)) {
      if (this.dist2(sp) < GAME.match.tactical.interactRange ** 2 * 0.6) { this.goal = null; this.path = null; this.interact = true; this.mode = 'objective'; return; }
      this.setGoal(sp.x, sp.z, 'objective');
    } else {
      const ids = Object.keys(sites);
      const site = sites[ids[this.rec.botIndex % ids.length]];
      if (!this.goal || this.arrived() || this.goalKind !== 'objective') {
        const p = room.bots.nav.randomPoint(this.rng, { minX: site.minX - 3, maxX: site.maxX + 3, minZ: site.minZ - 3, maxZ: site.maxZ + 3 });
        if (p) this.setGoal(p.x, p.z, 'objective');
      }
    }
  }

  dist2(p) { const dx = p.x - this.rec.move.pos.x, dz = p.z - this.rec.move.pos.z; return dx * dx + dz * dz; }

  pickRoamGoal() {
    const room = this.room;
    // evita aglomerar: rejeita destinos perto dos destinos de outros bots da equipe
    for (let i = 0; i < 6; i++) {
      const p = room.bots.nav.randomPoint(this.rng);
      if (!p) continue;
      let crowded = false;
      for (const r of room.records.values()) {
        if (r === this.rec || !r.bot || r.state.team !== this.rec.state.team || !r.bot.goal) continue;
        if (Math.hypot(r.bot.goal.x - p.x, r.bot.goal.z - p.z) < 8) { crowded = true; break; }
      }
      if (!crowded || i === 5) { this.setGoal(p.x, p.z, 'roam'); return; }
    }
  }

  /** Cobertura: ponto andável próximo onde o alvo NÃO enxerga o olho do bot (em pé ou agachado). */
  findCover(threat) {
    const room = this.room, nav = room.bots.nav, rec = this.rec;
    const te = this.eye(threat);
    let best = null, bestScore = Infinity;
    for (let k = 0; k < 18; k++) {
      const ang = this.rng() * Math.PI * 2, r = 2.5 + this.rng() * 7;
      const x = rec.move.pos.x + Math.cos(ang) * r, z = rec.move.pos.z + Math.sin(ang) * r;
      const [i, j] = nav.cellOf(x, z);
      if (!nav.isWalk(i, j) || nav.clearance[nav.idx(i, j)] < 1) continue;
      const c = nav.center(i, j);
      const hidden = room.arena.segmentBlocked(te, { x: c.x, y: c.y + 1.09, z: c.z });
      if (!hidden) continue;
      const standHidden = room.arena.segmentBlocked(te, { x: c.x, y: c.y + 1.67, z: c.z });
      const score = r + (standHidden ? 0 : 2.5) - Math.hypot(c.x - te.x, c.z - te.z) * 0.05;
      if (score < bestScore) { bestScore = score; best = { x: c.x, z: c.z, crouch: !standHidden }; }
    }
    this.coverCrouch = best ? best.crouch : false;
    return best;
  }

  /** Aliado sob fogo por perto: vai apoiar (se não estiver ocupado). */
  support(x, z) {
    if (!this.rec.state.alive || this.mode === 'engage' || this.mode === 'cover') return;
    this.setGoal(x + gauss(this.rng) * 2, z + gauss(this.rng) * 2, 'support');
  }

  /** Recuo: sem cobertura e com pouca vida, afasta-se da ameaça por um ponto andável. */
  retreat(threat) {
    const p = this.rec.move.pos;
    const dx = p.x - threat.move.pos.x, dz = p.z - threat.move.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const nav = this.room.bots.nav;
    const c = nav.nearest(p.x + (dx / l) * 12, p.z + (dz / l) * 12, 12);
    if (!c) return;
    const pt = nav.center(c[0], c[1]);
    this.coverT = 3;
    this.setGoal(pt.x, pt.z, 'retreat');
    this.mode = 'retreat';
  }

  setGoal(x, z, kind) {
    const g = this.goal;
    this.goalKind = kind;
    if (kind !== 'roam' || this.mode === 'roam') this.mode = kind;
    if (g && Math.hypot(g.x - x, g.z - z) < 1.5 && this.path) return;
    this.goal = { x, z };
    this.path = null;
    this.repathAt = 0;
  }

  arrived() { return !this.goal || this.dist2(this.goal) < ARRIVE * ARRIVE * 4; }

  // ---- execução (a cada passo) ----------------------------------------------------------
  /** Produz o quadro de entrada deste passo (mesmo formato e regras de um jogador). */
  step(dt) {
    const room = this.room, rec = this.rec, s = rec.state, cfg = this.cfg;
    this.time += dt;
    const input = { mf: 0, mr: 0, btn: 0, yaw: this.aimYaw, pitch: this.aimPitch, slot: 1, dx: 0, dy: 0, dz: -1 };
    if (!s.alive) { this.dead = true; return input; }
    if (this.dead || s.spawnSeq !== this.spawnSeq) { this.reset(); this.dead = false; }
    const phase = room.state.phase;
    if (phase !== PHASE.LIVE && phase !== PHASE.ROUND_LIVE && phase !== PHASE.ROUND_PREP) return input;

    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = THINK_INTERVAL * (0.8 + this.rng() * 0.4); this.think(); }
    if (this.lookAroundT > 0) this.lookAroundT -= dt;
    if (this.coverT > 0) { this.coverT -= dt; if (this.coverT <= 0 && (this.mode === 'cover' || this.mode === 'retreat')) this.mode = this.target ? 'engage' : 'roam'; }

    // ---- mira
    let wantYaw = this.aimYaw, wantPitch = 0;
    const target = this.target && this.target.state.alive ? this.target : null;
    const eye = this.eye();
    let aimPoint = null;
    if (target) {
      const pts = this.aimPoints(target);
      aimPoint = this.useHead ? pts.head : pts.chest;
      const dx = aimPoint.x - eye.x, dy = aimPoint.y - eye.y, dz = aimPoint.z - eye.z;
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      this.seenT += dt;
      this.trackT = (this.trackT || 0) + dt;
    } else if (this.alertYaw !== undefined) {
      wantYaw = this.alertYaw;
      if (Math.abs(wrapAngle(wantYaw - this.aimYaw)) < 0.1) this.alertYaw = undefined;
    } else if (this.lookAroundT > 0) {
      wantYaw = this.aimYaw + dt * 1.6;
    } else if (this.moveDir) {
      wantYaw = Math.atan2(-this.moveDir.x, -this.moveDir.z);
    }
    // erro de mira: passeio aleatório suave, maior no início do acompanhamento e com movimento
    const speed = Math.hypot(rec.move.vel.x, rec.move.vel.z);
    const tSpeed = target ? Math.hypot(target.move.vel.x, target.move.vel.z) : 0;
    const settle = target ? clamp(this.trackT / cfg.aimSettle, 0, 1) : 0;
    const err = cfg.aimError * (2.2 - 1.2 * settle) * (1 + tSpeed / 5) * (speed > 0.5 ? 1.35 : 1);
    this.errT -= dt;
    if (this.errT <= 0) { this.errT = 0.22 + this.rng() * 0.2; this.errTargetYaw = gauss(this.rng) * err; this.errTargetPitch = gauss(this.rng) * err * 0.7; }
    this.errYaw = damp(this.errYaw, this.errTargetYaw, 6, dt);
    this.errPitch = damp(this.errPitch, this.errTargetPitch, 6, dt);
    const turn = cfg.turnSpeed * dt;
    this.aimYaw = wrapAngle(this.aimYaw + clamp(wrapAngle(wantYaw + (target ? this.errYaw : 0) - this.aimYaw), -turn, turn));
    this.aimPitch = clamp(this.aimPitch + clamp(wantPitch + (target ? this.errPitch : 0) - this.aimPitch, -turn, turn), -1.2, 1.2);
    // recuo da própria arma desvia a mira (e se recupera)
    this.recoil = damp(this.recoil || 0, 0, 7, dt);
    input.yaw = this.aimYaw;
    input.pitch = clamp(this.aimPitch + this.recoil, -GAME.pitchLimit, GAME.pitchLimit);

    // ---- movimento
    this.moveDir = null;
    let wantMove = null;
    if (this.mode === 'engage' && target) {
      const def = currentWeapon(rec);
      const d = Math.hypot(target.move.pos.x - rec.move.pos.x, target.move.pos.z - rec.move.pos.z);
      const [minD, maxD] = def.id === 'smg' ? [4, 16] : def.id === 'pistol' ? [4, 14] : [8, 32];
      if (d > maxD) wantMove = this.pathStep(target.move.pos.x, target.move.pos.z, dt);
      else {
        // desvio lateral (dificulta a mira do adversário) e ajuste de distância
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = 0.7 + this.rng() * 1.0; this.strafeDir = this.rng() < cfg.strafe ? (this.rng() < 0.5 ? -1 : 1) : 0; }
        const rx = Math.cos(this.aimYaw), rz = -Math.sin(this.aimYaw);
        let mx = rx * this.strafeDir, mz = rz * this.strafeDir;
        if (d < minD) { mx -= -Math.sin(this.aimYaw); mz -= -Math.cos(this.aimYaw); }
        if ((mx || mz) && this.freeAhead(mx, mz)) wantMove = { x: mx, z: mz };
        else this.strafeDir = -this.strafeDir;
        // agachar parado a média distância (hard/elite usam mais)
        if (!wantMove && d > 12 && this.crouchT <= 0 && this.rng() < cfg.crouchChance * dt * 2) this.crouchT = 1 + this.rng() * 1.2;
      }
    } else if ((this.mode === 'cover' || this.mode === 'retreat') && this.goal) {
      wantMove = this.arrived() ? null : this.pathStep(this.goal.x, this.goal.z, dt);
      if (!wantMove && this.coverCrouch) this.crouchT = 0.3;
    } else if (this.goal && !this.interact) {
      wantMove = this.pathStep(this.goal.x, this.goal.z, dt);
    }
    if (this.crouchT > 0) { this.crouchT -= dt; input.btn |= BTN.CROUCH; }
    if (wantMove) {
      this.separate(wantMove);
      this.moveDir = wantMove;
      const fx = -Math.sin(this.aimYaw), fz = -Math.cos(this.aimYaw);
      const rx = Math.cos(this.aimYaw), rz = -Math.sin(this.aimYaw);
      const len = Math.hypot(wantMove.x, wantMove.z) || 1;
      const f = (wantMove.x * fx + wantMove.z * fz) / len, r = (wantMove.x * rx + wantMove.z * rz) / len;
      input.mf = f > 0.38 ? 1 : f < -0.38 ? -1 : 0;
      input.mr = r > 0.38 ? 1 : r < -0.38 ? -1 : 0;
      this.checkStuck(dt, input);
    } else this.stuck.t = 0;
    if (this.interact) { input.mf = 0; input.mr = 0; input.btn |= BTN.INTERACT; }

    // ---- arma
    const def = currentWeapon(rec);
    const ammo = rec.ammo.get(rec.slot);
    if (ammo.mag === 0 || (this.wantReload && !target)) { input.btn |= BTN.RELOAD; this.wantReload = false; }
    if (target && aimPoint && this.seenT >= this.reaction && ammo.mag > 0 && rec.reloadEnd < 0) {
      const aimErr = Math.abs(wrapAngle(wantYaw - this.aimYaw)) + Math.abs(wantPitch - this.aimPitch);
      const onTarget = aimErr < cfg.aimError * 3 + 0.03;
      if (this.burstPauseT > 0) this.burstPauseT -= dt;
      else if (onTarget) {
        if (this.burstLeft <= 0) this.burstLeft = def.automatic ? Math.round(rand(this.rng, cfg.burst)) : 1;
        if (this.canFireNow(dt)) {
          this.fire(input, def);
          this.burstLeft -= 1;
          if (this.burstLeft <= 0) this.burstPauseT = rand(this.rng, cfg.burstPause) * (def.automatic ? 1 : 1.4);
        }
      }
    } else this.burstLeft = 0;
    return input;
  }

  /** Mesma aritmética de cadência do servidor (o relógio do bot avança neste passo). */
  canFireNow(dt) {
    const rec = this.rec;
    return rec.move.onGround && rec.simTime + dt * 1.25 >= rec.nextFire && rec.switchStart < 0;
  }

  /** Disparo: direção = mira atual + dispersão real da arma (amostrada como a do jogador). */
  fire(input, def) {
    const rec = this.rec;
    const spread = computeSpread(def, movementState(rec.move), 0, rec.bloom);
    const ang = spread * Math.sqrt(this.rng()) * 0.9, th = this.rng() * Math.PI * 2;
    const cp = Math.cos(input.pitch);
    const f = { x: -Math.sin(input.yaw) * cp, y: Math.sin(input.pitch), z: -Math.cos(input.yaw) * cp };
    const r = { x: Math.cos(input.yaw), y: 0, z: -Math.sin(input.yaw) };
    const u = { x: f.y * r.z - f.z * r.y, y: f.z * r.x - f.x * r.z, z: f.x * r.y - f.y * r.x };
    const t = Math.tan(ang);
    let dx = f.x + (r.x * Math.cos(th) + u.x * Math.sin(th)) * t;
    let dy = f.y + (r.y * Math.cos(th) + u.y * Math.sin(th)) * t;
    let dz = f.z + (r.z * Math.cos(th) + u.z * Math.sin(th)) * t;
    const l = Math.hypot(dx, dy, dz);
    input.dx = dx / l; input.dy = dy / l; input.dz = dz / l;
    input.btn |= BTN.FIRE;
    this.recoil += (def.recoil.pattern[0][0] * Math.PI / 180) * 0.6;
  }

  /** Próximo trecho do caminho (A* na grade de navegação), com replanejamento periódico. */
  pathStep(x, z, dt) {
    const rec = this.rec, nav = this.room.bots.nav;
    this.repathAt -= dt;
    if (!this.path || this.repathAt <= 0 || (this.pathGoal && Math.hypot(this.pathGoal.x - x, this.pathGoal.z - z) > 2)) {
      this.path = nav.findPath(rec.move.pos.x, rec.move.pos.z, x, z);
      this.pathIdx = this.path && this.path.length > 1 ? 1 : 0;
      this.pathGoal = { x, z };
      this.repathAt = 2.5 + this.rng();
      if (!this.path) { this.goal = null; return null; }
    }
    let wp = this.path[this.pathIdx];
    while (wp && Math.hypot(wp.x - rec.move.pos.x, wp.z - rec.move.pos.z) < ARRIVE) {
      this.pathIdx++;
      wp = this.path[this.pathIdx];
    }
    if (!wp) { this.path = null; return null; }
    return { x: wp.x - rec.move.pos.x, z: wp.z - rec.move.pos.z };
  }

  /** O próximo meio metro na direção é andável? (evita andar de lado contra a parede) */
  freeAhead(mx, mz) {
    const nav = this.room.bots.nav, p = this.rec.move.pos;
    const l = Math.hypot(mx, mz) || 1;
    const [i, j] = nav.cellOf(p.x + (mx / l) * 0.8, p.z + (mz / l) * 0.8);
    return nav.isWalk(i, j) && nav.clearance[nav.idx(i, j)] >= 1;
  }

  /** Separação: desvia de companheiros muito próximos (sem agir como uma entidade única). */
  separate(dir) {
    const p = this.rec.move.pos;
    for (const r of this.room.records.values()) {
      if (r === this.rec || !r.state.alive) continue;
      const dx = p.x - r.move.pos.x, dz = p.z - r.move.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 1.44 && d2 > 1e-4) { const d = Math.sqrt(d2); dir.x += (dx / d) * (1.2 - d); dir.z += (dz / d) * (1.2 - d); }
    }
  }

  /** Preso numa quina/obstáculo: replaneja; persistindo, tenta um pulo e depois desiste do destino. */
  checkStuck(dt, input) {
    const p = this.rec.move.pos, st = this.stuck;
    st.t += dt;
    if (st.t < 1.2) return;
    const moved = Math.hypot(p.x - st.x, p.z - st.z);
    st.x = p.x; st.z = p.z; st.t = 0;
    if (moved > 0.4) { st.jumps = 0; return; }
    this.path = null;
    st.jumps++;
    if (st.jumps === 2) input.btn |= BTN.JUMP;
    if (st.jumps >= 3) { this.goal = null; st.jumps = 0; if (this.mode !== 'engage') this.mode = 'roam'; }
  }
}

/** Rádio da equipe (Elite): posições vistas pelos aliados, disponíveis após um atraso. */
export class TeamIntel {
  constructor() { this.byTeam = { [TEAM.ALFA]: new Map(), [TEAM.OMEGA]: new Map() }; }
  report(team, enemy, t) { this.byTeam[team]?.set(enemy.sid, { x: enemy.move.pos.x, z: enemy.move.pos.z, t }); }
  recent(team, now, delay, maxAge) {
    let best = null;
    for (const v of (this.byTeam[team] || new Map()).values()) {
      const age = now - v.t;
      if (age < delay || age > maxAge) continue;
      if (!best || v.t > best.t) best = v;
    }
    return best;
  }
  clear() { for (const m of Object.values(this.byTeam)) m.clear(); }
}
