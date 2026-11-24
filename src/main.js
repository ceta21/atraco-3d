// Bucle principal y reglas del juego.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CFG, UPGRADES, AMMO_PACK } from './config.js';
import { clamp, lerp, lerpAngle, rand, rayCylinder } from './util.js';
import { World } from './world.js';
import { makePlayerModel, animateHumanoid, Cop } from './actors.js';
import { Sfx } from './audio.js';
import { UI } from './ui.js';

const SAVE_KEY = 'atraco3d_v1';
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

class Game {
  constructor() {
    this.canvas = document.getElementById('c');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c1a);
    this.scene.fog = new THREE.FogExp2(0x0c0f1f, 0.0105);
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 700);

    this.scene.add(new THREE.HemisphereLight(0x6f7fc0, 0x221e28, 1.5));
    this.moon = new THREE.DirectionalLight(0x9aa8ff, 1.1);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 1;
    sc.far = 200;
    this.moon.shadow.bias = -0.0008;
    this.scene.add(this.moon, this.moon.target);

    this.world = new World(this.scene);
    this.lampLights = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffb366, 60, 26, 2);
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this.lampT = 0;

    this.sfx = new Sfx();
    this.ui = new UI(this);

    // estado persistente
    this.bank = 0;
    this.up = { bag: 0, shoes: 0, vest: 0, aim: 0 };
    this.stats = { robs: 0, extracts: 0, best: 0, kills: 0 };
    this.wonShown = false;
    const save = this.load();

    // jugador
    const h = makePlayerModel();
    this.scene.add(h.group);
    this.player = {
      h,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: Math.PI,
      hp: 100,
      stamina: 100,
      exhausted: false,
      staminaWait: 0,
      mag: CFG.MAG,
      reserve: save?.reserve ?? CFG.START_RESERVE,
      reloadT: 0,
      fireT: 0,
      poseT: 0,
      aiming: false,
      weight: 0,
      value: 0,
      bag: [],
      phase: 0,
      alive: true,
    };
    this.camYaw = Math.PI;
    this.camPitch = 0.28;
    this.camDist = CFG.CAM_DIST;

    this.cops = [];
    this.heat = 0;
    this.unseenT = 99;
    this.bust = 0;
    this.pressed = false;
    this.time = 0;
    this.copT = 0;
    this.chaseField = null;
    this.lastKnown = new THREE.Vector3();
    this.lastFieldT = -1;
    this.lastFieldCell = -1;
    this.robTarget = null;
    this.robT = 0;
    this.nearLoot = null;
    this.extractT = 0;
    this.inSafe = false;
    this.hq = true;

    this.buildEffects();
    this.buildComposer();
    this.bindInput();
    this.resetPlayer();
    this.world.moveExtraction(this.player.pos.x, this.player.pos.z);
    for (let i = 0; i < CFG.COPS_BASE; i++) this.spawnCop(45);

    this.state = 'menu';
    this.last = performance.now();
    window.addEventListener('resize', () => this.onResize());
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------- Estadísticas derivadas de mejoras ----------
  get cap() { return CFG.BASE_CAP + 2 * this.up.bag; }
  get maxHp() { return CFG.BASE_HP + 25 * this.up.vest; }
  get maxStamina() { return CFG.BASE_STAMINA + 15 * this.up.shoes; }
  get speedMul() { return 1 + 0.06 * this.up.shoes; }
  get dmg() { return CFG.BASE_DMG + 5 * this.up.aim; }
  get stars() { return this.heat <= 0 ? 0 : Math.min(4, Math.ceil(this.heat / 25)); }

  upgradeCost(u) {
    return Math.round(u.base * (1 + this.up[u.id] * 0.9));
  }

  // ---------- Guardado ----------
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s) return null;
      this.bank = s.bank || 0;
      this.up = { ...this.up, ...(s.up || {}) };
      this.stats = { ...this.stats, ...(s.stats || {}) };
      this.wonShown = !!s.won;
      return s;
    } catch (e) {
      return null;
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ bank: this.bank, up: this.up, stats: this.stats, won: this.wonShown, reserve: this.player.reserve }));
    } catch (e) {
      /* sin almacenamiento: el progreso dura solo esta sesión */
    }
  }

  resetProgress() {
    this.bank = 0;
    this.up = { bag: 0, shoes: 0, vest: 0, aim: 0 };
    this.stats = { robs: 0, extracts: 0, best: 0, kills: 0 };
    this.wonShown = false;
    this.player.reserve = CFG.START_RESERVE;
    this.player.mag = CFG.MAG;
    this.resetPlayer();
    this.save();
    this.ui.showPause(true);
    this.ui.toast('Progreso borrado', 'info');
  }

  // ---------- Entrada ----------
  bindInput() {
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.locked = false;
    this.noLock = false;

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.state === 'play') {
        if (e.code === 'KeyR') this.startReload();
        if (e.code === 'KeyE' && this.inSafe && !this.nearLoot) this.openShop();
        if (e.code === 'KeyG') this.toggleQuality();
        if (e.code === 'KeyM') this.ui.toast(this.sfx.toggleMute() ? 'Sonido desactivado' : 'Sonido activado', 'info');
        if (e.code === 'KeyP' || (e.code === 'Escape' && this.noLock)) this.pause();
      } else if (this.state === 'paused' && e.code === 'KeyP') this.resume();
      else if (this.state === 'shop' && (e.code === 'KeyE' || e.code === 'Escape')) this.closeShop();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'play') return;
      if (!this.locked && !this.noLock) this.requestLock();
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.state !== 'play') return;
      if (!this.locked && !this.noLock) return;
      const s = CFG.SENS * (this.player.aiming ? 0.6 : 1);
      this.camYaw -= e.movementX * s;
      this.camPitch = clamp(this.camPitch + e.movementY * s, -0.55, 1.1);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.state === 'play' && !this.noLock) this.pause();
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed());
  }

  requestLock() {
    try {
      const r = this.canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => this.lockFailed());
    } catch (e) {
      this.lockFailed();
    }
  }

  lockFailed() {
    if (this.noLock) return;
    this.noLock = true;
    this.ui.toast('Sin bloqueo de ratón: mira con el ratón o las flechas. Pausa con P.', 'info');
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------- Estados ----------
  start() {
    this.sfx.init();
    this.ui.show('menu', false);
    this.ui.show('hud', true);
    this.state = 'play';
    this.requestLock();
    this.ui.toast('Roba objetivos marcados y llévalos a la extracción', 'info');
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.releaseLock();
    this.ui.showPause(true);
  }

  resume() {
    this.ui.showPause(false);
    this.state = 'play';
    this.last = performance.now();
    this.requestLock();
  }

  openShop() {
    if (this.state !== 'play') return;
    this.state = 'shop';
    this.releaseLock();
    this.ui.renderShop();
    this.ui.show('shop', true);
  }

  closeShop() {
    this.ui.show('shop', false);
    this.state = 'play';
    this.last = performance.now();
    this.requestLock();
  }

  closeWin() {
    this.ui.show('win', false);
    this.state = 'play';
    this.requestLock();
  }

  buy(id) {
    if (id === 'ammo') {
      if (this.bank < AMMO_PACK.cost || this.player.reserve >= CFG.MAX_RESERVE) return;
      this.bank -= AMMO_PACK.cost;
      this.player.reserve = Math.min(CFG.MAX_RESERVE, this.player.reserve + AMMO_PACK.amount);
    } else {
      const u = UPGRADES.find((x) => x.id === id);
      const cost = this.upgradeCost(u);
      if (!u || this.up[id] >= u.max || this.bank < cost) return;
      this.bank -= cost;
      this.up[id]++;
      if (id === 'vest') this.player.hp = this.maxHp;
      if (id === 'shoes') this.player.stamina = this.maxStamina;
    }
    this.sfx.buy();
    this.save();
    this.ui.renderShop();
  }

  toggleQuality() {
    this.hq = !this.hq;
    this.moon.castShadow = this.hq;
    this.bloom.enabled = this.hq;
    this.renderer.setPixelRatio(this.hq ? Math.min(window.devicePixelRatio || 1, 1.5) : 0.85);
    this.onResize();
    this.ui.toast(this.hq ? 'Calidad alta' : 'Calidad rendimiento', 'info');
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  resetPlayer() {
    const p = this.player;
    const s = this.world.spawn;
    p.pos.set(s.x, this.world.groundY(s.x, s.z), s.z);
    p.vel.set(0, 0, 0);
    p.hp = this.maxHp;
    p.stamina = this.maxStamina;
    p.exhausted = false;
    p.alive = true;
    p.bag = [];
    p.weight = 0;
    p.value = 0;
    p.reloadT = 0;
    p.yaw = 0;
    this.camYaw = 0;
    this.camPitch = 0.28;
    this.heat = 0;
    this.bust = 0;
    this.unseenT = 99;
    this.extractT = 0;
    this.robTarget = null;
    this.robT = 0;
  }

  die(kind) {
    if (this.state !== 'play') return;
    const p = this.player;
    p.alive = false;
    this.state = 'dead';
    this.releaseLock();
    this.ui.showDead(kind, p.value);
    this.sfx.setSiren(0);
    this.sfx.hurt();
  }

  respawn() {
    this.ui.show('dead', false);
    for (const c of this.cops) c.dispose();
    this.cops = [];
    this.resetPlayer();
    for (let i = 0; i < CFG.COPS_BASE; i++) this.spawnCop(45);
    this.state = 'play';
    this.last = performance.now();
    this.requestLock();
  }

  // ---------- Policía ----------
  spawnCop(minDist = 55, state = 'patrol') {
    const p = this.player.pos;
    const list = this.world.intersections.filter((q) => {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      return d > minDist && d < 170 && Math.hypot(q.x - this.world.safe.x, q.z - this.world.safe.z) > 25;
    });
    if (!list.length) return;
    const q = list[Math.floor(Math.random() * list.length)];
    const c = new Cop(this, q.x + rand(-2, 2), q.z + rand(-2, 2), state);
    this.cops.push(c);
  }

  manageCops() {
    this.cops = this.cops.filter((c) => {
      if (c.dead && c.deadT > 12) {
        c.dispose();
        return false;
      }
      return true;
    });
    const alive = this.cops.filter((c) => !c.dead);
    const want = Math.min(24, this.heat > 0 ? CFG.COPS_BASE + this.stars * CFG.COPS_PER_STAR : CFG.COPS_BASE);
    if (alive.length < want) {
      const n = this.heat > 0 ? Math.min(2, want - alive.length) : 1;
      for (let i = 0; i < n; i++) this.spawnCop(this.heat > 0 ? 50 : 60, this.heat > 0 ? 'respond' : 'patrol');
    } else if (alive.length > want && this.heat <= 0) {
      const p = this.player.pos;
      const c = alive.find((c) => !c.canSee && Math.hypot(c.pos.x - p.x, c.pos.z - p.z) > 60);
      if (c) {
        c.dispose();
        this.cops.splice(this.cops.indexOf(c), 1);
      }
    }
  }

  copSees(cop, dist) {
    const P = this.player.pos;
    if (!this.player.alive || dist > 46) return false;
    if (dist > 8) {
      const fx = -Math.sin(cop.yaw);
      const fz = -Math.cos(cop.yaw);
      const dot = (fx * (P.x - cop.pos.x) + fz * (P.z - cop.pos.z)) / dist;
      if (dot < 0.3 && cop.state === 'patrol') return false;
    }
    return this.world.hasLOS(cop.pos.x, cop.pos.y + 1.6, cop.pos.z, P.x, P.y + 1.3, P.z);
  }

  spotted() {
    this.unseenT = 0;
    this.reportPos(this.player.pos);
  }

  reportPos(pos, force = false) {
    this.lastKnown.copy(pos);
    const cell = this.world.cellIdx(pos.x, pos.z);
    if (!force && cell === this.lastFieldCell) return;
    if (!force && this.chaseField && this.time - this.lastFieldT < 0.35) return;
    this.lastFieldCell = cell;
    this.lastFieldT = this.time;
    this.chaseField = this.world.bfs(cell);
  }

  alertAll() {
    for (const c of this.cops) if (!c.dead && c.state !== 'chase') c.state = 'respond';
  }

  addHeat(v, reveal = true) {
    const before = this.stars;
    this.heat = Math.min(100, this.heat + v);
    this.unseenT = 0;
    if (reveal) {
      this.reportPos(this.player.pos, true);
      this.alertAll();
    }
    const s = this.stars;
    if (s > before) this.ui.toast(`Nivel de búsqueda ${'★'.repeat(s)}${s >= 2 ? ' · ¡disparan a matar!' : ''}`, 'bad');
  }

  arrestPressure() {
    this.pressed = true;
  }

  copShoot(cop, dist) {
    const p = this.player;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const chance = clamp(0.62 - dist * 0.011 - sp * 0.035 + this.stars * 0.04, 0.08, 0.75);
    const from = cop.muzzle(tmpV);
    const hit = Math.random() < chance;
    const to = tmpV2.set(p.pos.x, p.pos.y + 1.2, p.pos.z);
    if (!hit) {
      to.x += rand(-1.2, 1.2);
      to.y += rand(-0.6, 0.9);
      to.z += rand(-1.2, 1.2);
    }
    this.tracer(from, to, 0xff7755);
    this.sfx.copShot(dist);
    if (hit) this.damagePlayer(6 + this.stars * 1.5);
    else this.sparks(to, 0xffaa66, 3);
  }

  damagePlayer(d) {
    const p = this.player;
    if (!p.alive) return;
    p.hp -= d;
    this.ui.hurt();
    this.sfx.hurt();
    if (p.hp <= 0) {
      p.hp = 0;
      this.die('abatido');
    }
  }

  // ---------- Efectos ----------
  buildEffects() {
    this.tracers = [];
    for (let i = 0; i < 24; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const l = new THREE.Line(g, m);
      l.frustumCulled = false;
      this.scene.add(l);
      this.tracers.push({ line: l, life: 0 });
    }
    this.sparkPool = [];
    const sg = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.visible = false;
      this.scene.add(m);
      this.sparkPool.push({ m, v: new THREE.Vector3(), life: 0 });
    }
    this.flash = new THREE.PointLight(0xffcc66, 0, 10, 2);
    this.scene.add(this.flash);
    this.flashMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd27a).multiplyScalar(6) }));
    this.flashMesh.visible = false;
    this.scene.add(this.flashMesh);
    this.flashT = 0;
  }

  tracer(a, b, color) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    const arr = t.line.geometry.attributes.position.array;
    arr[0] = a.x; arr[1] = a.y; arr[2] = a.z;
    arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color).multiplyScalar(3);
    t.line.material.opacity = 1;
    t.life = 0.07;
  }

  sparks(pos, color, n = 6) {
    let k = 0;
    for (const s of this.sparkPool) {
      if (s.life > 0) continue;
      s.life = 0.25 + Math.random() * 0.25;
      s.m.visible = true;
      s.m.position.copy(pos);
      s.m.material.color.setHex(color).multiplyScalar(4);
      s.v.set(rand(-4, 4), rand(1, 5), rand(-4, 4));
      if (++k >= n) break;
    }
  }

  updateEffects(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07);
      }
    }
    for (const s of this.sparkPool) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.v.y -= 14 * dt;
      s.m.position.addScaledVector(s.v, dt);
      if (s.life <= 0) s.m.visible = false;
    }
    this.flashT -= dt;
    this.flash.intensity = this.flashT > 0 ? 25 : 0;
    this.flashMesh.visible = this.flashT > 0;
  }

  buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // ---------- Disparo del jugador ----------
  startReload() {
    const p = this.player;
    if (p.reloadT > 0 || p.mag >= CFG.MAG || p.reserve <= 0) return;
    p.reloadT = 1.3;
    this.robTarget = null;
    this.sfx.reload();
  }

  gunPos(out) {
    const p = this.player;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    return out.set(p.pos.x + rx * 0.41 + fx * 0.95, p.pos.y + 1.42, p.pos.z + rz * 0.41 + fz * 0.95);
  }

  shoot() {
    const p = this.player;
    if (p.mag <= 0) {
      this.sfx.click();
      p.fireT = 0.3;
      this.startReload();
      return;
    }
    p.mag--;
    p.fireT = 0.17;
    p.poseT = 0.8;
    p.yaw = this.camYaw;

    const dir = this.camera.getWorldDirection(tmpV).clone();
    const moving = Math.hypot(p.vel.x, p.vel.z);
    const spread = (p.aiming ? 0.008 : 0.03) * (1 - 0.15 * this.up.aim) + moving * 0.003;
    dir.x += rand(-spread, spread);
    dir.y += rand(-spread, spread);
    dir.z += rand(-spread, spread);
    dir.normalize();
    const o = this.camera.position;
    const maxT = 140;
    const tWall = this.world.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, maxT);
    let best = null;
    let bt = tWall;
    for (const c of this.cops) {
      if (c.dead) continue;
      const r = rayCylinder(o.x, o.y, o.z, dir.x, dir.y, dir.z, c.pos.x, c.pos.z, 0.42, c.pos.y, c.pos.y + 1.9, bt);
      if (r && r.t > 0.5 && r.t < bt) {
        bt = r.t;
        best = { c, y: r.y };
      }
    }
    const hitPt = new THREE.Vector3().copy(o).addScaledVector(dir, Math.min(bt, maxT));
    const gp = this.gunPos(new THREE.Vector3());
    this.tracer(gp, hitPt, 0xffe08a);
    this.flash.position.copy(gp);
    this.flashMesh.position.copy(gp);
    this.flashT = 0.05;
    this.sfx.shot();

    if (best) {
      const c = best.c;
      const head = best.y > c.pos.y + 1.5;
      c.hp -= this.dmg * (head ? 2 : 1);
      this.ui.hitMarker();
      this.sfx.hit(head);
      this.sparks(hitPt, 0xff3344, head ? 10 : 6);
      if (c.hp <= 0) {
        c.kill();
        this.stats.kills++;
        this.addHeat(25);
      } else {
        c.state = 'chase';
        this.addHeat(this.heat <= 0 ? 30 : 6);
      }
    } else if (tWall < maxT) {
      this.sparks(hitPt, 0xffcc77, 5);
    }

    // los disparos se oyen
    const P = p.pos;
    const near = this.cops.some((c) => !c.dead && Math.hypot(c.pos.x - P.x, c.pos.z - P.z) < 35);
    if (near) {
      if (this.heat <= 0) this.addHeat(30);
      else this.reportPos(P);
    }
  }

  // ---------- Bucle ----------
  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'play') this.update(dt);
    else if (this.state === 'menu') this.menuCamera(now / 1000);
    if (this.state !== 'play') this.updateEffects(dt);
    this.animateWorld(dt);
    if (this.hq) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((t) => this.loop(t));
  }

  menuCamera(t) {
    const a = t * 0.05;
    this.camera.position.set(Math.cos(a) * 110, 48, Math.sin(a) * 110);
    this.camera.lookAt(0, 6, 0);
    this.moon.position.set(30, 80, 20);
    this.moon.target.position.set(0, 0, 0);
    this.updateLampLights(0, 0, 0.016);
  }

  animateWorld(dt) {
    this.time += dt;
    for (const b of this.world.blinkers) {
      const on = Math.sin(this.time * 2.5 + b.off) > 0.6;
      b.mat.color.setRGB(on ? 5 : 0.15, on ? 0.3 : 0.02, on ? 0.3 : 0.02);
    }
    for (const L of this.world.loot) {
      if (!L.robbed) {
        L.marker.position.y = 2.7 + Math.sin(this.time * 2.5 + L.ix) * 0.18;
        L.marker.rotation.y += dt * 1.6;
      }
    }
    this.world.extractionBeam.material.opacity = 0.13 + Math.sin(this.time * 3) * 0.04;
    this.world.safeRing.rotation.z += dt * 0.5;
  }

  updateLampLights(px, pz, dt) {
    this.lampT -= dt;
    if (this.lampT > 0) return;
    this.lampT = 0.3;
    const sorted = this.world.lamps
      .map((l) => [l, (l.x - px) ** 2 + (l.z - pz) ** 2])
      .sort((a, b) => a[1] - b[1]);
    this.lampLights.forEach((L, i) => {
      L.position.copy(sorted[i][0]);
    });
  }

  update(dt) {
    const p = this.player;
    const w = this.world;
    this.pressed = false;

    // giro con flechas (también sirve si el ratón no se puede bloquear)
    const kr = 2.2 * dt;
    if (this.keys.has('ArrowLeft')) this.camYaw += kr;
    if (this.keys.has('ArrowRight')) this.camYaw -= kr;
    if (this.keys.has('ArrowUp')) this.camPitch = clamp(this.camPitch - kr * 0.6, -0.55, 1.1);
    if (this.keys.has('ArrowDown')) this.camPitch = clamp(this.camPitch + kr * 0.6, -0.55, 1.1);

    // movimiento
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw);
    const rz = -Math.sin(this.camYaw);
    let ix = 0;
    let iz = 0;
    if (this.keys.has('KeyW')) { ix += fx; iz += fz; }
    if (this.keys.has('KeyS')) { ix -= fx; iz -= fz; }
    if (this.keys.has('KeyD')) { ix += rx; iz += rz; }
    if (this.keys.has('KeyA')) { ix -= rx; iz -= rz; }
    const il = Math.hypot(ix, iz);
    if (il > 0) { ix /= il; iz /= il; }
    p.aiming = this.mouse.right && p.reloadT <= 0;
    const wantsRun = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && il > 0 && !p.aiming;
    const running = wantsRun && !p.exhausted && p.stamina > 0;
    let speed = (running ? CFG.RUN : CFG.WALK) * this.speedMul;
    speed *= 1 - 0.25 * (p.weight / this.cap);
    if (p.aiming) speed *= 0.6;
    if (this.robTarget) speed *= 0.25;
    const k = 1 - Math.exp(-12 * dt);
    p.vel.x += (ix * speed - p.vel.x) * k;
    p.vel.z += (iz * speed - p.vel.z) * k;
    const r = w.resolveCircle(p.pos.x + p.vel.x * dt, p.pos.z + p.vel.z * dt, CFG.PLAYER_R);
    p.pos.set(r.x, w.groundY(r.x, r.z), r.z);

    // resistencia
    if (running) {
      p.stamina -= 22 * dt;
      p.staminaWait = 0.8;
      if (p.stamina <= 0) { p.stamina = 0; p.exhausted = true; }
    } else {
      p.staminaWait -= dt;
      if (p.staminaWait <= 0) p.stamina = Math.min(this.maxStamina, p.stamina + 16 * dt);
      if (p.exhausted && p.stamina > 25) p.exhausted = false;
    }

    // orientación del cuerpo
    p.poseT -= dt;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (p.aiming || p.poseT > 0) p.yaw = lerpAngle(p.yaw, this.camYaw, 1 - Math.exp(-20 * dt));
    else if (this.robTarget) p.yaw = lerpAngle(p.yaw, Math.atan2(-(this.robTarget.wx - p.pos.x), -(this.robTarget.wz - p.pos.z)), 1 - Math.exp(-10 * dt));
    else if (sp > 0.4) p.yaw = lerpAngle(p.yaw, Math.atan2(-p.vel.x, -p.vel.z), 1 - Math.exp(-12 * dt));
    p.phase += dt * sp * 1.7;
    animateHumanoid(p.h, p.phase, Math.min(1, sp / 3.5), p.aiming || p.poseT > 0);
    p.h.group.position.copy(p.pos);
    p.h.group.rotation.y = p.yaw;
    p.h.bag.scale.set(1, 0.7 + (p.weight / this.cap) * 0.7, 1 + (p.weight / this.cap) * 0.6);

    // arma
    p.fireT -= dt;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        const n = Math.min(CFG.MAG - p.mag, p.reserve);
        p.mag += n;
        p.reserve -= n;
      }
    }
    if (this.mouse.left && p.fireT <= 0 && p.reloadT <= 0 && !this.robTarget) this.shoot();

    // zonas
    this.inSafe = Math.hypot(p.pos.x - w.safe.x, p.pos.z - w.safe.z) < w.safe.r;
    this.updateRob(dt);
    this.updateExtraction(dt);

    // calor
    this.unseenT += dt;
    if (this.heat > 0 && this.unseenT > (this.inSafe ? 2 : 5)) {
      this.heat -= (this.inSafe ? 18 : 4.5) * dt;
      if (this.heat <= 0) {
        this.heat = 0;
        this.ui.toast('Has despistado a la policía', 'good');
      }
    }

    // policía
    for (const c of this.cops) c.update(dt);
    this.copT -= dt;
    if (this.copT <= 0) {
      this.copT = 1;
      this.manageCops();
    }
    if (this.pressed && this.heat > 0) {
      this.bust += dt * 0.6;
      if (this.bust >= 1) this.die('detenido');
    } else this.bust = Math.max(0, this.bust - dt * 0.8);

    // botín que reaparece
    for (const L of w.loot) {
      if (!L.robbed) continue;
      L.respawnT -= dt;
      if (L.respawnT <= 0 && Math.hypot(L.ix - p.pos.x, L.iz - p.pos.z) > 25) {
        L.robbed = false;
        L.marker.visible = true;
      }
    }

    this.sfx.setSiren(this.heat > 0 ? Math.min(1, 0.4 + this.stars * 0.15) : 0);
    this.updateLampLights(p.pos.x, p.pos.z, dt);
    this.moon.position.set(p.pos.x + 30, 80, p.pos.z + 20);
    this.moon.target.position.set(p.pos.x, 0, p.pos.z);
    this.updateCamera(dt);
    this.updateEffects(dt);
    this.ui.update(dt);
  }

  updateRob(dt) {
    const p = this.player;
    let near = null;
    let nd = 2.0;
    for (const L of this.world.loot) {
      if (L.robbed) continue;
      const d = Math.hypot(L.ix - p.pos.x, L.iz - p.pos.z);
      if (d < nd) {
        nd = d;
        near = L;
      }
    }
    this.nearLoot = near;
    const holding = this.keys.has('KeyE') && near && p.reloadT <= 0 && p.weight + near.def.weight <= this.cap;
    if (!holding) {
      this.robTarget = null;
      this.robT = 0;
      return;
    }
    if (this.robTarget !== near) {
      this.robTarget = near;
      this.robT = 0;
      this.robAlarm = false;
      this.robWitness = false;
    }
    this.robT += dt;
    if (!this.robAlarm && this.robT > 0.8) {
      this.robAlarm = true;
      this.sfx.alarm();
      this.addHeat(near.def.heat);
    }
    if (!this.robWitness && this.cops.some((c) => !c.dead && c.canSee)) {
      this.robWitness = true;
      this.addHeat(15);
    }
    if (this.robT >= near.def.time) {
      const v = Math.round(near.def.min + Math.random() * (near.def.max - near.def.min));
      p.bag.push({ type: near.type, value: v });
      p.weight += near.def.weight;
      p.value += v;
      near.robbed = true;
      near.respawnT = CFG.LOOT_RESPAWN;
      near.marker.visible = false;
      this.stats.robs++;
      this.robTarget = null;
      this.robT = 0;
      this.sfx.cash();
      this.ui.toast(`+$${v.toLocaleString('es-ES')} · ${near.def.name}`, 'money');
    }
  }

  updateExtraction(dt) {
    const p = this.player;
    const ex = this.world.extraction;
    const inside = Math.hypot(p.pos.x - ex.x, p.pos.z - ex.z) < ex.r;
    if (inside && p.value > 0) {
      this.extractT += dt;
      if (this.extractT >= CFG.EXTRACT_TIME) {
        const v = p.value;
        this.bank += v;
        this.stats.extracts++;
        this.stats.best = Math.max(this.stats.best, v);
        p.bag = [];
        p.weight = 0;
        p.value = 0;
        this.extractT = 0;
        this.heat = 0;
        this.bust = 0;
        this.world.moveExtraction(p.pos.x, p.pos.z);
        this.sfx.bank();
        this.ui.toast(`Extracción completada: +$${v.toLocaleString('es-ES')} al banco`, 'good');
        this.save();
        if (!this.wonShown && this.bank >= CFG.GOAL) {
          this.wonShown = true;
          this.save();
          this.state = 'win';
          this.releaseLock();
          this.ui.showWin();
        }
      }
    } else {
      this.extractT = Math.max(0, this.extractT - dt * 1.5);
    }
  }

  updateCamera(dt) {
    const p = this.player;
    const w = this.world;
    const cp = Math.cos(this.camPitch);
    const sp = Math.sin(this.camPitch);
    const fx = -Math.sin(this.camYaw);
    const fz = -Math.cos(this.camYaw);
    const rx = Math.cos(this.camYaw);
    const rz = -Math.sin(this.camYaw);
    const lx = fx * cp;
    const ly = -sp;
    const lz = fz * cp;
    const hx = p.pos.x;
    const hy = p.pos.y + 1.65;
    const hz = p.pos.z;
    let sh = p.aiming ? 0.7 : CFG.SHOULDER;
    const ts = w.raycast(hx, hy, hz, rx, 0, rz, sh + 0.3);
    sh = Math.min(sh, ts - 0.3);
    const px = hx + rx * sh;
    const pz = hz + rz * sh;
    const target = p.aiming ? 2.4 : CFG.CAM_DIST;
    this.camDist = lerp(this.camDist, target, 1 - Math.exp(-10 * dt));
    const tc = w.raycast(px, hy, pz, -lx, -ly, -lz, this.camDist + 0.3);
    const d = Math.max(0.4, Math.min(this.camDist, tc - 0.3));
    this.camera.position.set(px - lx * d, Math.max(0.3, hy - ly * d), pz - lz * d);
    p.h.group.visible = d > 1.1;
    this.camera.lookAt(this.camera.position.x + lx, this.camera.position.y + ly, this.camera.position.z + lz);
    const fov = p.aiming ? 52 : 70;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = lerp(this.camera.fov, fov, 1 - Math.exp(-10 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}

window.__atraco = new Game();
