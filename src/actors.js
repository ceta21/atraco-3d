// Personajes hechos con cajas (jugador y policía) y la IA de la policía.
// Convención: el frente del modelo es el eje local -Z, así rotation.y = yaw.

import * as THREE from 'three';
import { CFG } from './config.js';
import { lerpAngle } from './util.js';

const geoCache = new Map();
function bx(w, h, d) {
  const k = `${w}|${h}|${d}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}
const matCache = new Map();
function std(color, rough = 0.8, metal = 0) {
  const k = `${color}|${rough}|${metal}`;
  let m = matCache.get(k);
  if (!m) matCache.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })));
  return m;
}

export function makeHumanoid(o) {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const add = (parent, geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const body = std(o.body);
  const legs = std(o.legs);
  const skin = std(o.head);
  add(g, bx(0.62, 0.7, 0.34), body, 0, 1.13, 0);
  add(g, bx(0.56, 0.16, 0.3), legs, 0, 0.8, 0);
  const pivot = (x, y) => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    g.add(p);
    return p;
  };
  const legL = pivot(-0.15, 0.8);
  const legR = pivot(0.15, 0.8);
  add(legL, bx(0.22, 0.8, 0.24), legs, 0, -0.4, 0);
  add(legR, bx(0.22, 0.8, 0.24), legs, 0, -0.4, 0);
  const armL = pivot(-0.41, 1.42);
  const armR = pivot(0.41, 1.42);
  add(armL, bx(0.17, 0.66, 0.19), body, 0, -0.31, 0);
  add(armR, bx(0.17, 0.66, 0.19), body, 0, -0.31, 0);
  add(armL, bx(0.14, 0.12, 0.15), std(o.hands ?? o.head), 0, -0.69, 0);
  add(armR, bx(0.14, 0.12, 0.15), std(o.hands ?? o.head), 0, -0.69, 0);
  // pistola: larga en el eje Y del brazo, así apunta al frente cuando el brazo se levanta
  add(armR, bx(0.08, 0.34, 0.13), std(0x15161a, 0.4, 0.6), 0, -0.82, -0.04);
  const head = add(g, bx(0.34, 0.36, 0.34), skin, 0, 1.68, 0);
  return { group: g, head, legL, legR, armL, armR };
}

export function animateHumanoid(h, phase, amt, aim) {
  const s = Math.sin(phase) * 0.75 * amt;
  h.legL.rotation.x = s;
  h.legR.rotation.x = -s;
  h.armL.rotation.x = -s * 0.7;
  h.armR.rotation.x = aim ? Math.PI / 2 : s * 0.7;
}

export function makePlayerModel() {
  const h = makeHumanoid({ body: 0x45465a, legs: 0x23242c, head: 0x0f0f12, hands: 0x0f0f12 });
  const visor = new THREE.Mesh(bx(0.28, 0.07, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x22e6ff).multiplyScalar(3) }));
  visor.position.set(0, 1.71, -0.18);
  h.group.add(visor);
  const stripe = new THREE.Mesh(bx(0.64, 0.05, 0.36), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3fb4).multiplyScalar(2) }));
  stripe.position.set(0, 1.3, 0);
  h.group.add(stripe);
  const bag = new THREE.Mesh(bx(0.5, 0.55, 0.26), std(0x4a3a2a));
  bag.position.set(0, 1.12, 0.3);
  bag.castShadow = true;
  h.group.add(bag);
  h.bag = bag;
  return h;
}

function makeCopModel() {
  const h = makeHumanoid({ body: 0x1d2c5c, legs: 0x111833, head: 0xc99a78 });
  const cap = new THREE.Mesh(bx(0.38, 0.1, 0.42), std(0x0e1530));
  cap.position.set(0, 1.9, -0.03);
  h.group.add(cap);
  const badge = new THREE.Mesh(bx(0.1, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd24a).multiplyScalar(2) }));
  badge.position.set(-0.16, 1.3, -0.18);
  h.group.add(badge);
  h.lr = new THREE.MeshBasicMaterial({ color: 0x440000 });
  h.lb = new THREE.MeshBasicMaterial({ color: 0x000044 });
  const l = new THREE.Mesh(bx(0.14, 0.07, 0.14), h.lr);
  l.position.set(-0.3, 1.52, 0);
  const r = new THREE.Mesh(bx(0.14, 0.07, 0.14), h.lb);
  r.position.set(0.3, 1.52, 0);
  h.group.add(l, r);
  return h;
}

export class Cop {
  constructor(game, x, z, state = 'patrol') {
    this.g = game;
    this.h = makeCopModel();
    this.pos = new THREE.Vector3(x, game.world.groundY(x, z), z);
    this.h.group.position.copy(this.pos);
    game.scene.add(this.h.group);
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = CFG.COP_HP;
    this.state = state;
    const w = game.world;
    this.target = w.randomNeighbor(w.nearestIntersection(x, z));
    this.seeT = Math.random() * 0.3;
    this.canSee = false;
    this.lost = 0;
    this.shootT = 1 + Math.random();
    this.phase = Math.random() * 6;
    this.dead = false;
    this.deadT = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.vx = 0;
    this.vz = 0;
    this.flashT = 0;
  }

  dispose() {
    this.g.scene.remove(this.h.group);
  }

  kill() {
    this.dead = true;
    this.deadT = 0;
    this.h.lr.color.setHex(0x220000);
    this.h.lb.color.setHex(0x000022);
  }

  update(dt) {
    const g = this.g;
    const w = g.world;
    const P = g.player.pos;
    if (this.dead) {
      this.deadT += dt;
      this.h.group.rotation.x = Math.min(1, this.deadT * 3) * (Math.PI / 2);
      return;
    }
    const dx = P.x - this.pos.x;
    const dz = P.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;

    this.seeT -= dt;
    if (this.seeT <= 0) {
      this.seeT = 0.18 + Math.random() * 0.08;
      this.canSee = g.copSees(this, dist);
    }

    const wanted = g.heat > 0 && g.player.alive;
    if (wanted) {
      if (this.canSee) {
        this.state = 'chase';
        this.lost = 0;
        g.spotted();
      } else if (this.state === 'chase') {
        this.lost += dt;
        if (this.lost > 1.0) this.state = 'respond';
      } else if (this.state === 'patrol') {
        this.state = 'respond';
      }
    } else if (this.state !== 'patrol') {
      this.state = 'patrol';
      this.target = w.nearestIntersection(this.pos.x, this.pos.z);
    }

    let mx = 0;
    let mz = 0;
    let spd = 0;
    let face = null;
    const stars = g.stars;
    const lethal = stars >= 2;
    if (this.state === 'chase') {
      face = Math.atan2(-dx, -dz);
      const keep = lethal ? 9 : 1.0;
      if (dist > keep) {
        mx = dx / dist;
        mz = dz / dist;
        spd = lethal ? 5.4 : 6.3;
      } else if (lethal) {
        mx = (-dz / dist) * this.strafe;
        mz = (dx / dist) * this.strafe;
        spd = 1.8;
        if (Math.random() < dt * 0.4) this.strafe *= -1;
      }
      if (lethal && dist < 40) {
        this.shootT -= dt;
        if (this.shootT <= 0) {
          this.shootT = Math.max(0.55, 1.5 - stars * 0.15) + Math.random() * 0.7;
          this.flashT = 0.06;
          g.copShoot(this, dist);
        }
      }
      if (dist < 1.9) g.arrestPressure();
    } else if (this.state === 'respond') {
      const f = g.chaseField;
      const d = f ? w.stepDir(f, this.pos.x, this.pos.z) : null;
      if (d && w.fieldAt(f, this.pos.x, this.pos.z) > 1) {
        mx = d.x;
        mz = d.z;
        spd = 5.2;
      } else {
        this.state = 'search';
        this.target = w.randomNeighbor(w.nearestIntersection(this.pos.x, this.pos.z));
      }
    } else {
      const f = w.interFields[this.target];
      const d = w.stepDir(f, this.pos.x, this.pos.z);
      if (d && w.fieldAt(f, this.pos.x, this.pos.z) > 1) {
        mx = d.x;
        mz = d.z;
        spd = this.state === 'search' ? 4.2 : 2.1;
      } else {
        this.target = w.randomNeighbor(this.target);
      }
    }

    const k = 1 - Math.exp(-10 * dt);
    this.vx += (mx * spd - this.vx) * k;
    this.vz += (mz * spd - this.vz) * k;
    let nx = this.pos.x + this.vx * dt;
    let nz = this.pos.z + this.vz * dt;
    for (const o of g.cops) {
      if (o === this || o.dead) continue;
      const ox = nx - o.pos.x;
      const oz = nz - o.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 0.81 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (0.9 - d) * 0.5;
        nx += (ox / d) * push;
        nz += (oz / d) * push;
      }
    }
    {
      const ox = nx - P.x;
      const oz = nz - P.z;
      const d = Math.hypot(ox, oz);
      const m = CFG.COP_R + CFG.PLAYER_R;
      if (d < m && d > 1e-4) {
        nx = P.x + (ox / d) * m;
        nz = P.z + (oz / d) * m;
      }
    }
    const r = w.resolveCircle(nx, nz, CFG.COP_R);
    this.pos.set(r.x, w.groundY(r.x, r.z), r.z);

    const sp = Math.hypot(this.vx, this.vz);
    const tYaw = face ?? (sp > 0.3 ? Math.atan2(-this.vx, -this.vz) : this.yaw);
    this.yaw = lerpAngle(this.yaw, tYaw, 1 - Math.exp(-10 * dt));
    this.phase += dt * sp * 1.9;
    animateHumanoid(this.h, this.phase, Math.min(1, sp / 3), this.state === 'chase' && lethal);
    this.h.group.position.copy(this.pos);
    this.h.group.rotation.y = this.yaw;

    const on = this.state !== 'patrol';
    const a = Math.sin(g.time * 14 + this.phase) > 0 ? 1 : 0;
    this.h.lr.color.setRGB(on ? 5 * a + 0.2 : 0.35, 0.03, 0.03);
    this.h.lb.color.setRGB(0.03, 0.08, on ? 5 * (1 - a) + 0.2 : 0.35);
  }

  // Punto aproximado de la boca del arma, en coordenadas del mundo.
  muzzle(out) {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    return out.set(this.pos.x + rx * 0.42 + fx * 0.9, this.pos.y + 1.4, this.pos.z + rz * 0.42 + fz * 0.9);
  }
}
