// LOJA: caixas (preço e chances publicadas pelo servidor), abertura animada, inventário e histórico.
// O resultado de cada caixa é sorteado e gravado no SERVIDOR antes da animação começar — a roleta
// apenas apresenta o item já concedido. Sem servidor, a loja mostra o motivo e não simula nada.
import { RARITIES, SKINS, skinById } from '../shared/skins.js';
import { weaponById } from '../shared/weapon-rules.js';
import { skinSwatch } from '../skins-render.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const pct = (p) => `${(p * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('pt-BR') : '—');
const itemName = (id) => { const [w, s] = id.split('.'); return `${weaponById(w)?.name || w} · ${skinById(s)?.name || s}`; };
const TX_LABELS = { welcome: 'Bônus de boas-vindas', case_open: 'Caixa aberta', match_reward: 'Recompensa de partida', equip: 'Acabamento equipado' };

/** Miniatura do acabamento (amostra do padrão real usado no jogo). */
function swatch(skinId, size = 56) {
  const c = el('canvas', 'swatch');
  c.width = c.height = size;
  const src = skinSwatch(skinId);
  if (src) c.getContext('2d').drawImage(src, 0, 0, 128, 128, 0, 0, size, size);
  return c;
}

export class ShopView {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.el = {
      credits: $('shop-credits'), fragments: $('shop-fragments'), daily: $('shop-daily'), dailyCap: $('shop-daily-cap'),
      status: $('shop-status'), cases: $('case-grid'), inv: $('inv-grid'), invCount: $('inv-count'), tx: $('tx-list'),
      wallet: $('wallet-credits'), overlay: $('case-open'), reel: $('case-reel'), result: $('case-result'),
      rarity: $('case-rarity'), item: $('case-item'), note: $('case-note'), equipBtn: $('case-equip'),
    };
    this.busy = false;
    this.last = null;
    game.account.onChange(() => this.refresh());
  }

  get account() { return this.game.account; }

  /** Ao abrir a aba: garante a conta e busca catálogo e saldo atuais. */
  async enter() {
    this.setStatus('Conectando à loja…');
    await this.account.ensure(this.game.profile.name);
    if (this.account.status !== 'ready') { this.setStatus('Loja indisponível: servidor online fora do ar. Saldo e inventário ficam no servidor e voltam quando ele estiver disponível.', 'error'); this.refresh(); return; }
    try { await this.account.loadShop(); await this.account.refresh(); } catch (err) { this.setStatus(`Falha ao carregar a loja: ${err.message}`, 'error'); return; }
    this.setStatus(this.account.notice || '');
    this.account.notice = '';
    this.refresh();
  }

  setStatus(text, kind = '') { this.el.status.textContent = text; this.el.status.className = `shop-status ${kind}`; }

  refresh() {
    const acc = this.account.account;
    const online = this.account.status === 'ready' && acc;
    this.el.wallet.textContent = online ? fmt(acc.credits) : '—';
    this.el.credits.textContent = online ? fmt(acc.credits) : '—';
    this.el.fragments.textContent = online ? fmt(acc.fragments) : '—';
    this.el.daily.textContent = online ? `${fmt(acc.daily.earned)}` : '—';
    this.el.dailyCap.textContent = online ? `DE ${fmt(acc.daily.cap)} POR DIA` : 'LIMITE DIÁRIO';
    this.renderCases();
    this.renderInventory();
    this.renderHistory();
  }

  renderCases() {
    const shop = this.account.shop;
    if (!shop) { this.el.cases.replaceChildren(el('p', 'muted', 'Catálogo indisponível sem conexão com o servidor.')); return; }
    const acc = this.account.account;
    this.el.cases.replaceChildren(...shop.cases.map((c) => {
      const card = el('article', 'case-card');
      const head = el('header');
      head.append(el('h3', null, c.name), el('span', 'price', `${fmt(c.price)} ${c.currency === 'credits' ? 'ZC' : 'FRAG.'}`));
      const odds = el('ul', 'odds');
      for (const o of c.odds) {
        const li = el('li');
        li.style.setProperty('--rc', RARITIES[o.rarity].color);
        li.append(el('span', null, o.label), el('b', null, pct(o.chance)));
        odds.append(li);
      }
      const strip = el('div', 'case-strip');
      SKINS.forEach((s) => { const sw = swatch(s.id, 34); sw.title = `${s.name} (${RARITIES[s.rarity].label})`; sw.style.borderColor = RARITIES[s.rarity].color; strip.append(sw); });
      const weapons = [...new Set(c.items.map((i) => i.split('.')[0]))].map((w) => weaponById(w)?.name || w).join(', ');
      const wallet = c.currency === 'credits' ? acc?.credits : acc?.fragments;
      const btn = el('button', 'btn primary', 'ABRIR');
      btn.type = 'button';
      btn.disabled = this.busy || !acc || wallet < c.price;
      if (acc && wallet < c.price) btn.textContent = c.currency === 'credits' ? 'CRÉDITOS INSUFICIENTES' : 'FRAGMENTOS INSUFICIENTES';
      btn.addEventListener('click', () => this.open(c));
      card.append(head, el('p', 'muted small', c.description), strip, el('p', 'small', `Armas: ${weapons}`), odds, el('p', 'muted small', 'Chances definidas no servidor e exibidas antes da compra. Repetidos viram fragmentos.'), btn);
      return card;
    }));
  }

  renderInventory() {
    const acc = this.account.account;
    const items = acc ? acc.inventory : [];
    const total = this.account.shop ? new Set(this.account.shop.cases.flatMap((c) => c.items)).size : 0;
    this.el.invCount.textContent = total ? `${items.length} / ${total}` : String(items.length);
    if (!items.length) { this.el.inv.replaceChildren(el('p', 'muted small', acc ? 'Nenhum acabamento ainda. Abra uma caixa!' : 'Conecte-se ao servidor para ver o inventário.')); return; }
    const eq = acc.equipped || {};
    this.el.inv.replaceChildren(...items.map((id) => {
      const [w, s] = id.split('.');
      const skin = skinById(s);
      const b = el('button', `inv-item${eq[w] === s ? ' equipped' : ''}`);
      b.type = 'button';
      b.style.setProperty('--rc', RARITIES[skin.rarity].color);
      b.append(swatch(s, 40), el('span', null, itemName(id)), el('small', null, eq[w] === s ? 'EQUIPADO' : RARITIES[skin.rarity].label));
      b.title = eq[w] === s ? 'Clique para voltar ao acabamento de fábrica' : 'Clique para equipar';
      b.addEventListener('click', () => this.equip(w, eq[w] === s ? null : s));
      return b;
    }));
  }

  renderHistory() {
    const acc = this.account.account;
    const list = acc ? acc.history : [];
    if (!list.length) { this.el.tx.replaceChildren(el('li', 'muted small', 'Sem transações.')); return; }
    this.el.tx.replaceChildren(...list.slice(0, 10).map((t) => {
      const li = el('li');
      const amount = t.credits ? `${t.credits > 0 ? '+' : ''}${fmt(t.credits)} ZC` : t.fragments ? `${t.fragments > 0 ? '+' : ''}${fmt(t.fragments)} FRAG.` : '';
      li.append(el('span', null, TX_LABELS[t.kind] || t.kind), el('small', 'muted', t.item ? itemName(t.item) : new Date(t.at).toLocaleString('pt-BR')), el('b', t.credits < 0 ? 'neg' : 'pos', amount));
      return li;
    }));
  }

  async equip(weapon, skin) {
    try {
      await this.account.equip(weapon, skin);
      this.game.audio.play('uiConfirm');
      this.setStatus(skin ? `${itemName(`${weapon}.${skin}`)} equipado.` : `${weaponById(weapon)?.name} com acabamento de fábrica.`, 'good');
    } catch (err) { this.setStatus(err.message, 'error'); }
  }

  // ---- abertura -------------------------------------------------------------------------
  async open(c) {
    if (this.busy) return;
    this.busy = true;
    this.renderCases();
    this.setStatus('');
    let res;
    try {
      res = await this.account.openCase(c.id);   // sorteio e registro no servidor
    } catch (err) {
      this.busy = false;
      this.setStatus(`${err.message}${err.status ? '' : ' Tente de novo: o mesmo pedido é reaproveitado e nunca é cobrado duas vezes.'}`, 'error');
      this.renderCases();
      return;
    }
    this.last = res;
    await this.playReel(c, res);
    this.busy = false;
    this.refresh();
  }

  /** Roleta: cartões de enchimento (cosméticos) + o item JÁ concedido pelo servidor na posição final. */
  playReel(c, res) {
    const O = this.el;
    const N = 44, WIN = 38;
    const pool = c.items;
    const cards = [];
    for (let i = 0; i < N; i++) {
      const id = i === WIN ? res.item : pool[Math.floor(Math.random() * pool.length)];
      const [, s] = id.split('.');
      const card = el('div', 'reel-card');
      card.style.setProperty('--rc', RARITIES[skinById(s).rarity].color);
      card.append(swatch(s, 72), el('span', null, itemName(id)));
      cards.push(card);
    }
    O.reel.replaceChildren(...cards);
    O.result.classList.add('hidden');
    O.overlay.classList.remove('hidden');
    O.reel.style.transition = 'none';
    O.reel.style.transform = 'translateX(0)';
    const reduced = this.game.reducedMotion;
    this.game.audio.play('uiConfirm');
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        const cardW = cards[0].getBoundingClientRect().width + 10;
        const view = O.reel.parentElement.getBoundingClientRect().width;
        const offset = WIN * cardW - view / 2 + cardW / 2 + (Math.random() - 0.5) * cardW * 0.5;
        const dur = reduced ? 0.4 : 4.2;
        O.reel.style.transition = `transform ${dur}s cubic-bezier(0.12, 0.72, 0.16, 1)`;
        O.reel.style.transform = `translateX(${-offset}px)`;
        let ticks = 0;
        const tick = reduced ? 0 : setInterval(() => { if (ticks++ < 26) this.game.audio.play('uiHover'); }, 140);
        setTimeout(() => {
          clearInterval(tick);
          this.showResult(res);
          resolve();
        }, dur * 1000 + 150);
      });
    });
  }

  showResult(res) {
    const O = this.el;
    const r = RARITIES[res.rarity];
    O.rarity.textContent = r.label;
    O.rarity.style.setProperty('--rc', r.color);
    O.item.textContent = itemName(res.item);
    O.note.textContent = res.duplicate
      ? `Repetido: convertido em ${res.fragmentsGained} fragmentos.`
      : 'Adicionado ao inventário. Visual apenas — os atributos da arma não mudam.';
    O.equipBtn.hidden = res.duplicate && this.account.equipped()[res.weapon] === res.skin;
    O.result.classList.remove('hidden');
    this.game.audio.play(res.rarity === 'legendary' || res.rarity === 'epic' ? 'victory' : 'uiConfirm');
    O.equipBtn.focus();
  }

  equipLast() {
    const r = this.last;
    if (r) this.equip(r.weapon, r.skin);
    this.close();
  }

  close() { this.el.overlay.classList.add('hidden'); }
}
