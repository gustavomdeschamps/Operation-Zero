// Peças reutilizáveis dos layouts (usadas por todos os mapas).
// Ver o contrato do "builder" em ../arena-layout.js.

/** Escada maciça (cada degrau é sólido até o chão). axis 'x' ou 'z', dir +1/-1 = sentido de subida. */
export function stairs(b, { x0, x1, z0, z1, axis, dir, steps, rise, y0 = 0, mat = 'concreteDark' }) {
  const len = axis === 'x' ? x1 - x0 : z1 - z0;
  const depth = len / steps;
  for (let i = 0; i < steps; i++) {
    const top = y0 + rise * (i + 1);
    let a, c;
    if (dir > 0) { a = (axis === 'x' ? x0 : z0) + depth * i; c = a + depth; } else { c = (axis === 'x' ? x1 : z1) - depth * i; a = c - depth; }
    if (axis === 'x') b.box(a, c, y0, top, z0, z1, mat);
    else b.box(x0, x1, y0, top, a, c, mat);
    // borda de segurança no degrau
    if (axis === 'x') b.box(dir > 0 ? a : c - 0.06, dir > 0 ? a + 0.06 : c, top - 0.02, top + 0.005, z0, z1, 'hazard', { collide: false, castShadow: false });
    else b.box(x0, x1, top - 0.02, top + 0.005, dir > 0 ? a : c - 0.06, dir > 0 ? a + 0.06 : c, 'hazard', { collide: false, castShadow: false });
  }
}


/** Estação de munição: a caixa é sólida; ícone, faixa e anel são visuais. */
export function ammoStation(b, x, z, rotationY) {
  b.crate(x - 0.7, x + 0.7, 0, 0.9, z - 0.5, z + 0.5);
  b.box(x - 0.72, x + 0.72, 0.9, 0.96, z - 0.52, z + 0.52, 'metalTrim');
  b.ammoStationVisual(x, z, rotationY);
}


/** Barreira de concreto tipo "new jersey" com faixa de segurança. */
export function jersey(B, x0, x1, z0, z1) {
  B.box(x0, x1, 0, 0.95, z0, z1, 'concreteLight');
  if (x1 - x0 > z1 - z0) B.box(x0, x1, 0.18, 0.3, z0 - 0.01, z1 + 0.01, 'hazard', { collide: false });
  else B.box(x0 - 0.01, x1 + 0.01, 0.18, 0.3, z0, z1, 'hazard', { collide: false });
}

/** Contêiner de 2,6 m de altura com colunas de canto e friso superior (eixo longo em X ou Z). */
export function container(B, x0, x1, y0, z0, z1, mat) {
  B.box(x0, x1, y0, y0 + 2.6, z0, z1, mat);
  const c = 0.14, thin = { collide: false };
  for (const x of [x0 - 0.02, x1 - c + 0.02]) for (const z of [z0 - 0.02, z1 - c + 0.02]) B.box(x, x + c, y0, y0 + 2.6, z, z + c, 'metalTrim', thin);
  B.box(x0 - 0.02, x1 + 0.02, y0 + 2.52, y0 + 2.62, z0 - 0.02, z1 + 0.02, 'metalTrim', thin);
}
