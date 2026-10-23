// API HTTP da economia. Autenticação por token (Authorization: Bearer …) gerado pelo servidor.
// Todas as mudanças de saldo/inventário acontecem aqui ou na sala de partida — nunca no cliente.
import express from 'express';
import { getEconomy } from './index.js';
import { EconomyError } from './economy.js';
import { RateLimiter } from '../services/validation.js';
import { log } from '../services/logger.js';

const bearer = (req) => { const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || ''); return m ? m[1] : null; };

export function economyRoutes(app) {
  const json = express.json({ limit: '2kb' });
  const limiters = new Map();
  const limit = (req, res, next) => {
    const key = req.ip || 'unknown';
    let l = limiters.get(key);
    if (!l) { l = new RateLimiter(12); limiters.set(key, l); if (limiters.size > 5000) limiters.clear(); }
    if (!l.allow()) return res.status(429).json({ error: 'Muitas requisições. Aguarde um instante.' });
    return next();
  };
  const handle = (fn) => (req, res) => {
    try { res.setHeader('Cache-Control', 'no-store'); res.json(fn(req)); } catch (err) {
      if (err instanceof EconomyError) return res.status(err.status).json({ error: err.message });
      log.error('economy.api', { path: req.path, error: err.message });
      return res.status(500).json({ error: 'Falha interna. Nenhuma alteração foi feita.' });
    }
    return undefined;
  };
  const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

  app.post('/api/account', limit, json, handle((req) => getEconomy().createAccount({ name: body(req).name, ip: req.ip })));
  app.get('/api/account', limit, handle((req) => { const e = getEconomy(); return e.view(e.require(bearer(req))); }));
  app.get('/api/shop', handle(() => getEconomy().shopCatalog()));
  app.post('/api/shop/open', limit, json, handle((req) => {
    const e = getEconomy();
    const b = body(req);
    return e.openCase(e.require(bearer(req)), b.caseId, b.requestId);
  }));
  app.post('/api/inventory/equip', limit, json, handle((req) => {
    const e = getEconomy();
    const b = body(req);
    return e.equip(e.require(bearer(req)), b.weapon, b.skin ?? null);
  }));
}
