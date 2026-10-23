// Economia ZERO CREDITS: contas, caixas (sorteio no servidor, idempotência, chances publicadas),
// repetidos → fragmentos, equipar só o que possui, recompensas calculadas no servidor com
// identificador único, teto diário, abandono, persistência atômica e API HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Economy } from '../src/economy/economy.js';
import { EconomyStore } from '../src/economy/store.js';
import { ECONOMY, caseById } from '../src/economy/config.js';
import { setEconomy, getEconomy } from '../src/economy/index.js';
import { payMatchRewards } from '../src/economy/match-rewards.js';
import { startServer } from '../src/index.js';
import { RARITIES, RARITY_ORDER, ALL_ITEMS, itemId } from '../../shared/skins.js';
import { MSG, PHASE, TEAM } from '../../shared/protocol.js';
import { createTestRoom, addPlayer, messagesTo } from './helpers.js';

const fresh = (opts) => new Economy(new EconomyStore(null), opts);
let reqN = 0;
const rid = () => `req-${Date.now().toString(36)}-${reqN++}`;

test('E1 — conta: token aleatório (só o hash é guardado) e bônus de boas-vindas registrado', () => {
  const e = fresh();
  const { token, account } = e.createAccount({ name: 'Ana' });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(account.credits, ECONOMY.welcomeCredits);
  assert.ok(!JSON.stringify(e.data).includes(token), 'o token não aparece no armazenamento');
  assert.equal(e.authenticate(token).id, account.id);
  assert.equal(e.authenticate(`${token.slice(0, -1)}x`), null);
  assert.equal(e.authenticate('curto'), null);
  assert.equal(e.store.ledger.filter((t) => t.kind === 'welcome' && t.account === account.id).length, 1);
});

test('E2 — caixa: cobra, concede, registra e é idempotente por requestId', () => {
  const e = fresh();
  const { token } = e.createAccount();
  const acc = e.authenticate(token);
  const id = rid();
  const r1 = e.openCase(acc, 'campo', id);
  assert.equal(acc.credits, ECONOMY.welcomeCredits - 250);
  assert.ok(acc.inventory[r1.item], 'item no inventário');
  const r2 = e.openCase(acc, 'campo', id);
  assert.equal(r2.repeated, true);
  assert.equal(r2.item, r1.item, 'mesmo resultado no pedido repetido');
  assert.equal(acc.credits, ECONOMY.welcomeCredits - 250, 'não cobra duas vezes');
  assert.equal(e.store.ledger.filter((t) => t.kind === 'case_open').length, 1, 'uma única transação');
  assert.throws(() => e.openCase(acc, 'precisao', id), /já usado/);
  assert.throws(() => e.openCase(acc, 'campo', rid()), (err) => err.status === 402, 'saldo insuficiente');
  assert.throws(() => e.openCase(acc, 'inexistente', rid()), (err) => err.status === 404);
  assert.throws(() => e.openCase(acc, 'campo', '../x'), (err) => err.status === 400);
});

