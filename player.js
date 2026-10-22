// Entrada (teclado/mouse/Pointer Lock) e jogador em primeira pessoa: câmera, efeitos de câmera,
// vida e eventos. A física do movimento (aceleração, pulo, gravidade, agachamento, colisão) é a
// função compartilhada stepMovement (shared/movement.js), também executada pelo servidor online.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp, invLerp } from './utils.js';
import { createMoveState, createCommand, stepMovement, movementState } from './shared/movement.js';
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'KeyC', 'KeyR', 'KeyE', 'Digit1', 'Digit2', 'Tab',
]);

export class InputManager {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressed = new Set();
    this.buttons = new Set();
    this.buttonsPressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.enabled = false;           // só aceita entrada de jogo quando a partida está ativa
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => { this.keys.delete(e.code); };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
    };
    this._onMouseUp = (e) => { this.buttons.delete(e.button); };
    this._onMouseMove = (e) => {
      if (!this.enabled || document.pointerLockElement !== this.element) return;
      // descarta picos espúrios conhecidos de alguns navegadores
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    };
    this._onContext = (e) => e.preventDefault();
    this._onBlur = () => this.reset();
  }

  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('blur', this._onBlur);
    this.element.addEventListener('contextmenu', this._onContext);
  }

  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('blur', this._onBlur);
    this.element.removeEventListener('contextmenu', this._onContext);
  }

  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  isButtonDown(b) { return this.buttons.has(b); }
  wasButtonPressed(b) { return this.buttonsPressed.has(b); }

  consumeMouse(out) {
    out.dx = this.mouseDX; out.dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return out;
  }

  endFrame() { this.pressed.clear(); this.buttonsPressed.clear(); }

  /** Solta todas as teclas (pausa, perda de foco) — evita teclas "presas". */
  reset() {
    this.keys.clear(); this.pressed.clear(); this.buttons.clear(); this.buttonsPressed.clear();
    this.mouseDX = 0; this.mouseDY = 0;
  }
}

export class Player {
  constructor(camera, map, events) {
    this.camera = camera;
    this.map = map;
    this.events = events;
    this.cfg = CONFIG.player;
    // estado físico compartilhado com a simulação (pos/vel como THREE.Vector3 para o restante do cliente)
    this.move = createMoveState();
    this.move.pos = new THREE.Vector3();
    this.move.vel = new THREE.Vector3();
    this.position = this.move.pos;
    this.velocity = this.move.vel;
    this.cmd = createCommand();
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.punchRoll = 0;
    this.sensitivity = CONFIG.input.baseSensitivity * CONFIG.input.sensitivity;
    this.health = this.cfg.maxHealth;
    this.alive = true;
    this.spawnPoint = { x: this.cfg.spawn.x, z: this.cfg.spawn.z, yaw: this.cfg.spawn.yaw };
    this._mouse = { dx: 0, dy: 0 };
    this._eye = new THREE.Vector3();
    this.reset();
  }

  // atalhos para o estado físico
  get height() { return this.move.height; }
  set height(v) { this.move.height = v; }
  get crouching() { return this.move.crouching; }
  set crouching(v) { this.move.crouching = v; }
  get onGround() { return this.move.onGround; }
  set onGround(v) { this.move.onGround = v; }

  reset(spawn = this.spawnPoint) {
    const m = this.move;
    m.pos.set(spawn.x, this.map.groundHeight(spawn.x, spawn.z, 3, this.cfg.radius), spawn.z);
    m.vel.set(0, 0, 0);
    m.height = this.cfg.height;
    m.crouching = false;
    m.onGround = true;
    m.coyoteT = 0;
    m.jumpBufferT = 0;
    this.yaw = spawn.yaw ?? 0; this.pitch = 0;
    this.recoilPitch = 0; this.recoilYaw = 0; this.punchRoll = 0;
    this.health = this.cfg.maxHealth;
    this.alive = true;
    this.time = 0;
    this.lastDamageTime = -999;
    this.stepSmooth = 0;
    this.landDip = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.stepDistance = 0;
    this.horizontalSpeed = 0;
    this.walking = false;
    this.applyCamera();
  }

  setSensitivity(multiplier) { this.sensitivity = CONFIG.input.baseSensitivity * multiplier; }

  get eyeHeight() { return this.height - this.cfg.eyeFromTop; }

  getEyePosition(out = this._eye) { return out.set(this.position.x, this.position.y + this.eyeHeight, this.position.z); }

  /** Estado de movimento usado pela precisão da arma e pela HUD. */
  getMovementState() { return movementState(this.move, this.cfg); }

  addRecoil(pitch, yaw, maxPitch) {
    this.recoilPitch = Math.min(this.recoilPitch + pitch, maxPitch);
    this.recoilYaw += yaw;
  }

  addPunch(roll) { this.punchRoll += roll; }

