// Biblioteca de personagens humanos: carrega os modelos GLB dos operadores e os clips de
// captura de movimento, processa os clips uma única vez (remove o deslocamento da raiz,
// normaliza a direção, separa trilhas inúteis), cria materiais por equipe e instâncias.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { OPERATORS, operatorById } from '../shared/catalog.js';
import { TEAM } from '../shared/protocol.js';

const ASSET_BASE = new URL('../assets/', import.meta.url).href;

/** Clips de movimento (Microsoft Rocketbox, MIT). Velocidade/passada são medidas do próprio clip. */
const CLIP_FILES = ['idle', 'idle_look', 'crouch', 'walk', 'walk_fast', 'run_slow', 'run', 'sprint'];
export const LOCOMOTION_CLIPS = ['walk', 'walk_fast', 'run_slow', 'run', 'sprint'];

/** Ossos do corpo animados pelos clips (rosto, dedos e pontas são descartados). */
const BODY_BONES = [
  'Pelvis', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'L_Clavicle', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_Clavicle', 'R_UpperArm', 'R_Forearm', 'R_Hand',
  'L_Thigh', 'L_Calf', 'L_Foot', 'L_Toe0', 'R_Thigh', 'R_Calf', 'R_Foot', 'R_Toe0',
].map((b) => `Bip01_${b}`);
const KEEP_TRACKS = new Set([...BODY_BONES.map((b) => `${b}.quaternion`), 'Bip01.position', 'Bip01.quaternion']);

/** Paletas de uniforme por equipe (substituem o camuflado original sem tocar na pele). */
export const TEAM_KITS = {
  [TEAM.ALFA]: { name: 'GRAFITE', dark: 0x1d2329, mid: 0x46525d, light: 0x8d9aa6, band: 0x3ef0ff },
  [TEAM.OMEGA]: { name: 'OLIVA', dark: 0x2a2b1c, mid: 0x5d5a38, light: 0xa39466, band: 0xff6a3d },
  [TEAM.NONE]: { name: 'NEUTRO', dark: 0x2c2f33, mid: 0x5b6067, light: 0x9aa0a6, band: 0xcfd6dc },
};

const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _yawQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function yawOf(q, restInv) {
  _q.copy(q).multiply(restInv);
  _v.set(0, 0, 1).applyQuaternion(_q);
  return Math.atan2(_v.x, _v.z);
}

/**
 * Prepara um clip para uso "no lugar": remove o deslocamento horizontal da raiz (o jogo move o
 * personagem), alinha a direção média com a pose de repouso e descarta trilhas desnecessárias.
 * Retorna metadados: velocidade natural (m/s) e comprimento da passada (m por ciclo).
 */
function processClip(clip, restRootQ) {
  clip.tracks = clip.tracks.filter((t) => KEEP_TRACKS.has(t.name));
  const restInv = restRootQ.clone().invert();
  const rootQ = clip.tracks.find((t) => t.name === 'Bip01.quaternion');
  const rootP = clip.tracks.find((t) => t.name === 'Bip01.position');
  let correction = 0;
  if (rootQ) {
    let sx = 0, cx = 0;
    const v = rootQ.values;
    for (let i = 0; i < v.length; i += 4) {
      const yaw = yawOf(_qi.fromArray(v, i), restInv);
      sx += Math.sin(yaw); cx += Math.cos(yaw);
    }
    correction = -Math.atan2(sx, cx);
    _yawQ.setFromAxisAngle(UP, correction);
    for (let i = 0; i < v.length; i += 4) { _qi.fromArray(v, i).premultiply(_yawQ).toArray(v, i); }
  }
  let speed = 0, stride = 0;
  if (rootP) {
    const v = rootP.values, times = rootP.times, n = times.length;
    const cs = Math.cos(correction), sn = Math.sin(correction);
    for (let i = 0; i < n; i++) {           // aplica a mesma correção de direção às posições
      const x = v[i * 3], z = v[i * 3 + 2];
      v[i * 3] = x * cs + z * sn; v[i * 3 + 2] = -x * sn + z * cs;
    }
    const x0 = v[0], z0 = v[2], xN = v[(n - 1) * 3], zN = v[(n - 1) * 3 + 2];
    const t0 = times[0], span = Math.max(1e-6, times[n - 1] - t0);
    stride = Math.hypot(xN - x0, zN - z0);
    speed = stride / clip.duration;
    for (let i = 0; i < n; i++) {
      const k = (times[i] - t0) / span;
      v[i * 3] -= x0 + (xN - x0) * k;
      v[i * 3 + 2] -= z0 + (zN - z0) * k;
    }
  }
  clip.userData = { speed, stride, phaseOffset: 0 };
  return clip;
}

