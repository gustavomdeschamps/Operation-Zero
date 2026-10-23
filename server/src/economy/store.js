// Armazenamento da economia: um arquivo JSON (contas, inventários, conclusões já pagas) gravado de
// forma atômica (arquivo temporário + rename) e um registro de transações só de acréscimo (JSONL).
//
// Persistência: o diretório vem de DATA_DIR (padrão server/data/). Em hospedagens com disco efêmero
// (ex.: plano gratuito do Render) os dados se perdem a cada nova implantação ou reinício — para
// persistir de verdade, aponte DATA_DIR para um disco persistente. Ver ECONOMY.md.
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../services/logger.js';

const EMPTY = () => ({ version: 1, accounts: {}, tokens: {}, completions: {} });

export class EconomyStore {
  /** dir = null → somente memória (testes). */
  constructor(dir = null) {
    this.dir = dir;
    this.file = dir ? path.join(dir, 'economy.json') : null;
    this.ledgerFile = dir ? path.join(dir, 'transactions.jsonl') : null;
    this.ledger = [];               // cópia em memória (testes / diagnóstico)
    this.timer = null;
    this.data = this.load();
  }

  load() {
    if (!this.file) return EMPTY();
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (!fs.existsSync(this.file)) return EMPTY();
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!data || data.version !== 1 || typeof data.accounts !== 'object') throw new Error('formato desconhecido');
      data.tokens ||= {}; data.completions ||= {};
      return data;
    } catch (err) {
      // nunca sobrescreve um arquivo ilegível: guarda uma cópia e começa vazio
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try { fs.copyFileSync(this.file, backup); } catch { /* sem arquivo */ }
      log.error('economy.load_failed', { error: err.message, backup });
      return EMPTY();
    }
  }

  /** Agenda a gravação (agrupa mutações próximas). Falhas são registradas, nunca derrubam o processo. */
  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.flush(); } catch (err) { log.error('economy.save_failed', { error: err.message }); }
    }, 150);
    this.timer.unref?.();
  }

  /** Gravação atômica imediata. */
  flush() {
    if (!this.file) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  /** Registra uma transação (auditoria). Gravado de forma síncrona antes de responder ao cliente. */
  record(tx) {
    const entry = { at: new Date().toISOString(), ...tx };
    if (this.ledgerFile) fs.appendFileSync(this.ledgerFile, `${JSON.stringify(entry)}\n`);   // falha → exceção (operação desfeita)
    this.ledger.push(entry);
    if (this.ledger.length > 2000) this.ledger.splice(0, 1000);
    return entry;
  }
}
