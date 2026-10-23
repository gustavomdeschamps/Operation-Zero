// Catálogo compartilhado (cliente + servidor): operadores, armas primárias e mapas.
// O servidor valida qualquer identificador recebido contra estas listas — o cliente nunca
// consegue criar um operador, uma arma ou um mapa que não exista aqui.

/** Operadores humanos. `model` = arquivo em assets/characters/. Aparência apenas: sem vantagens. */
export const OPERATORS = [
  {
    id: 'gaviao', name: 'GAVIÃO', role: 'ASSALTO', model: 'gaviao.glb',
    tagline: 'Ponta de lança da equipe. Entra primeiro e abre espaço.',
    kit: ['Capacete balístico com óculos', 'Colete de placas leve', 'Luvas táticas', 'Faca de combate'],
    symbol: 'chevron',
  },
  {
    id: 'basalto', name: 'BASALTO', role: 'DEFESA', model: 'basalto.glb',
    tagline: 'Segura posições sob pressão. Colete reforçado e joelheiras.',
    kit: ['Capacete com cobertura', 'Colete reforçado com porta-carregadores', 'Joelheiras', 'Rádio de ombro'],
    symbol: 'shield',
  },
  {
    id: 'corvo', name: 'CORVO', role: 'RECONHECIMENTO', model: 'corvo.glb',
    tagline: 'Olhos da equipe. Leve, rápido e silencioso.',
    kit: ['Suporte de visão noturna', 'Mangas arregaçadas', 'Colete compacto', 'Joelheiras'],
    symbol: 'eye',
  },
  {
    id: 'lince', name: 'LINCE', role: 'ESPECIALISTA', model: 'lince.glb',
    tagline: 'Suporte tático: coordena a fumaça e cobre os flancos.',
    kit: ['Capacete com fone', 'Colete de suporte', 'Luvas táticas', 'Bolsas utilitárias'],
    symbol: 'diamond',
  },
];

export const DEFAULT_OPERATOR = 'gaviao';

/** Armas primárias selecionáveis (a pistola é sempre a secundária, slot 2). */
export const PRIMARY_WEAPONS = ['rifle', 'smg', 'sniper'];
export const SECONDARY_WEAPON = 'pistol';
export const DEFAULT_PRIMARY = 'rifle';

/** Mapas jogáveis. O layout (visual + colisão) de cada um fica em shared/maps/. */
export const MAPS = [
  {
    id: 'foundry7', name: 'FOUNDRY-7', subtitle: 'Instalação industrial abandonada',
    description: 'Corredor central, armazém e pátio. Combate próximo nas rotas laterais e duelos longos no corredor.',
    modes: ['training', 'tdm', 'tactical'],
  },
  {
    id: 'vesper', name: 'PORTO VESPER', subtitle: 'Complexo portuário costeiro',
    description: 'Contêineres empilhados, armazém de carga e cais aberto. Rotas cruzadas e linhas de visão longas no cais.',
    modes: ['tdm', 'tactical'],
  },
];

export const DEFAULT_MAP = 'foundry7';

export const isValidOperator = (id) => typeof id === 'string' && OPERATORS.some((o) => o.id === id);
export const isValidPrimary = (id) => typeof id === 'string' && PRIMARY_WEAPONS.includes(id);
export const isValidMap = (id) => typeof id === 'string' && MAPS.some((m) => m.id === id);
export const mapSupportsMode = (mapId, mode) => !!MAPS.find((m) => m.id === mapId)?.modes.includes(mode);
export const operatorById = (id) => OPERATORS.find((o) => o.id === id) || OPERATORS[0];
export const mapById = (id) => MAPS.find((m) => m.id === id) || MAPS[0];
