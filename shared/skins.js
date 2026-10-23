// Acabamentos (skins) de armas — catálogo compartilhado entre cliente e servidor.
//
// Skins são SOMENTE visuais: não alteram dano, cadência, precisão, recuo, munição nem hitboxes.
// Cada acabamento é original (padrões procedurais definidos aqui, sem texturas de terceiros) e
// pode ser aplicado às armas jogáveis. O item de inventário é o par arma + acabamento.

export const RARITIES = {
  common: { id: 'common', label: 'COMUM', color: '#9aa7b4', fragments: 15 },
  rare: { id: 'rare', label: 'RARO', color: '#4ea8ff', fragments: 35 },
  epic: { id: 'epic', label: 'ÉPICO', color: '#b673ff', fragments: 80 },
  legendary: { id: 'legendary', label: 'LENDÁRIO', color: '#ffb547', fragments: 200 },
};
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

/**
 * Padrão procedural de cada acabamento (interpretado por skins-render.js no cliente):
 *  base/alt/accent — cores; pattern — tipo de desenho; scale — tamanho do padrão (m);
 *  rough/metal — parâmetros PBR do material resultante.
 */
export const SKINS = [
  {
    id: 'grafite', name: 'GRAFITE TÁTICO', rarity: 'common',
    description: 'Cinza grafite fosco com micro-textura de jateamento. Discreto em qualquer ambiente.',
    look: { pattern: 'speckle', base: '#3a3e43', alt: '#2c3034', accent: '#5a6168', scale: 0.04, rough: 0.78, metal: 0.25 },
  },
  {
    id: 'carbono', name: 'CARBONO INDUSTRIAL', rarity: 'common',
    description: 'Trama de fibra de carbono com verniz acetinado e bordas usinadas.',
    look: { pattern: 'weave', base: '#14171a', alt: '#4c545c', accent: '#8b949c', scale: 0.05, rough: 0.42, metal: 0.35 },
  },
  {
    id: 'recon', name: 'CAMUFLAGEM DE RECONHECIMENTO', rarity: 'rare',
    description: 'Manchas angulares em três tons de oliva e areia, pintadas à mão sobre polímero.',
    look: { pattern: 'camo', base: '#5d6447', alt: '#3f4632', accent: '#a39a72', scale: 0.11, rough: 0.82, metal: 0.05 },
  },
  {
    id: 'artica', name: 'CERÂMICA ÁRTICA', rarity: 'rare',
    description: 'Revestimento cerâmico branco-gelo com faixas de nível em azul glaciar.',
    look: { pattern: 'stripes', base: '#dfe5ea', alt: '#c3ccd4', accent: '#3f8fd2', scale: 0.09, rough: 0.35, metal: 0.05 },
  },
  {
    id: 'cobre', name: 'LIGA DE COBRE', rarity: 'epic',
    description: 'Cobre escovado com oxidação controlada nas reentrâncias e gravação geométrica.',
    look: { pattern: 'brushed', base: '#b46a3e', alt: '#7a4428', accent: '#3fae94', scale: 0.16, rough: 0.32, metal: 0.92 },
  },
  {
    id: 'circuito', name: 'CIRCUITO EXPERIMENTAL', rarity: 'legendary',
    description: 'Trilhas de circuito gravadas em grafite com pulsos de luz ciano emissivos.',
    look: { pattern: 'circuit', base: '#15191d', alt: '#262e35', accent: '#3ef0ff', scale: 0.1, rough: 0.5, metal: 0.6, emissive: true },
  },
];

/** Armas que aceitam acabamentos (as jogáveis). */
export const SKINNABLE_WEAPONS = ['rifle', 'smg', 'pistol', 'sniper'];

export const skinById = (id) => SKINS.find((s) => s.id === id) || null;
export const isValidSkin = (id) => typeof id === 'string' && SKINS.some((s) => s.id === id);
export const isSkinnableWeapon = (id) => typeof id === 'string' && SKINNABLE_WEAPONS.includes(id);
export const itemId = (weapon, skin) => `${weapon}.${skin}`;
export function parseItemId(id) {
  if (typeof id !== 'string') return null;
  const [weapon, skin, extra] = id.split('.');
  if (extra !== undefined || !isSkinnableWeapon(weapon) || !isValidSkin(skin)) return null;
  return { weapon, skin };
}
/** Todos os itens existentes (arma × acabamento). */
export const ALL_ITEMS = SKINNABLE_WEAPONS.flatMap((w) => SKINS.map((s) => ({ id: itemId(w, s.id), weapon: w, skin: s.id, rarity: s.rarity })));

/**
 * Acabamentos equipados, como replicados no estado da partida: "rifle=carbono;pistol=cobre".
 * O servidor monta a string a partir da conta (nunca do cliente).
 */
export function encodeEquipped(map) {
  return Object.entries(map || {}).filter(([w, s]) => isSkinnableWeapon(w) && isValidSkin(s)).map(([w, s]) => `${w}=${s}`).join(';');
}
export function decodeEquipped(str) {
  const out = {};
  if (typeof str !== 'string' || !str) return out;
  for (const part of str.split(';')) {
    const [w, s] = part.split('=');
    if (isSkinnableWeapon(w) && isValidSkin(s)) out[w] = s;
  }
  return out;
}