test('E3 — sorteio segue as chances publicadas e respeita o conteúdo da caixa', () => {
  const e = fresh();
  for (const c of ECONOMY.cases) {
    const sum = RARITY_ORDER.reduce((a, r) => a + c.odds[r], 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${c.id}: chances somam 100%`);
    const shown = e.shopCatalog().cases.find((x) => x.id === c.id);
    for (const o of shown.odds) assert.equal(o.chance, c.odds[o.rarity], 'catálogo mostra as chances reais');
  }
  const c = caseById('campo');
  const N = 40000;
  const count = Object.fromEntries(RARITY_ORDER.map((r) => [r, 0]));
  for (let i = 0; i < N; i++) count[e.rollRarity(c.odds)]++;
  for (const r of RARITY_ORDER) {
    const p = c.odds[r], obs = count[r] / N;
    const sd = Math.sqrt((p * (1 - p)) / N);
    assert.ok(Math.abs(obs - p) < 5 * sd + 1e-4, `${r}: observado ${obs.toFixed(4)} vs ${p}`);
  }
  // caixa de precisão: só sniper/pistola
  const { token } = e.createAccount();
  const acc = e.authenticate(token);
  acc.credits = 10000;
  for (let i = 0; i < 20; i++) {
    const r = e.openCase(acc, 'precisao', rid());
    assert.ok(['sniper', 'pistol'].includes(r.weapon));
  }
});

test('E4 — repetidos viram fragmentos; caixa de fragmentos', () => {
  // sorteio fixo: sempre o primeiro item comum
  const e = fresh({ rng: () => 0 });
  const { token } = e.createAccount();
  const acc = e.authenticate(token);
  acc.credits = 1000;
  const a = e.openCase(acc, 'campo', rid());
  assert.equal(a.duplicate, false);
  const b = e.openCase(acc, 'campo', rid());
  assert.equal(b.item, a.item);
  assert.equal(b.duplicate, true);
  assert.equal(b.fragmentsGained, RARITIES.common.fragments);
  assert.equal(acc.fragments, RARITIES.common.fragments);
  assert.equal(Object.keys(acc.inventory).length, 1, 'repetido não duplica o inventário');
  acc.fragments = 200;
  const c = e.openCase(acc, 'oficina', rid());
  assert.equal(acc.fragments, 200 - 120 + (c.duplicate ? c.fragmentsGained : 0));
});

test('E5 — equipar: só itens possuídos; remover volta ao padrão', () => {
  const e = fresh({ rng: () => 0 });
  const { token } = e.createAccount();
  const acc = e.authenticate(token);
  const r = e.openCase(acc, 'campo', rid());
  assert.throws(() => e.equip(acc, r.weapon, r.skin === 'carbono' ? 'grafite' : 'carbono'), (err) => err.status === 403);
  assert.throws(() => e.equip(acc, 'bazuca', r.skin), (err) => err.status === 400);
  assert.throws(() => e.equip(acc, r.weapon, 'ouro'), (err) => err.status === 400);
  const v = e.equip(acc, r.weapon, r.skin);
  assert.equal(v.equipped[r.weapon], r.skin);
  assert.deepEqual(e.equippedFor(acc), { [r.weapon]: r.skin });
  assert.equal(e.equip(acc, r.weapon, null).equipped[r.weapon], undefined);
  // inventário inventado no cliente não vale: equippedFor ignora itens não possuídos
  acc.equipped.rifle = 'circuito';
  if (!acc.inventory[itemId('rifle', 'circuito')]) assert.equal(e.equippedFor(acc).rifle, undefined);
});

test('E6 — recompensa: valores centrais, limites, inatividade e partidas curtas', () => {
  const base = { won: false, kills: 0, botKills: 0, headshots: 0, plants: 0, defuses: 0, activeSeconds: 300, matchSeconds: 400 };
  assert.equal(Economy.computeReward(base).total, 100, 'conclusão');
  assert.equal(Economy.computeReward({ ...base, won: true }).total, 175, 'vitória +75');
  assert.equal(Economy.computeReward({ ...base, kills: 40, headshots: 30 }).performance, 50, 'desempenho limitado a 50');
  assert.equal(Economy.computeReward({ ...base, botKills: 4 }).performance, 12, 'eliminações de bots valem metade');
  assert.equal(Economy.computeReward({ ...base, plants: 2, defuses: 2 }).objective, 50, 'objetivo limitado a 50');
  assert.equal(Economy.computeReward({ ...base, activeSeconds: 5 }).total, 0, 'ocioso não recebe');
  const short = Economy.computeReward({ ...base, won: true, matchSeconds: 60, activeSeconds: 50 });
  assert.ok(short.total < 175 && short.total > 0, `partida curta rende proporcionalmente (${short.total})`);
});

test('E7 — conclusão paga uma única vez; teto diário', () => {
  const e = fresh();
  const { token } = e.createAccount();
  const acc = e.authenticate(token);
  const bd = Economy.computeReward({ won: true, kills: 3, botKills: 0, headshots: 1, plants: 0, defuses: 0, activeSeconds: 300, matchSeconds: 400 });
  const before = acc.credits;
  const r1 = e.grantMatchReward(acc, 'sala:1:acc', bd);
  const r2 = e.grantMatchReward(acc, 'sala:1:acc', bd);
  assert.equal(r2.repeated, true);
  assert.equal(acc.credits, before + bd.total, 'pago uma vez');
  assert.equal(r1.granted, bd.total);
  for (let i = 2; i < 30; i++) e.grantMatchReward(acc, `sala:${i}:acc`, bd);
  assert.equal(acc.daily.earned, ECONOMY.rewards.dailyCap, 'teto diário aplicado');
  const capped = e.grantMatchReward(acc, 'sala:99:acc', bd);
  assert.equal(capped.granted, 0);
  assert.equal(capped.capped, true);
});

test('E8 — sala: paga quem terminou, não quem saiu; nunca duas vezes; nada vem do cliente', () => {
  const e = fresh();
  setEconomy(e);
  const room = createTestRoom('tdm');
  const a = addPlayer(room, { name: 'Ana', team: TEAM.ALFA });
  const b = addPlayer(room, { name: 'Bia', team: TEAM.OMEGA });
  const ta = e.createAccount({ name: 'Ana' }), tb = e.createAccount({ name: 'Bia' });
  a.accountId = ta.account.id; b.accountId = tb.account.id;
  room.flow.beginMatch();
  room.flow.matchTime = 400;
  a.matchStats.active = 300; b.matchStats.active = 300;
  a.state.kills = 5; a.matchStats.headshots = 2;
  b.state.connected = false;           // Bia abandonou antes do fim
  room.state.phase = PHASE.LIVE;
  room.flow.endMatch(TEAM.ALFA, 'score');
  const ra = messagesTo(a, MSG.REWARD);
  assert.equal(ra.length, 1);
  assert.equal(ra[0].completion, 100);
  assert.equal(ra[0].win, 75);
  assert.equal(ra[0].performance, 34);
  assert.equal(e.data.accounts[a.accountId].credits, ECONOMY.welcomeCredits + 209);
  assert.equal(e.data.accounts[b.accountId].credits, ECONOMY.welcomeCredits, 'quem abandonou não recebe');
  // novo endMatch (fase já encerrada) e repetição do pagamento não pagam de novo
  room.flow.endMatch(TEAM.ALFA, 'score');
  payMatchRewards(room, TEAM.ALFA);
  assert.equal(e.data.accounts[a.accountId].credits, ECONOMY.welcomeCredits + 209);
  // convidado (sem conta) é informado, sem saldo
  const room2 = createTestRoom('tdm');
  const g = addPlayer(room2, { name: 'Gui' });
  room2.flow.beginMatch(); room2.flow.matchTime = 200; g.matchStats.active = 150;
  room2.state.phase = PHASE.LIVE;
  room2.flow.endMatch(0, 'time');
  assert.equal(messagesTo(g, MSG.REWARD)[0].guest, true);
  setEconomy(fresh());
});

test('E9 — persistência: gravação atômica, recarga e arquivo corrompido preservado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oz-eco-'));
  const s1 = new EconomyStore(dir);
  const e1 = new Economy(s1);
  const { token } = e1.createAccount({ name: 'Persiste' });
  e1.openCase(e1.authenticate(token), 'campo', rid());
  s1.flush();
  const e2 = new Economy(new EconomyStore(dir));
  const acc = e2.authenticate(token);
  assert.ok(acc, 'conta recarregada do disco');
  assert.equal(acc.credits, ECONOMY.welcomeCredits - 250);
  assert.equal(Object.keys(acc.inventory).length, 1);
  const lines = fs.readFileSync(path.join(dir, 'transactions.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2, 'boas-vindas + caixa no registro de transações');
  fs.writeFileSync(path.join(dir, 'economy.json'), '{quebrado');
  const s3 = new EconomyStore(dir);
  assert.deepEqual(Object.keys(s3.data.accounts), []);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('economy.json.corrupt-')), 'cópia do arquivo ilegível');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('E11 — falha ao registrar a transação desfaz a operação (nada concedido sem registro)', () => {
  const e = fresh({ rng: () => 0 });
  const { token } = e.createAccount();
  const acc = e.authenticate(token);
  const before = JSON.stringify(acc);
  e.store.record = () => { throw new Error('disco cheio'); };
  assert.throws(() => e.openCase(acc, 'campo', rid()), (err) => err.status === 503);
  assert.equal(JSON.stringify(acc), before, 'saldo, inventário e pedidos inalterados');
  const bd = Economy.computeReward({ won: true, kills: 0, botKills: 0, headshots: 0, plants: 0, defuses: 0, activeSeconds: 300, matchSeconds: 400 });
  assert.throws(() => e.grantMatchReward(acc, 'x:1:y', bd), (err) => err.status === 503);
  assert.equal(acc.credits, ECONOMY.welcomeCredits);
  assert.equal(e.data.completions['x:1:y'], undefined, 'conclusão não marcada como paga');
  assert.throws(() => e.createAccount(), (err) => err.status === 503);
});

// ---- API HTTP -------------------------------------------------------------------
const PORT = 27000 + Math.floor(Math.random() * 1500);
const URL = `http://127.0.0.1:${PORT}`;
let server;
before(async () => { setEconomy(fresh()); server = await startServer({ port: PORT, host: '127.0.0.1' }); });
after(async () => { await server.gracefullyShutdown(false); });

const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(`${URL}${p}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
};

test('E10 — API: conta, loja, abertura idempotente, equipar e acesso negado sem token', async () => {
  const created = await api('POST', '/api/account', { body: { name: 'Api' } });
  assert.equal(created.status, 200);
  const token = created.data.token;
  assert.equal((await api('GET', '/api/account')).status, 401);
  assert.equal((await api('GET', '/api/account', { token: 'x'.repeat(43) })).status, 401);
  const me = await api('GET', '/api/account', { token });
  assert.equal(me.data.credits, ECONOMY.welcomeCredits);
  assert.equal(me.data.tokenHash, undefined);
  const shop = await api('GET', '/api/shop');
  assert.equal(shop.data.cases.length, ECONOMY.cases.length);
  assert.ok(shop.data.cases[0].odds.length === 4);
  const requestId = rid();
  const o1 = await api('POST', '/api/shop/open', { token, body: { caseId: 'campo', requestId } });
  const o2 = await api('POST', '/api/shop/open', { token, body: { caseId: 'campo', requestId } });
  assert.equal(o1.status, 200);
  assert.equal(o2.data.item, o1.data.item);
  assert.equal(o2.data.account.credits, ECONOMY.welcomeCredits - 250);
  // tentar escolher o resultado não tem efeito (campos extras ignorados)
  const forced = await api('POST', '/api/shop/open', { token, body: { caseId: 'campo', requestId: rid(), item: 'rifle.circuito', rarity: 'legendary' } });
  assert.equal(forced.status, 402, 'sem saldo: o pedido é recusado, nada é concedido');
  const eq = await api('POST', '/api/inventory/equip', { token, body: { weapon: o1.data.weapon, skin: o1.data.skin } });
  assert.equal(eq.data.equipped[o1.data.weapon], o1.data.skin);
  const bad = await api('POST', '/api/inventory/equip', { token, body: { weapon: 'rifle', skin: 'circuito' } });
  if (o1.data.item !== 'rifle.circuito') assert.equal(bad.status, 403);
  assert.ok(ALL_ITEMS.some((i) => i.id === o1.data.item));
  assert.ok(getEconomy().store.ledger.some((t) => t.kind === 'case_open'));
});
