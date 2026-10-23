// Serviço da economia: contas (token aleatório; só o hash é guardado), saldo, inventário,
// abertura de caixas (sorteio criptográfico no servidor, idempotente), equipar acabamentos e
// recompensas de partida (identificador único de conclusão — nunca pagas duas vezes).
import crypto from 'node:crypto';
import { RARITIES, RARITY_ORDER, SKINS, ALL_ITEMS, itemId, parseItemId, isSkinnableWeapon, isValidSkin, skinById } from '../../../shared/skins.js';
import { sanitizeName } from '../../../shared/protocol.js';
import { ECONOMY, caseById } from './config.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;
const REQUEST_RE = /^[A-Za-z0-9-]{8,64}$/;
const today = () => new Date().toISOString().slice(0, 10);

export class EconomyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class Economy {
  constructor(store, { rng = null } = {}) {
    this.store = store;
    // fonte de aleatoriedade: crypto.randomInt (injeção só para testes determinísticos)
    this.randomInt = rng || ((max) => crypto.randomInt(max));
    this.ipLog = new Map();
  }

  get data() { return this.store.data; }

  /**
   * Executa uma operação que altera a conta e registra a transação. Se o registro falhar (ex.: disco
   * cheio), a conta volta ao estado anterior: nada é concedido sem a transação correspondente.
   */
  transact(acc, fn) {
    const snapshot = JSON.stringify(acc);
    try {
      return fn();
    } catch (err) {
      if (err instanceof EconomyError) throw err;
      Object.assign(acc, JSON.parse(snapshot));
      throw new EconomyError(503, 'Não foi possível registrar a operação agora. Nada foi alterado; tente novamente.');
    }
  }

  // ---- contas ----------------------------------------------------------------------
  createAccount({ name = '', ip = 'unknown' } = {}) {
    const now = Date.now();
    const recent = (this.ipLog.get(ip) || []).filter((t) => now - t < 3600e3);
    if (recent.length >= ECONOMY.accountsPerIpPerHour) throw new EconomyError(429, 'Muitas contas criadas a partir desta conexão. Tente mais tarde.');
    recent.push(now);
    this.ipLog.set(ip, recent);
    const token = crypto.randomBytes(32).toString('base64url');
    const id = `acc_${crypto.randomBytes(9).toString('base64url')}`;
    const acc = {
      id, name: sanitizeName(name) || '', createdAt: new Date(now).toISOString(),
      credits: 0, fragments: 0, inventory: {}, equipped: {},
      daily: { day: today(), earned: 0 }, history: [], requests: {}, requestOrder: [],
      stats: { matches: 0, wins: 0 },
    };
    try {
      this.credit(acc, ECONOMY.welcomeCredits, 'welcome', { note: 'Bônus de boas-vindas' });
    } catch {
      throw new EconomyError(503, 'Não foi possível criar a conta agora. Tente novamente.');
    }
    this.data.accounts[id] = acc;
    this.data.tokens[sha256(token)] = id;
    this.store.save();
    return { token, account: this.view(acc) };
  }

  /** Conta do token (ou null). O token em si nunca é guardado. */
  authenticate(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const id = this.data.tokens[sha256(token)];
    return id ? this.data.accounts[id] || null : null;
  }

  require(token) {
    const acc = this.authenticate(token);
    if (!acc) throw new EconomyError(401, 'Conta não encontrada. Ela pode ter sido apagada numa reinicialização do servidor.');
    return acc;
  }

  /** Visão pública da conta (sem token/hash, sem pedidos internos). */
  view(acc) {
    return {
      id: acc.id, name: acc.name, credits: acc.credits, fragments: acc.fragments,
      inventory: Object.keys(acc.inventory).sort(), equipped: { ...acc.equipped },
      daily: { earned: acc.daily.day === today() ? acc.daily.earned : 0, cap: ECONOMY.rewards.dailyCap },
      history: acc.history.slice(-15).reverse(), stats: { ...acc.stats },
    };
  }

  // ---- movimentação (todas registradas) -----------------------------------------------
  credit(acc, amount, kind, extra = {}) {
    acc.credits += amount;
    try { return this.log(acc, { kind, credits: amount, ...extra }); } catch (err) { acc.credits -= amount; throw err; }
  }

