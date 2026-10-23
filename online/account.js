// Conta online (ZERO CREDITS, inventário e acabamentos). O saldo exibido vem SEMPRE do servidor:
// o navegador guarda apenas o token de acesso (gerado pelo servidor) e uma cópia de leitura do
// último estado recebido. Nada aqui concede moedas ou itens — só pede ao servidor.
const TOKEN_KEY = 'oz-account-token';

function readToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function writeToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* armazenamento indisponível */ } }
const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9-]/g, '');

export class AccountClient {
  constructor(conn) {
    this.conn = conn;              // OnlineConnection (resolve o endereço do servidor)
    this.token = readToken();
    this.account = null;           // último estado confirmado pelo servidor
    this.shop = null;
    this.status = 'idle';          // idle | loading | ready | offline
    this.notice = '';
    this.listeners = new Set();
    this.pendingOpen = null;       // { caseId, requestId } repetido em caso de falha de rede
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(this); } catch (err) { console.warn('[conta]', err); } } }

  async request(method, path, body) {
    const base = await this.conn.resolveServer();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${base}${path}`, {
        method, signal: ctrl.signal, cache: 'no-store',
        headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || `Erro ${res.status}`), { status: res.status });
      return data;
    } finally { clearTimeout(timer); }
  }

  /** Garante uma conta: usa o token salvo ou cria uma nova (o servidor gera o token). */
  async ensure(name = '') {
    if (this.status === 'loading') return this.loading;
    this.status = 'loading';
    this.emit();
    this.loading = (async () => {
      try {
        if (this.token) {
          try {
            this.account = await this.request('GET', '/api/account');
          } catch (err) {
            if (err.status !== 401) throw err;
            // o servidor não conhece mais este token (ex.: dados apagados numa reinicialização)
            this.token = ''; writeToken('');
            this.notice = 'A conta anterior não existe mais neste servidor. Uma nova conta foi criada.';
          }
        }
        if (!this.token) {
          const res = await this.request('POST', '/api/account', { name });
          this.token = res.token; writeToken(res.token);
          this.account = res.account;
        }
        this.status = 'ready';
      } catch (err) {
        this.status = 'offline';
        this.error = err.message;
      }
      this.emit();
      return this.account;
    })();
    return this.loading;
  }

  async refresh() {
    if (!this.token) return this.ensure();
    try { this.account = await this.request('GET', '/api/account'); this.status = 'ready'; } catch (err) {
      if (err.status === 401) { this.status = 'idle'; return this.ensure(); }
      this.status = 'offline';
    }
    this.emit();
    return this.account;
  }

  async loadShop() {
    this.shop = await this.request('GET', '/api/shop');
    this.emit();
    return this.shop;
  }

  /**
   * Abre uma caixa. O identificador do pedido é reaproveitado se a resposta se perder no caminho,
   * então tentar de novo nunca cobra duas vezes.
   */
  async openCase(caseId) {
    if (!this.pendingOpen || this.pendingOpen.caseId !== caseId) this.pendingOpen = { caseId, requestId: newRequestId() };
    const res = await this.request('POST', '/api/shop/open', this.pendingOpen);
    this.pendingOpen = null;
    this.account = res.account;
    this.emit();
    return res;
  }

  async equip(weapon, skin) {
    this.account = await this.request('POST', '/api/inventory/equip', { weapon, skin: skin || null });
    this.emit();
    return this.account;
  }

  /** Recompensa recebida no fim da partida: atualiza o saldo exibido com o valor do servidor. */
  applyReward(r) {
    if (this.account && Number.isFinite(r.balance)) { this.account.credits = r.balance; this.emit(); }
  }

  owns(weapon, skin) { return !!this.account && this.account.inventory.includes(`${weapon}.${skin}`); }
  equipped() { return (this.account && this.account.equipped) || {}; }
}