/** Material com troca de paleta do uniforme por equipe (máscara de baixa saturação = tecido). */
function makeTeamMaterial(base, kit, strength) {
  const m = base.clone();
  const uniforms = {
    uTeamDark: { value: new THREE.Color(kit.dark) },
    uTeamMid: { value: new THREE.Color(kit.mid) },
    uTeamLight: { value: new THREE.Color(kit.light) },
    uTeamStrength: { value: strength },
  };
  m.userData.teamUniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTeamDark; uniform vec3 uTeamMid; uniform vec3 uTeamLight; uniform float uTeamStrength;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  {
    vec3 lin = diffuseColor.rgb;
    vec3 s = pow(max(lin, vec3(0.0)), vec3(0.4545));
    float mx = max(max(s.r, s.g), s.b);
    float mn = min(min(s.r, s.g), s.b);
    float sat = (mx - mn) / max(mx, 1e-4);
    float warm = smoothstep(0.02, 0.1, s.r - s.b);        // pele e couro (tons quentes) ficam intactos
    float lum = dot(s, vec3(0.299, 0.587, 0.114));
    float mask = (1.0 - smoothstep(0.16, 0.3, sat)) * (1.0 - warm * 0.85) * uTeamStrength;
    vec3 g = mix(uTeamDark, uTeamMid, smoothstep(0.1, 0.42, lum));
    g = mix(g, uTeamLight, smoothstep(0.42, 0.8, lum));
    diffuseColor.rgb = mix(lin, g, mask);
  }
#endif`);
  };
  m.customProgramCacheKey = () => `oz-team-${base.type}`;
  return m;
}

export class CharacterLibrary {
  constructor() {
    this.loader = new GLTFLoader();
    this.templates = new Map();        // id -> Promise<template>
    this.ready = new Map();            // id -> template (já carregado)
    this.materialCache = new Map();    // `${id}:${team}` -> Map(nomeOriginal -> material)
    this.clips = null;
    this.clipsPromise = null;
    this.failed = new Set();
    this.listeners = new Set();
    this.loaded = 0;
    this.total = 0;
  }