  log(acc, tx) {
    const entry = this.store.record({ account: acc.id, balance: acc.credits, fragments: acc.fragments, ...tx });
    acc.history.push({ at: entry.at, kind: tx.kind, credits: tx.credits || 0, fragments: tx.fragmentsDelta || 0, item: tx.item || null, note: tx.note || '' });
    if (acc.history.length > ECONOMY.historyPerAccount) acc.history.splice(0, acc.history.length - ECONOMY.historyPerAccount);
    return entry;
  }

  // ---- loja ------------------------------------------------------------------------------
  /** Catálogo público: preços, chances (as mesmas usadas no sorteio) e itens possíveis. */
  shopCatalog() {
    return {
      currency: ECONOMY.currency,
      cases: ECONOMY.cases.map((c) => ({
        id: c.id, name: c.name, description: c.description, currency: c.currency, price: c.price,
        odds: RARITY_ORDER.map((r) => ({ rarity: r, label: RARITIES[r].label, chance: c.odds[r] })),
        items: this.caseItems(c).map((i) => i.id),
      })),
      rarities: RARITY_ORDER.map((r) => ({ ...RARITIES[r] })),
      skins: SKINS.map((s) => ({ id: s.id, name: s.name, rarity: s.rarity, description: s.description })),
      duplicates: 'Itens repetidos são convertidos em fragmentos (valor conforme a raridade).',
    };
  }

  caseItems(c) { return ALL_ITEMS.filter((i) => !c.weapons || c.weapons.includes(i.weapon)); }

  /**
   * Abre uma caixa. Idempotente por `requestId`: repetir o mesmo pedido devolve o MESMO resultado
   * sem cobrar de novo. O cliente nunca escolhe o resultado.
   */
  openCase(acc, caseId, requestId) {
    if (typeof requestId !== 'string' || !REQUEST_RE.test(requestId)) throw new EconomyError(400, 'Pedido inválido.');
    const prev = acc.requests[requestId];
    if (prev) {
      if (prev.caseId !== caseId) throw new EconomyError(409, 'Identificador de pedido já usado para outra operação.');
      return { ...prev.result, repeated: true, account: this.view(acc) };
    }
    const c = caseById(caseId);
    if (!c) throw new EconomyError(404, 'Caixa desconhecida.');
    const wallet = c.currency === 'fragments' ? 'fragments' : 'credits';
    if (acc[wallet] < c.price) throw new EconomyError(402, wallet === 'credits' ? 'ZERO CREDITS insuficientes.' : 'Fragmentos insuficientes.');

    // sorteio: raridade pelas chances publicadas; depois item uniforme dentro da raridade
    const rarity = this.rollRarity(c.odds);
    const pool = this.caseItems(c).filter((i) => i.rarity === rarity);
    const item = pool[this.randomInt(pool.length)];
    const result = this.transact(acc, () => {
      acc[wallet] -= c.price;
      const duplicate = !!acc.inventory[item.id];
      let fragmentsGained = 0;
      if (duplicate) {
        fragmentsGained = RARITIES[rarity].fragments;
        acc.fragments += fragmentsGained;
      } else acc.inventory[item.id] = { at: new Date().toISOString(), source: c.id };
      const tx = this.log(acc, {
        kind: 'case_open', case: c.id, request: requestId, item: item.id, rarity, duplicate,
        credits: wallet === 'credits' ? -c.price : 0, fragmentsDelta: (wallet === 'fragments' ? -c.price : 0) + fragmentsGained,
      });
      const res = { caseId: c.id, item: item.id, weapon: item.weapon, skin: item.skin, rarity, duplicate, fragmentsGained, transaction: tx.at };
      acc.requests[requestId] = { caseId, result: res };
      acc.requestOrder.push(requestId);
      while (acc.requestOrder.length > ECONOMY.requestsRemembered) delete acc.requests[acc.requestOrder.shift()];
      return res;
    });
    this.store.save();
    return { ...result, repeated: false, account: this.view(acc) };
  }

