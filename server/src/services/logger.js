// Logs estruturados em uma linha (fáceis de ler no terminal e de filtrar na hospedagem).
import { SERVER_CONFIG } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[SERVER_CONFIG.logLevel] ?? LEVELS.info;

function write(level, event, data) {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${event}${data ? ' ' + JSON.stringify(data) : ''}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const log = {
  debug: (e, d) => write('debug', e, d),
  info: (e, d) => write('info', e, d),
  warn: (e, d) => write('warn', e, d),
  error: (e, d) => write('error', e, d),
};