  onProgress(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _progress(label) { for (const fn of this.listeners) fn({ loaded: this.loaded, total: this.total, label }); }

  _load(url, label) {
    this.total++;
    this._progress(label);
    return new Promise((resolve, reject) => {
      this.loader.load(url, (g) => { this.loaded++; this._progress(label); resolve(g); }, undefined, (err) => {
        this.loaded++; this._progress(label);
        reject(new Error(`falha ao carregar ${url}: ${err?.message || err}`));
      });
    });
  }

  /** Carrega (uma vez) os clips de animação compartilhados por todos os operadores. */
  loadClips() {
    if (!this.clipsPromise) {
      this.clipsPromise = Promise.all(CLIP_FILES.map((name) => this._load(`${ASSET_BASE}animations/${name}.glb`, `animação ${name}`)
        .then((g) => { const c = g.animations[0]; c.name = name; return c; })))
        .then((clips) => {
          const rest = new THREE.Quaternion(0, -Math.SQRT1_2, 0, Math.SQRT1_2);
          const map = {};
          for (const c of clips) map[c.name] = processClip(c, rest);
          // agachamento como camada aditiva (relativa ao quadro 0 do idle): combina com andar/parado
          map.crouchAdd = THREE.AnimationUtils.makeClipAdditive(map.crouch.clone(), 0, map.idle, 30);
          map.crouchAdd.name = 'crouchAdd';
          this.clips = map;
          return map;
        });
    }
    return this.clipsPromise;
  }

  /** Carrega o modelo de um operador. */
  loadOperator(id) {
    const op = operatorById(id);
    if (!this.templates.has(op.id)) {
      const p = this._load(`${ASSET_BASE}characters/${op.model}`, `operador ${op.name}`).then((g) => {
        const scene = g.scene;
        const meshes = [];
        scene.traverse((o) => {
          if (o.isSkinnedMesh) {
            meshes.push(o);
            o.castShadow = true;
            o.receiveShadow = true;
            // esfera envolvente folgada (pose de repouso ×1,7): cobre agachar, mirar e cair, e permite
            // ao three.js descartar personagens fora da câmera e do volume de sombra
            if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
            o.boundingSphere = o.geometry.boundingSphere.clone();
            o.boundingSphere.radius *= 1.7;
            o.frustumCulled = true;
          }
        });
        if (!meshes.length) throw new Error(`modelo sem malha animável: ${op.model}`);
        // o GLTFLoader cria uma sub-malha por material; todas compartilham o mesmo esqueleto
        const template = { id: op.id, scene, meshes, materials: meshes.map((m) => m.material) };
        this.ready.set(op.id, template);
        return template;
      }).catch((err) => { this.failed.add(op.id); throw err; });
      this.templates.set(op.id, p);
    }
    return this.templates.get(op.id);
  }

  /** Carrega tudo o que é preciso para um conjunto de operadores (com progresso). */
  preload(ids = OPERATORS.map((o) => o.id)) {
    return Promise.all([this.loadClips(), ...ids.map((id) => this.loadOperator(id))]);
  }

  isReady(id) { return !!this.clips && this.ready.has(operatorById(id).id); }

  /** Materiais do operador com o uniforme da equipe (compartilhados entre instâncias iguais). */
  materialsFor(template, team) {
    const key = `${template.id}:${team}`;
    let set = this.materialCache.get(key);
    if (!set) {
      const kit = TEAM_KITS[team] || TEAM_KITS[TEAM.NONE];
      set = new Map();
      for (const m of template.materials) {
        const n = m.name.toLowerCase();
        const recolor = n.includes('body') || n.includes('equipment') || n.includes('helmet');
        const out = recolor ? makeTeamMaterial(m, kit, n.includes('helmet') ? 0.92 : 1) : m.clone();
        out.envMapIntensity = 0.55;
        set.set(m.name, out);
      }
      this.materialCache.set(key, set);
    }
    return set;
  }

  /** Cria uma cópia animável (esqueleto próprio, geometria e texturas compartilhadas). */
  instantiate(id, team) {
    const template = this.ready.get(operatorById(id).id);
    if (!template || !this.clips) return null;
    const scene = cloneSkinned(template.scene);
    const meshes = [];
    scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const instance = { scene, meshes, template };
    this.setTeamMaterials(instance, team);
    return instance;
  }

  setTeamMaterials(instance, team) {
    const set = this.materialsFor(instance.template, team);
    for (const mesh of instance.meshes) {
      const name = mesh.userData.baseMaterial || (mesh.userData.baseMaterial = mesh.material.name);
      mesh.material = set.get(name) || mesh.material;
    }
  }

  dispose() {
    for (const set of this.materialCache.values()) set.forEach((m) => m.dispose());
    this.materialCache.clear();
    for (const t of this.ready.values()) {
      t.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach((m) => {
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) m[k]?.dispose();
          m.dispose();
        });
      });
    }
    this.ready.clear();
    this.templates.clear();
  }
}

/** Instância única compartilhada pelo jogo (cache de modelos e clips). */
export const characterLibrary = new CharacterLibrary();