  /** Sorteio por inteiros (sem viés de ponto flutuante): chances em partes por 100 000. */
  rollRarity(odds) {
    const SCALE = 100000;
    let roll = this.randomInt(SCALE);
    for (const r of RARITY_ORDER) {
      const w = Math.round((odds[r] || 0) * SCALE);
      if (roll < w) return r;
      roll -= w;
    }
    return RARITY_ORDER[0];
  }

  /** Equipa (ou remove, skin = null) um acabamento que a conta possui. */
  equip(acc, weapon, skin) {
    if (!isSkinnableWeapon(weapon)) throw new EconomyError(400, 'Arma inválida.');
    const clear = skin === null || skin === '' || skin === undefined;
    if (!clear) {
      if (!isValidSkin(skin)) throw new EconomyError(400, 'Acabamento inválido.');
      if (!acc.inventory[itemId(weapon, skin)]) throw new EconomyError(403, 'Você não possui este item.');
    }
    this.transact(acc, () => {
      if (clear) delete acc.equipped[weapon]; else acc.equipped[weapon] = skin;
      this.log(acc, { kind: 'equip', item: clear ? `${weapon}.padrao` : itemId(weapon, skin) });
    });
    this.store.save();
    return this.view(acc);
  }

  /** Acabamentos equipados que ainda pertencem à conta (o que vai para a partida). */
  equippedFor(acc) {
    const out = {};
    for (const [w, s] of Object.entries(acc?.equipped || {})) if (acc.inventory[itemId(w, s)]) out[w] = s;
    return out;
  }

  // ---- recompensas de partida -------------------------------------------------------
  /**
   * Calcula a recompensa de quem TERMINOU a partida (o servidor fornece todos os números).
   * p = { won, kills, botKills, headshots, plants, defuses, activeSeconds, matchSeconds }
   */
  static computeReward(p) {
    const R = ECONOMY.rewards;
    const minActive = Math.min(R.minActiveSeconds, p.matchSeconds * R.minActiveFraction);
    if (!(p.activeSeconds >= minActive) || p.matchSeconds <= 0) return { eligible: false, reason: 'inativo', completion: 0, win: 0, performance: 0, objective: 0, total: 0 };
    const scale = Math.min(1, p.matchSeconds / R.fullValueAfterSeconds);
    const perf = Math.min(R.performance.max, p.kills * R.performance.perKill + p.botKills * R.performance.perBotKill + p.headshots * R.performance.perHeadshot);
    const obj = Math.min(R.objective.max, p.plants * R.objective.plant + p.defuses * R.objective.defuse);
    const completion = Math.round(R.completion * scale);
    const win = p.won ? Math.round(R.win * scale) : 0;
    const performance = Math.round(perf * scale);
    const objective = Math.round(obj * scale);
    return { eligible: true, completion, win, performance, objective, total: completion + win + performance + objective };
  }

  /**
   * Paga uma conclusão. `completionId` é único por (sala, partida, conta): repetir não paga de novo.
   * Retorna o resultado aplicado (com o teto diário).
   */
  grantMatchReward(acc, completionId, breakdown, meta = {}) {
    if (this.data.completions[completionId]) return { ...this.data.completions[completionId].result, repeated: true };
    const day = today();
    if (acc.daily.day !== day) acc.daily = { day, earned: 0 };
    const room = Math.max(0, ECONOMY.rewards.dailyCap - acc.daily.earned);
    const granted = Math.min(breakdown.total, room);
    const result = this.transact(acc, () => {
      acc.credits += granted;
      acc.daily.earned += granted;
      acc.stats.matches += 1;
      if (breakdown.win > 0) acc.stats.wins += 1;
      this.log(acc, { kind: 'match_reward', completion: completionId, credits: granted, breakdown, ...meta });
      return { ...breakdown, granted, capped: granted < breakdown.total, balance: acc.credits };
    });
    this.data.completions[completionId] = { at: Date.now(), account: acc.id, result };
    this.pruneCompletions();
    this.store.save();
    return { ...result, repeated: false };
  }

  pruneCompletions() {
    const cutoff = Date.now() - 14 * 86400e3;
    for (const [k, v] of Object.entries(this.data.completions)) if (v.at < cutoff) delete this.data.completions[k];
  }
}

export { skinById, parseItemId };
