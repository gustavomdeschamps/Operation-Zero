// Estúdio 3D dos menus OPERADORES e ARSENAL: cena própria (iluminação de exposição, piso e fundo),
// câmera própria independente da câmera do jogo, giro por arrasto, zoom e inspeção.
// Os modelos exibidos são os MESMOS do jogo (characters/ e weapon-models.js).
import * as THREE from 'three';
import { HumanCharacter } from '../characters/human.js';
import { characterLibrary } from '../characters/library.js';
import { buildWeaponModel, createWeaponMaterials } from '../weapon-models.js';
import { getSkinMaterials } from '../skins-render.js';

const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));

export class Studio {
  /** surface: elemento que recebe o arraste/zoom (a tela do menu fica por cima do canvas). */
  constructor(renderer, environment, surface = renderer.domElement) {
    this.renderer = renderer;
    this.surface = surface;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1016);
    this.scene.fog = new THREE.Fog(0x0b1016, 7, 16);
    this.scene.environment = environment || null;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
    this.weaponMaterials = createWeaponMaterials();
    this.mode = 'operator';
    this.yaw = -0.2; this.yawTarget = -0.2;
    this.pitch = 0.08; this.pitchTarget = 0.08;
    this.zoom = 1; this.zoomTarget = 1;
    this.inspectT = -1;
    this.time = 0;
    this.character = null;
    this.characterKey = '';
    this.weapon = null;
    this.weaponId = '';
    this.buildSet();
    this.bindPointer();
  }

  buildSet() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xcfd9e6, 0x2a2622, 0.65));
    const key = new THREE.DirectionalLight(0xfff1df, 2.6);
    key.position.set(2.6, 4.2, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 3, bottom: -1, near: 1, far: 12 });
    key.shadow.bias = -0.0005;
    s.add(key);
    const rim = new THREE.DirectionalLight(0x9fdcff, 1.6);
    rim.position.set(-3, 2.6, -3.2);
    s.add(rim);
    const fill = new THREE.DirectionalLight(0xffc9a0, 0.5);
    fill.position.set(-3, 1, 2.5);
    s.add(fill);
    // piso: disco com anéis técnicos
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64), new THREE.MeshStandardMaterial({ color: 0x1b222b, roughness: 0.55, metalness: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x3a4856, transparent: true, opacity: 0.8 });
    for (const [r, w] of [[1.05, 0.012], [1.6, 0.008], [2.4, 0.006]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + w, 96), ringMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; s.add(ring);
    }
    // painéis de fundo (silhueta do hangar)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x131a22, roughness: 0.9, metalness: 0.2 });
    for (let i = -3; i <= 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5, 0.1), wallMat);
      const a = i * 0.32;
      p.position.set(Math.sin(a) * 5.5, 2.5, -Math.cos(a) * 5.5);
      p.rotation.y = -a;
      s.add(p);
    }
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x6fd8e2 });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(6, 0.02, 0.02), stripMat);
    strip.position.set(0, 3.2, -5.3);
    s.add(strip);
    this.turntable = new THREE.Group();
    s.add(this.turntable);
  }

  bindPointer() {
    const el = this.surface;
    let dragging = false, lx = 0, ly = 0;
    // só arrasta na área livre do visualizador (listas, painéis e botões continuam clicáveis)
    const blocked = (t) => t.closest && t.closest('button, input, select, a, .viewer-list, .viewer-detail, .topbar, .menu-footer');
    this._down = (e) => { if (!this.active || e.button !== 0 || blocked(e.target)) return; dragging = true; lx = e.clientX; ly = e.clientY; this.inspectT = -1; };
    this._move = (e) => {
      if (!dragging) return;
      this.yawTarget += (e.clientX - lx) * 0.008;
      this.pitchTarget = Math.max(-0.25, Math.min(0.55, this.pitchTarget + (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
    };
    this._up = () => { dragging = false; };
    this._wheel = (e) => { if (!this.active || blocked(e.target)) return; e.preventDefault(); this.zoomBy(e.deltaY > 0 ? 1.1 : 0.9); };
    el.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    el.addEventListener('wheel', this._wheel, { passive: false });
  }

  rotateBy(a) { this.yawTarget += a; this.inspectT = -1; }

  zoomBy(f) { this.zoomTarget = Math.max(0.45, Math.min(1.6, this.zoomTarget * f)); }

  /** Volta lentamente a arma por um roteiro de inspeção (interrompível pelo arrasto). */
  inspect() { this.inspectT = 0; this.inspectFrom = this.yawTarget; }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  /** Operador humano no pedestal. Retorna false se o modelo ainda não carregou. */
  showOperator(id, team) {
    this.mode = 'operator';
    if (this.weapon) this.weapon.root.visible = false;
    const key = `${id}:${team}`;
    if (this.characterKey === key && this.character) { this.character.setVisible(true); return true; }
    if (!characterLibrary.isReady(id)) return false;
    if (this.character && this.character.operator === id) {
      this.character.setTeam(team);
    } else {
      this.character?.dispose();
      this.character = new HumanCharacter({ operator: id, team, weaponMaterials: this.weaponMaterials, weapon: 'rifle' });
      this.turntable.add(this.character.root);
    }
    this.characterKey = key;
    this.character.setVisible(true);
    this.zoomTarget = 1;
    return true;
  }

  /** Arma no suporte giratório (mesmo modelo da partida), com o acabamento indicado. */
  showWeapon(id, skin = '') {
    this.mode = 'weapon';
    if (this.character) this.character.setVisible(false);
    const key = `${id}|${skin || ''}`;
    if (this.weaponId !== key) {
      if (this.weapon) { this.turntable.remove(this.weapon.root); }
      this.weapon = this._weaponCache?.get(key);
      if (!this.weapon) {
        this.weapon = buildWeaponModel(id, skin ? getSkinMaterials(skin) : this.weaponMaterials, { hands: false });
        this.weapon.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
        (this._weaponCache || (this._weaponCache = new Map())).set(key, this.weapon);
      }
      this.turntable.add(this.weapon.root);
      if (this.weaponId.split('|')[0] !== id) this.zoomTarget = 1;
      this.weaponId = key;
    }
    this.weapon.root.visible = true;
    return true;
  }

  /** Pedestal vazio (itens sem modelo 3D, como a granada de fumaça). */
  showNothing() {
    this.mode = 'none';
    if (this.character) this.character.setVisible(false);
    if (this.weapon) this.weapon.root.visible = false;
  }

  update(dt) {
    this.time += dt;
    if (this.inspectT >= 0) {
      this.inspectT += dt / 4.2;
      this.yawTarget = this.inspectFrom + Math.sin(this.inspectT * Math.PI) * 2.4;
      if (this.inspectT >= 1) this.inspectT = -1;
    } else if (this.mode === 'weapon') this.yawTarget += dt * 0.12;
    this.yaw = damp(this.yaw, this.yawTarget, 8, dt);
    this.pitch = damp(this.pitch, this.pitchTarget, 8, dt);
    this.zoom = damp(this.zoom, this.zoomTarget, 8, dt);
    if (this.mode === 'operator' && this.character) {
      const c = this.character;
      c.root.position.set(0, 0, 0);
      const facing = Math.PI + 0.5 + this.yaw - 0.3;    // três quartos para a câmera, girado pelo arrasto
      c.bodyYaw = facing;
      // apresentação: arma em prontidão baixa apontada para o lado (nunca para a câmera)
      c.update(dt, { vx: 0, vz: 0, aimYaw: facing - 0.25 + Math.sin(this.time * 0.4) * 0.08, aimPitch: -0.12 + Math.sin(this.time * 0.6) * 0.03, crouch: 0, lowReady: 0.85 + Math.sin(this.time * 0.35) * 0.12 });
      const d = 4.6 * this.zoom;
      const target = new THREE.Vector3(0, 1.05 + (1 - this.zoom) * 0.45, 0);
      this.camera.position.set(Math.sin(0.5) * d * Math.cos(this.pitch), target.y + Math.sin(this.pitch) * d, Math.cos(0.5) * d * Math.cos(this.pitch));
      this.camera.lookAt(target);
    } else if (this.mode === 'weapon' && this.weapon) {
      const w = this.weapon;
      w.root.position.set(0, 1.1 + Math.sin(this.time * 1.2) * 0.01, 0);
      w.root.rotation.set(0, this.yaw, 0);
      const d = (0.95 + (w.length || 0.8) * 1.15) * this.zoom;
      this.camera.position.set(Math.sin(0.25) * d, 1.2 + this.pitch * d, Math.cos(0.25) * d);
      this.camera.lookAt(0, 1.08, 0);
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    const el = this.surface;
    el.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    el.removeEventListener('wheel', this._wheel);
    this.character?.dispose();
    Object.values(this.weaponMaterials).forEach((m) => m.dispose());
  }
}
