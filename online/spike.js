// Dispositivo do modo tático no mundo: aparece na posição oficial (estado do servidor) enquanto
// está instalado, com farol pulsante e bipe que aceleram conforme a detonação se aproxima.
import * as THREE from 'three';
import { SPIKE } from '../shared/protocol.js';

const ARMED = new Set([SPIKE.PLANTED, SPIKE.DEFUSING]);

export class SpikeVisual {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.visible = false;
    const body = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.55, metalness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.5, metalness: 0.3 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x400808, emissive: 0xff2a2a, emissiveIntensity: 0.4 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.12, 16), body);
    base.position.y = 0.06;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.34, 12), body);
    core.position.y = 0.29;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.05, 12), trim);
    band.position.y = 0.2;
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), this.lampMat);
    this.lamp.position.y = 0.5;
    for (const m of [base, core, band]) { m.castShadow = true; m.receiveShadow = true; }
    this.root.add(base, core, band, this.lamp);
    this.light = new THREE.PointLight(0xff3030, 0, 5, 2);
    this.light.position.y = 0.55;
    this.root.add(this.light);
    scene.add(this.root);
    this.phase = 0;
    this.lastBeep = 0;
  }

  /** @param spike SpikeState sincronizado; @param timer segundos até detonar (já descontado o tempo desde o patch). */
  update(dt, spike, timer, audio) {
    const armed = ARMED.has(spike.state);
    this.root.visible = armed;
    if (!armed) { this.light.intensity = 0; return; }
    this.root.position.set(spike.x, spike.y, spike.z);
    // período do bipe: 1 s no início, até 0,15 s nos segundos finais
    const period = Math.max(0.15, Math.min(1, timer / 30));
    this.phase += dt / period;
    const pulse = Math.max(0, 1 - (this.phase % 1) * 4);
    this.lampMat.emissiveIntensity = 0.4 + pulse * 3;
    this.light.intensity = pulse * 2.2;
    if (Math.floor(this.phase) !== this.lastBeep) {
      this.lastBeep = Math.floor(this.phase);
      if (audio) audio.play('spikeBeep', { at: this.root.position });
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}
