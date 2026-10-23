// Configuração central da economia ZERO CREDITS (moeda virtual do jogo, sem valor monetário).
// Não há compra com dinheiro real, apostas, troca entre jogadores nem conversão em dinheiro.
// Todos os valores são calculados e aplicados no servidor.

export const ECONOMY = Object.freeze({
  currency: 'ZERO CREDITS',
  welcomeCredits: 300,              // bônus único de criação de conta (suficiente para uma caixa)

  rewards: Object.freeze({
    completion: 100,                // terminar a partida (presente no fim)
    win: 75,                        // bônus de vitória
    performance: Object.freeze({    // bônus de desempenho limitado
      perKill: 6, perBotKill: 3, perHeadshot: 2, perDeathPenalty: 0, max: 50,
    }),
    objective: Object.freeze({ plant: 20, defuse: 25, max: 50 }),
    // partidas muito curtas (abandono do adversário logo no início) rendem proporcionalmente menos
    fullValueAfterSeconds: 180,
    minActiveSeconds: 45,           // tempo mínimo jogando de fato (não ocioso) para receber algo
    minActiveFraction: 0.25,        // … ou 25% da duração, o que for menor
    dailyCap: 1500,                 // teto diário por conta (UTC)
  }),

  cases: Object.freeze([
    Object.freeze({
      id: 'campo', name: 'CAIXA DE CAMPO', currency: 'credits', price: 250,
      description: 'Qualquer acabamento em qualquer arma jogável.',
      odds: Object.freeze({ common: 0.6, rare: 0.28, epic: 0.095, legendary: 0.025 }),
      weapons: null,                // null = todas
    }),
    Object.freeze({
      id: 'precisao', name: 'CAIXA DE PRECISÃO', currency: 'credits', price: 350,
      description: 'Acabamentos para o fuzil de precisão e a pistola, com chance maior de raros.',
      odds: Object.freeze({ common: 0.45, rare: 0.38, epic: 0.13, legendary: 0.04 }),
      weapons: Object.freeze(['sniper', 'pistol']),
    }),
    Object.freeze({
      id: 'oficina', name: 'CAIXA DE OFICINA', currency: 'fragments', price: 120,
      description: 'Comprada com fragmentos obtidos de itens repetidos.',
      odds: Object.freeze({ common: 0.5, rare: 0.32, epic: 0.14, legendary: 0.04 }),
      weapons: null,
    }),
  ]),

  // repetidos viram fragmentos (valor por raridade em shared/skins.js — RARITIES.*.fragments)
  historyPerAccount: 40,
  requestsRemembered: 64,           // pedidos idempotentes lembrados por conta
  accountsPerIpPerHour: 6,
});

export const caseById = (id) => ECONOMY.cases.find((c) => c.id === id) || null;
