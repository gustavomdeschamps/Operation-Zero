// Instância única da economia do processo (criada sob demanda; os testes injetam uma em memória).
import { SERVER_CONFIG } from '../config.js';
import { Economy } from './economy.js';
import { EconomyStore } from './store.js';

let instance = null;

export function getEconomy() {
  if (!instance) instance = new Economy(new EconomyStore(SERVER_CONFIG.dataDir));
  return instance;
}

export function setEconomy(e) { instance = e; }

/** Grava pendências (encerramento do processo). */
export function flushEconomy() {
  try { if (instance) instance.store.flush(); } catch (err) { console.error('[economia] falha ao gravar no encerramento:', err.message); }
}