  /** Recuperação do recuo — exponencial e independente da taxa de quadros. */
  updateRecoil(dt, rate, recovering) {
    if (recovering) {
      this.recoilPitch = damp(this.recoilPitch, 0, rate, dt);
      this.recoilYaw = damp(this.recoilYaw, 0, rate, dt);
    }
    this.punchRoll = damp(this.punchRoll, 0, 16, dt);
  }

  /** Dano local (treino offline). Online, a vida vem do servidor via setNetHealth. */
  takeDamage(amount, sourcePosition) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this.lastDamageTime = this.time;
    this.events.emit('playerDamaged', { amount, health: this.health, source: sourcePosition });
    if (this.health <= 0) {
      this.alive = false;
      this.events.emit('playerDied', {});
    }
  }

  /** Atualização completa do modo offline (passo variável). */
  update(dt, input, { lookEnabled = true, adsFactor = 0 } = {}) {
    if (lookEnabled) this.look(input, adsFactor);
    this.sampleCommand(input, adsFactor, input.wasPressed('Space'));
    const res = this.simulate(this.cmd, dt);
    if (res.fellOut) this.reset();
    this.updateRegen(dt);
    this.updateCamera(dt);
  }

  /** Aplica o movimento do mouse à visão (a cada quadro, para resposta imediata). */
  look(input, adsFactor = 0) {
    input.consumeMouse(this._mouse);
    const sens = this.sensitivity * (1 - adsFactor * 0.18);
    this.yaw -= this._mouse.dx * sens;
    let dp = -this._mouse.dy * sens;
    // puxar o mouse para baixo durante o recuo "absorve" o recuo antes de mover a visão base
    if (dp < 0 && this.recoilPitch > 0) {
      const absorb = Math.min(-dp, this.recoilPitch);
      this.recoilPitch -= absorb;
      dp += absorb;
    }
    this.pitch = clamp(this.pitch + dp, -CONFIG.input.pitchLimit, CONFIG.input.pitchLimit - this.recoilPitch);
  }

  /** Lê o teclado e preenche o comando de movimento do passo. */
  sampleCommand(input, adsFactor, jumpEdge) {
    const c = this.cmd;
    c.f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    c.r = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    c.jump = !!jumpEdge;
    c.crouch = input.isDown('ControlLeft') || input.isDown('ControlRight') || input.isDown('KeyC');
    c.walk = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    c.ads = adsFactor;
    c.yaw = this.yaw;
    return c;
  }

  /** Um passo de física com o comando informado + eventos de jogo (pulo, pouso, passos). */
  simulate(cmd, dt) {
    const cfg = this.cfg;
    this.time += dt;
    const res = stepMovement(this.move, cmd, dt, this.map.collision, cfg);
    this.stepSmooth += res.stepDown - res.stepUp;
    if (res.jumped) this.events.emit('jump', {});
    if (res.landed && res.fallSpeed < -4.5) {
      this.landDip = Math.min(0.14, -res.fallSpeed * 0.012);
      this.events.emit('land', { speed: -res.fallSpeed });
    }
    this.horizontalSpeed = res.horizontalSpeed;
    this.walking = cmd.walk;
    // passos (silencioso caminhando com Shift ou agachado)
    if (this.onGround && !this.crouching && !cmd.walk && this.horizontalSpeed > cfg.walkSpeed + 0.4) {
      this.stepDistance += this.horizontalSpeed * dt;
      if (this.stepDistance >= cfg.footstepDistance) { this.stepDistance = 0; this.events.emit('footstep', {}); }
    } else if (this.horizontalSpeed < 0.5) this.stepDistance = cfg.footstepDistance * 0.6;
    return res;
  }

  updateRegen(dt) {
    const cfg = this.cfg;
    if (this.alive && this.health < cfg.maxHealth && this.time - this.lastDamageTime > cfg.regenDelay) {
      this.health = Math.min(cfg.maxHealth, this.health + cfg.regenRate * dt);
    }
  }

  /** Efeitos de câmera (balanço, degraus, pouso) — por quadro de renderização. */
  updateCamera(dt, offsetX = 0, offsetY = 0, offsetZ = 0) {
    const speed01 = this.onGround ? invLerp(0.5, this.cfg.runSpeed, this.horizontalSpeed) : 0;
    this.bobPhase += dt * (4 + this.horizontalSpeed * 1.6) * (speed01 > 0 ? 1 : 0);
    this.bobAmount = damp(this.bobAmount, speed01, 10, dt);
    this.stepSmooth = damp(this.stepSmooth, 0, 16, dt);
    this.landDip = damp(this.landDip, 0, 9, dt);
    this.applyCamera(offsetX, offsetY, offsetZ);
  }

  applyCamera(offsetX = 0, offsetY = 0, offsetZ = 0) {
    const bob = Math.sin(this.bobPhase * 2) * 0.022 * this.bobAmount;
    this.camera.position.set(
      this.position.x + offsetX,
      this.position.y + offsetY + this.eyeHeight + bob + this.stepSmooth - this.landDip,
      this.position.z + offsetZ,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw + this.recoilYaw, this.punchRoll);
  }
}
