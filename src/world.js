// Ciudad procedural: edificios, aceras, coches aparcados, farolas, botín,
// refugio, zona de extracción y rejilla de navegación para la IA.

import * as THREE from 'three';
import { CFG, LOOT_TYPES } from './config.js';
import { clamp, rayBox } from './util.js';

// Generador aleatorio con semilla: la ciudad sale igual en cada partida.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Color por encima de 1 para que el bloom lo haga brillar.
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function facadeTextures(rng) {
  const S = 256;
  const n = 8;
  const cw = S / n;
  const col = document.createElement('canvas');
  const em = document.createElement('canvas');
  col.width = col.height = em.width = em.height = S;
  const c = col.getContext('2d');
  const e = em.getContext('2d');
  c.fillStyle = '#4a4e5b';
  c.fillRect(0, 0, S, S);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  const lit = ['#ffd59a', '#ffe7b8', '#9fe3ff', '#ffbf6b', '#f2eaff', '#ff9ad8'];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const wx = x * cw + 6;
      const wy = y * cw + 8;
      const ww = cw - 12;
      const wh = cw - 15;
      c.fillStyle = '#13151c';
      c.fillRect(wx, wy, ww, wh);
      if (rng() < 0.3) {
        e.globalAlpha = 0.45 + rng() * 0.55;
        e.fillStyle = lit[Math.floor(rng() * lit.length)];
        e.fillRect(wx, wy, ww, wh);
        e.globalAlpha = 1;
      }
    }
  }
  c.fillStyle = '#2a2d36';
  for (let y = 0; y < n; y++) c.fillRect(0, y * cw, S, 4);
  const mk = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: mk(col), emissiveMap: mk(em) };
}

export function textTexture(text, color = '#ffffff', font = '700 88px Rajdhani, Arial, sans-serif') {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Caja con UV escaladas por tamaño, para que las ventanas no se estiren.
function boxGeo(w, h, d, tile = 16) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    }
  }
  return g;
}

const SIGN_WORDS = ['BAR', 'HOTEL', '24H', 'CLUB', 'PIZZA', 'MOTEL', 'RAMEN', 'CASINO', 'KARAOKE', 'TATTOO', 'SUSHI', 'ARCADE', 'GYM', 'LAVANDERÍA', 'KEBAB', 'DISCO'];
const SIGN_COLORS = ['#ff3fb4', '#3ff2ff', '#ffb03f', '#b46bff', '#5dff8a', '#ff5a5a'];

export class World {
  constructor(scene, seed = 20261124) {
    this.scene = scene;
    this.rng = mulberry32(seed);
    this.boxes = [];
    this.buildingRects = [];
    this.blockRects = [];
    this.parkRects = [];
    this.loot = [];
    this.lamps = [];
    this.blinkers = [];
    this.slots = [];
    this.carSpots = [];

    const { N, PITCH, HALF, BLOCK } = CFG;
    this.centers = Array.from({ length: N }, (_, i) => (i - (N - 1) / 2) * PITCH);
    const inner = this.centers.slice(0, -1).map((c) => c + PITCH / 2);
    const outer = (this.centers[N - 1] + BLOCK / 2 + HALF) / 2;
    this.lines = [-outer, ...inner, outer];
    this.intersections = [];
    for (const z of this.lines) for (const x of this.lines) this.intersections.push({ x, z });

    // Refugio: delante del edificio noroeste de la manzana central.
    this.safe = { x: -10.25, z: -21.6, r: 3 };
    this.spawn = { x: -10.25, z: -27 };

    this.buildMaterials();
    this.buildGround();
    this.buildBlocks();
    this.buildSafehouse();
    this.placeLoot();
    this.placeCars();
    this.buildLamps();
    this.buildBoundary();
    this.buildSkyline();
    this.buildBuckets();
    this.buildNav();
    this.buildExtraction();
  }

  // ---------- Construcción ----------

  buildMaterials() {
    const rng = this.rng;
    const sets = [facadeTextures(rng), facadeTextures(rng), facadeTextures(rng)];
    const tints = [0x8f94a3, 0xa3907f, 0x7f8fa3, 0x8fa394, 0x9a8aa8];
    this.wallMats = [];
    for (let i = 0; i < 6; i++) {
      const s = sets[i % sets.length];
      this.wallMats.push(
        new THREE.MeshStandardMaterial({
          map: s.map,
          emissiveMap: s.emissiveMap,
          emissive: 0xffffff,
          emissiveIntensity: 0.95,
          color: tints[i % tints.length],
          roughness: 0.85,
          metalness: 0.05,
        }),
      );
    }
    this.mat = {
      roof: new THREE.MeshStandardMaterial({ color: 0x24262d, roughness: 0.95 }),
      sidewalk: new THREE.MeshStandardMaterial({ color: 0x30323a, roughness: 0.9 }),
      asphalt: new THREE.MeshStandardMaterial({ color: 0x17181d, roughness: 0.82, metalness: 0.15 }),
      grass: new THREE.MeshStandardMaterial({ color: 0x1c3a26, roughness: 1 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x1f4a2c, roughness: 0.9, flatShading: true }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x25272e, roughness: 0.95 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x5b5f68, roughness: 0.35, metalness: 0.85 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x0d1626, roughness: 0.15, metalness: 0.6 }),
      tire: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.9 }),
    };
  }

  addBox(minX, maxX, minZ, maxZ, maxY, extra = {}) {
    const b = { minX, maxX, minY: 0, maxY, minZ, maxZ, ...extra };
    this.boxes.push(b);
    return b;
  }

  buildGround() {
    const S = CFG.HALF * 2 + 260;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(S, S), this.mat.asphalt);
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    this.scene.add(g);

    // Marcas viales discontinuas
    const H = CFG.HALF;
    const pts = [];
    for (const L of this.lines) {
      for (let s = -H + 4; s < H - 4; s += 6) {
        const near = this.lines.some((l) => Math.abs(l - s) < 9);
        if (near) continue;
        pts.push([s, L, true], [L, s, false]);
      }
    }
    const geo = new THREE.PlaneGeometry(2.4, 0.22);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7d7a62 });
    const im = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    pts.forEach(([x, z, alongX], i) => {
      e.set(-Math.PI / 2, 0, alongX ? 0 : Math.PI / 2);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, 0.015, z), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m);
    });
    this.scene.add(im);
  }

  buildBlocks() {
    const rng = this.rng;
    const { N, BLOCK } = CFG;
    const B2 = BLOCK / 2;
    const IN = 19;
    const slab = new THREE.BoxGeometry(BLOCK, 0.12, BLOCK);
    const mid = (N - 1) / 2;
    for (let bi = 0; bi < N; bi++) {
      for (let bj = 0; bj < N; bj++) {
        const cx = this.centers[bi];
        const cz = this.centers[bj];
        const isCenter = bi === mid && bj === mid;
        const s = new THREE.Mesh(slab, this.mat.sidewalk);
        s.position.set(cx, 0.06, cz);
        s.receiveShadow = true;
        this.scene.add(s);
        this.blockRects.push({ minX: cx - B2, maxX: cx + B2, minZ: cz - B2, maxZ: cz + B2, cx, cz });
        const distC = Math.hypot(cx, cz);
        if (!isCenter && rng() < 0.1) {
          this.buildPark(cx, cz);
          continue;
        }
        const lots = [];
        if (!isCenter && rng() < 0.2) {
          lots.push([cx - IN, cx + IN, cz - IN, cz + IN, true]);
        } else {
          for (const lx of [0, 1]) {
            for (const lz of [0, 1]) {
              lots.push([lx ? cx + 1.5 : cx - IN, lx ? cx + IN : cx - 1.5, lz ? cz + 1.5 : cz - IN, lz ? cz + IN : cz - 1.5, false]);
            }
          }
        }
        lots.forEach((L, k) => {
          const [x0, x1, z0, z1, whole] = L;
          const safeLot = isCenter && k === 0;
          if (!safeLot && !whole && rng() < 0.07) return; // solar vacío
          const k2 = 1.35 - Math.min(1, distC / 170) * 0.6;
          const h = safeLot ? 7 : (whole ? 28 + rng() * 42 : 9 + rng() * 34) * k2;
          this.addBuilding(x0, x1, z0, z1, h, cx, cz, IN, safeLot);
        });
      }
    }
  }

  addBuilding(x0, x1, z0, z1, h, cx, cz, IN, safeLot) {
    const rng = this.rng;
    const w = x1 - x0;
    const d = z1 - z0;
    const wall = this.wallMats[Math.floor(rng() * this.wallMats.length)];
    const mats = [wall, wall, this.mat.roof, this.mat.roof, wall, wall];
    const m = new THREE.Mesh(boxGeo(w, h, d), mats);
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    this.scene.add(m);
    this.addBox(x0, x1, z0, z1, h);
    this.buildingRects.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, h });

    // Detalles del tejado
    if (rng() < 0.7) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(2 + rng() * 3, 1.2, 2 + rng() * 3), this.mat.concrete);
      ac.position.set(x0 + 3 + rng() * (w - 6), h + 0.6, z0 + 3 + rng() * (d - 6));
      this.scene.add(ac);
    }
    if (h > 30 && rng() < 0.6) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6, 6), this.mat.metal);
      ant.position.set((x0 + x1) / 2, h + 3, (z0 + z1) / 2);
      this.scene.add(ant);
      const bm = new THREE.MeshBasicMaterial({ color: hdr(0xff2020, 4) });
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), bm);
      b.position.set(ant.position.x, h + 6.1, ant.position.z);
      this.scene.add(b);
      this.blinkers.push({ mat: bm, off: rng() * 6 });
    }

    // Fachadas que dan a la calle
    const faces = [];
    if (x0 <= cx - IN + 0.01) faces.push({ along: 'z', x: x0, a0: z0, a1: z1, nx: -1, nz: 0 });
    if (x1 >= cx + IN - 0.01) faces.push({ along: 'z', x: x1, a0: z0, a1: z1, nx: 1, nz: 0 });
    if (z0 <= cz - IN + 0.01) faces.push({ along: 'x', z: z0, a0: x0, a1: x1, nx: 0, nz: -1 });
    if (z1 >= cz + IN - 0.01) faces.push({ along: 'x', z: z1, a0: x0, a1: x1, nx: 0, nz: 1 });
    if (safeLot) return;

    for (const f of faces) {
      for (let a = f.a0 + 3; a <= f.a1 - 3; a += 5) {
        this.slots.push(f.along === 'z' ? { x: f.x, z: a, nx: f.nx, nz: f.nz } : { x: a, z: f.z, nx: f.nx, nz: f.nz });
      }
    }

    // Letrero de neón
    if (faces.length && rng() < 0.55) {
      const f = faces[Math.floor(rng() * faces.length)];
      const word = SIGN_WORDS[Math.floor(rng() * SIGN_WORDS.length)];
      const col = SIGN_COLORS[Math.floor(rng() * SIGN_COLORS.length)];
      const sw = 4 + rng() * 3;
      const mat = new THREE.MeshBasicMaterial({
        map: textTexture(word, col),
        transparent: true,
        depthWrite: false,
        color: new THREE.Color(2.4, 2.4, 2.4),
      });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 4), mat);
      const a = f.a0 + 4 + rng() * Math.max(0, f.a1 - f.a0 - 8);
      const y = 4.5 + rng() * Math.min(6, h - 6);
      if (f.along === 'z') p.position.set(f.x + f.nx * 0.08, y, a);
      else p.position.set(a, y, f.z + f.nz * 0.08);
      p.rotation.y = Math.atan2(f.nx, f.nz);
      this.scene.add(p);
    }
  }

  buildPark(cx, cz) {
    const rng = this.rng;
    const g = new THREE.Mesh(new THREE.BoxGeometry(38, 0.16, 38), this.mat.grass);
    g.position.set(cx, 0.08, cz);
    g.receiveShadow = true;
    this.scene.add(g);
    this.parkRects.push({ minX: cx - 19, maxX: cx + 19, minZ: cz - 19, maxZ: cz + 19 });
    const n = 6 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const x = cx - 15 + rng() * 30;
      const z = cz - 15 + rng() * 30;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 2.6, 6), this.mat.trunk);
      tr.position.set(x, 1.3, z);
      tr.castShadow = true;
      this.scene.add(tr);
      const r = 1.5 + rng() * 0.9;
      const lf = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), this.mat.leaf);
      lf.position.set(x, 2.6 + r * 0.7, z);
      lf.castShadow = true;
      this.scene.add(lf);
      this.addBox(x - 0.35, x + 0.35, z - 0.35, z + 0.35, 3, { thin: true });
    }
  }

  buildSafehouse() {
    const { x, z } = this.safe;
    const g = new THREE.Group();
    const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.4), this.mat.metal);
    door.position.set(x, 1.82, -19.03);
    door.rotation.y = Math.PI;
    g.add(door);
    const frameMat = new THREE.MeshBasicMaterial({ color: hdr(0x22e6ff, 1.6) });
    const bars = [
      [5.4, 0.12, x, 3.6],
      [0.12, 3.5, x - 2.65, 1.85],
      [0.12, 3.5, x + 2.65, 1.85],
    ];
    for (const [w, h, bx, by] of bars) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), frameMat);
      b.position.set(bx, by, -19.06);
      g.add(b);
    }
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 1.25),
      new THREE.MeshBasicMaterial({ map: textTexture('REFUGIO', '#22e6ff'), transparent: true, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.6) }),
    );
    sign.position.set(x, 5, -19.08);
    sign.rotation.y = Math.PI;
    g.add(sign);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.safe.r - 0.25, this.safe.r, 40),
      new THREE.MeshBasicMaterial({ color: hdr(0x22e6ff, 1.4), side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.14, z);
    g.add(ring);
    this.safeRing = ring;
    this.scene.add(g);
  }

  placeLoot() {
    const rng = this.rng;
    const slots = this.slots.slice();
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    const want = [['caja', 4], ['joyeria', 7], ['atm', 14]];
    const used = new Set();
    for (const [type, count] of want) {
      let placed = 0;
      for (let k = 0; k < slots.length && placed < count; k++) {
        if (used.has(k)) continue;
        const s = slots[k];
        const ix = s.x + s.nx * 1.3;
        const iz = s.z + s.nz * 1.3;
        if (Math.hypot(ix - this.safe.x, iz - this.safe.z) < 16) continue;
        if (this.loot.some((l) => Math.hypot(l.ix - ix, l.iz - iz) < 12)) continue;
        used.add(k);
        this.loot.push(this.makeLoot(type, s, ix, iz));
        placed++;
      }
    }
  }

  makeLoot(type, s, ix, iz) {
    const def = LOOT_TYPES[type];
    const g = new THREE.Group();
    g.position.set(s.x, 0.12, s.z);
    g.rotation.y = Math.atan2(s.nx, s.nz);
    if (type === 'atm') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.7), this.mat.dark);
      body.position.set(0, 0.95, 0.35);
      body.castShadow = true;
      g.add(body);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshBasicMaterial({ color: hdr(def.color, 2) }));
      scr.position.set(0, 1.45, 0.71);
      g.add(scr);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 0.72), new THREE.MeshBasicMaterial({ color: hdr(def.color, 3) }));
      strip.position.set(0, 1.86, 0.35);
      g.add(strip);
    } else if (type === 'joyeria') {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.4), new THREE.MeshBasicMaterial({ color: hdr(0xffd27a, 1.3) }));
      win.position.set(0, 1.5, 0.05);
      g.add(win);
      for (let i = -1; i <= 1; i++) {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ color: hdr(0xbfeaff, 3) }));
        gem.position.set(i * 1.2, 1.25, 0.25);
        g.add(gem);
      }
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 1),
        new THREE.MeshBasicMaterial({ map: textTexture('JOYERÍA', '#ffd24a'), transparent: true, depthWrite: false, color: new THREE.Color(2.4, 2.4, 2.4) }),
      );
      sign.position.set(0, 3.3, 0.07);
      g.add(sign);
    } else {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.35, 28), this.mat.metal);
      v.rotation.x = Math.PI / 2;
      v.position.set(0, 1.5, 0.18);
      v.castShadow = true;
      g.add(v);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.06, 8, 32), new THREE.MeshBasicMaterial({ color: hdr(def.color, 3) }));
      ring.position.set(0, 1.5, 0.36);
      g.add(ring);
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 6, 16), this.mat.dark);
      wheel.position.set(0, 1.5, 0.4);
      g.add(wheel);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 1),
        new THREE.MeshBasicMaterial({ map: textTexture('BANCO', '#ff4466'), transparent: true, depthWrite: false, color: new THREE.Color(2.4, 2.4, 2.4) }),
      );
      sign.position.set(0, 3.5, 0.07);
      g.add(sign);
    }
    this.scene.add(g);
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), new THREE.MeshBasicMaterial({ color: hdr(def.color, 3.5) }));
    marker.position.set(ix, 2.7, iz);
    this.scene.add(marker);
    return { type, def, ix, iz, wx: s.x, wz: s.z, robbed: false, respawnT: 0, marker, group: g };
  }

  placeCars() {
    const rng = this.rng;
    const colors = [0xb3202a, 0x1f4fb3, 0xd8d8d8, 0x202226, 0xe0a020, 0x2f7a4a, 0x6a2fa0];
    const bodyMats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.6 }));
    const bodyG = new THREE.BoxGeometry(1.9, 0.75, 4.3);
    const cabG = new THREE.BoxGeometry(1.7, 0.6, 2.2);
    const lightG = new THREE.BoxGeometry(1.5, 0.12, 0.05);
    const wheelG = new THREE.CylinderGeometry(0.36, 0.36, 0.25, 12);
    const tail = new THREE.MeshBasicMaterial({ color: hdr(0xff2030, 2.5) });
    const head = new THREE.MeshBasicMaterial({ color: hdr(0xfff2d0, 1.6) });
    const OFF = CFG.BLOCK / 2 + 1.3;
    for (const br of this.blockRects) {
      const { cx, cz } = br;
      for (let side = 0; side < 4; side++) {
        const n = Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          const t = -15 + rng() * 30;
          let x;
          let z;
          let alongZ;
          if (side === 0) [x, z, alongZ] = [cx - OFF, cz + t, true];
          else if (side === 1) [x, z, alongZ] = [cx + OFF, cz + t, true];
          else if (side === 2) [x, z, alongZ] = [cx + t, cz - OFF, false];
          else [x, z, alongZ] = [cx + t, cz + OFF, false];
          if (Math.abs(x) > CFG.HALF - 3 || Math.abs(z) > CFG.HALF - 3) continue;
          if (this.carSpots.some((c) => Math.hypot(c.x - x, c.z - z) < 6.5)) continue;
          if (this.loot.some((l) => Math.hypot(l.ix - x, l.iz - z) < 5)) continue;
          if (Math.hypot(x - this.safe.x, z - this.safe.z) < 8) continue;
          const g = new THREE.Group();
          const body = new THREE.Mesh(bodyG, bodyMats[Math.floor(rng() * bodyMats.length)]);
          body.position.y = 0.72;
          body.castShadow = true;
          g.add(body);
          const cab = new THREE.Mesh(cabG, this.mat.glass);
          cab.position.set(0, 1.38, 0.2);
          g.add(cab);
          const tl = new THREE.Mesh(lightG, tail);
          tl.position.set(0, 0.8, 2.16);
          g.add(tl);
          const hl = new THREE.Mesh(lightG, head);
          hl.position.set(0, 0.8, -2.16);
          g.add(hl);
          for (const [wx, wz] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
            const wh = new THREE.Mesh(wheelG, this.mat.tire);
            wh.rotation.z = Math.PI / 2;
            wh.position.set(wx, 0.36, wz);
            g.add(wh);
          }
          g.position.set(x, 0, z);
          g.rotation.y = (alongZ ? 0 : Math.PI / 2) + (rng() < 0.5 ? Math.PI : 0);
          this.scene.add(g);
          if (alongZ) this.addBox(x - 0.95, x + 0.95, z - 2.15, z + 2.15, 1.6, { car: true });
          else this.addBox(x - 2.15, x + 2.15, z - 0.95, z + 0.95, 1.6, { car: true });
          this.carSpots.push({ x, z, alongZ });
        }
      }
    }
  }

  buildLamps() {
    const pos = [];
    const E = CFG.BLOCK / 2 - 0.7;
    for (const br of this.blockRects) {
      const { cx, cz } = br;
      for (const t of [-11, 11]) {
        pos.push([cx - E, cz + t], [cx + E, cz + t], [cx + t, cz - E], [cx + t, cz + E]);
      }
    }
    const ok = pos.filter(([x, z]) => !this.loot.some((l) => Math.hypot(l.ix - x, l.iz - z) < 2.2));
    const poleG = new THREE.CylinderGeometry(0.09, 0.12, 6, 6);
    const bulbG = new THREE.SphereGeometry(0.3, 10, 8);
    const poles = new THREE.InstancedMesh(poleG, this.mat.metal, ok.length);
    const bulbs = new THREE.InstancedMesh(bulbG, new THREE.MeshBasicMaterial({ color: hdr(0xffb866, 3.2) }), ok.length);
    const m = new THREE.Matrix4();
    ok.forEach(([x, z], i) => {
      m.makeTranslation(x, 3.1, z);
      poles.setMatrixAt(i, m);
      m.makeTranslation(x, 6.1, z);
      bulbs.setMatrixAt(i, m);
      this.lamps.push(new THREE.Vector3(x, 5.7, z));
    });
    this.scene.add(poles, bulbs);
  }

  buildBoundary() {
    const H = CFG.HALF;
    const L = 2 * H + 4;
    const walls = [
      [0, -H - 1, L, 2],
      [0, H + 1, L, 2],
      [-H - 1, 0, 2, L],
      [H + 1, 0, 2, L],
    ];
    const stripe = new THREE.MeshBasicMaterial({ color: hdr(0xffaa22, 1.6) });
    for (const [x, z, w, d] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 7, d), this.mat.concrete);
      m.position.set(x, 3.5, z);
      m.receiveShadow = true;
      this.scene.add(m);
      const s = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.25, d + 0.05), stripe);
      s.position.set(x, 1.2, z);
      this.scene.add(s);
      this.addBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 7);
    }
  }

  buildSkyline() {
    const rng = this.rng;
    const H = CFG.HALF;
    let placed = 0;
    let tries = 0;
    while (placed < 70 && tries < 2000) {
      tries++;
      const x = (rng() * 2 - 1) * (H + 90);
      const z = (rng() * 2 - 1) * (H + 90);
      if (Math.abs(x) < H + 14 && Math.abs(z) < H + 14) continue;
      const w = 14 + rng() * 22;
      const d = 14 + rng() * 22;
      const h = 30 + rng() * 90;
      const wall = this.wallMats[Math.floor(rng() * this.wallMats.length)];
      const m = new THREE.Mesh(boxGeo(w, h, d), [wall, wall, this.mat.roof, this.mat.roof, wall, wall]);
      m.position.set(x, h / 2, z);
      this.scene.add(m);
      placed++;
    }
  }

  buildExtraction() {
    const g = new THREE.Group();
    const col = 0x3dffb0;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(4.5, 4.5, 80, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: hdr(col, 1.1), transparent: true, opacity: 0.16, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = 40;
    g.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.1, 4.5, 48), new THREE.MeshBasicMaterial({ color: hdr(col, 1.8), side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(4.1, 48),
      new THREE.MeshBasicMaterial({ color: hdr(col, 0.8), transparent: true, opacity: 0.08, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.04;
    g.add(disc);
    this.scene.add(g);
    this.extractionMesh = g;
    this.extractionBeam = beam;
    this.extraction = { x: 0, z: 0, r: 4.5 };
    this.extractCandidates = this.intersections.filter((p) => Math.hypot(p.x - this.safe.x, p.z - this.safe.z) > 45);
  }

  moveExtraction(px, pz) {
    const far = this.extractCandidates.filter((p) => Math.hypot(p.x - px, p.z - pz) > 90 && !(p.x === this.extraction.x && p.z === this.extraction.z));
    const list = far.length ? far : this.extractCandidates;
    const p = list[Math.floor(Math.random() * list.length)];
    this.extraction.x = p.x;
    this.extraction.z = p.z;
    this.extractionMesh.position.set(p.x, 0, p.z);
  }

  // ---------- Consultas ----------

  groundY(x, z) {
    const { PITCH, N, BLOCK } = CFG;
    const i = Math.round(x / PITCH + (N - 1) / 2);
    const j = Math.round(z / PITCH + (N - 1) / 2);
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    const b = BLOCK / 2;
    return Math.abs(x - this.centers[i]) <= b && Math.abs(z - this.centers[j]) <= b ? 0.12 : 0;
  }

  buildBuckets() {
    const S = 16;
    this.bucketSize = S;
    this.buckets = new Map();
    for (const b of this.boxes) {
      const i0 = Math.floor((b.minX - 1) / S);
      const i1 = Math.floor((b.maxX + 1) / S);
      const j0 = Math.floor((b.minZ - 1) / S);
      const j1 = Math.floor((b.maxZ + 1) / S);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = i * 10007 + j;
          let arr = this.buckets.get(k);
          if (!arr) this.buckets.set(k, (arr = []));
          arr.push(b);
        }
      }
    }
  }

  near(x, z) {
    const S = this.bucketSize;
    return this.buckets.get(Math.floor(x / S) * 10007 + Math.floor(z / S)) || [];
  }

  // Empuja un círculo fuera de las cajas. Devuelve la posición corregida.
  resolveCircle(x, z, r) {
    for (let it = 0; it < 2; it++) {
      for (const b of this.near(x, z)) {
        const px = clamp(x, b.minX, b.maxX);
        const pz = clamp(z, b.minZ, b.maxZ);
        const dx = x - px;
        const dz = z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = px + (dx / d) * r;
          z = pz + (dz / d) * r;
        } else {
          const l = x - b.minX;
          const rr = b.maxX - x;
          const t = z - b.minZ;
          const bt = b.maxZ - z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) x = b.minX - r;
          else if (m === rr) x = b.maxX + r;
          else if (m === t) z = b.minZ - r;
          else z = b.maxZ + r;
        }
      }
    }
    const H = CFG.HALF - r;
    return { x: clamp(x, -H, H), z: clamp(z, -H, H) };
  }

  // Distancia al primer obstáculo (cajas y suelo) a lo largo del rayo.
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT;
    if (dy < -1e-6) {
      const tg = -oy / dy;
      if (tg >= 0 && tg < best) best = tg;
    }
    for (const b of this.boxes) {
      const t = rayBox(ox, oy, oz, dx, dy, dz, b, best);
      if (t < best) best = t;
    }
    return best;
  }

  hasLOS(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-3) return true;
    return this.raycast(ax, ay, az, dx / L, dy / L, dz / L, L) >= L - 0.05;
  }

  // ---------- Navegación ----------

  buildNav() {
    const { CELL, HALF } = CFG;
    const G = (this.G = Math.round((2 * HALF) / CELL));
    const blocked = (this.blocked = new Uint8Array(G * G));
    const m = 0.55;
    for (const b of this.boxes) {
      const i0 = Math.max(0, Math.floor((b.minX - m + HALF) / CELL));
      const i1 = Math.min(G - 1, Math.floor((b.maxX + m + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((b.minZ - m + HALF) / CELL));
      const j1 = Math.min(G - 1, Math.floor((b.maxZ + m + HALF) / CELL));
      for (let j = j0; j <= j1; j++) {
        const cz = -HALF + (j + 0.5) * CELL;
        if (cz < b.minZ - m || cz > b.maxZ + m) continue;
        for (let i = i0; i <= i1; i++) {
          const cx = -HALF + (i + 0.5) * CELL;
          if (cx >= b.minX - m && cx <= b.maxX + m) blocked[j * G + i] = 1;
        }
      }
    }
    for (let k = 0; k < G; k++) {
      blocked[k] = blocked[(G - 1) * G + k] = blocked[k * G] = blocked[k * G + G - 1] = 1;
    }
    this.interFields = this.intersections.map((p) => this.bfs(this.cellIdx(p.x, p.z)));
    const n = this.lines.length;
    this.interNeighbors = this.intersections.map((_, idx) => {
      const r = Math.floor(idx / n);
      const c = idx % n;
      const out = [];
      if (r > 0) out.push(idx - n);
      if (r < n - 1) out.push(idx + n);
      if (c > 0) out.push(idx - 1);
      if (c < n - 1) out.push(idx + 1);
      return out;
    });
  }

  cellIdx(x, z) {
    const { CELL, HALF } = CFG;
    const G = this.G;
    const i = clamp(Math.floor((x + HALF) / CELL), 0, G - 1);
    const j = clamp(Math.floor((z + HALF) / CELL), 0, G - 1);
    return j * G + i;
  }

  bfs(target) {
    const G = this.G;
    const N = G * G;
    const d = new Uint16Array(N).fill(65535);
    const q = new Int32Array(N);
    let h = 0;
    let t = 0;
    const blocked = this.blocked;
    // si el objetivo cae dentro de un obstáculo, se siembra desde las celdas libres cercanas
    if (!blocked[target]) {
      d[target] = 0;
      q[t++] = target;
    } else {
      const ti = target % G;
      const tj = (target / G) | 0;
      for (let r = 1; r <= 3 && t === 0; r++) {
        for (let j = tj - r; j <= tj + r; j++) {
          for (let i = ti - r; i <= ti + r; i++) {
            if (i < 0 || j < 0 || i >= G || j >= G) continue;
            const k = j * G + i;
            if (!blocked[k] && d[k] === 65535) {
              d[k] = 0;
              q[t++] = k;
            }
          }
        }
      }
    }
    while (h < t) {
      const c = q[h++];
      const ci = c % G;
      const nd = d[c] + 1;
      if (ci > 0 && !blocked[c - 1] && d[c - 1] === 65535) { d[c - 1] = nd; q[t++] = c - 1; }
      if (ci < G - 1 && !blocked[c + 1] && d[c + 1] === 65535) { d[c + 1] = nd; q[t++] = c + 1; }
      if (c >= G && !blocked[c - G] && d[c - G] === 65535) { d[c - G] = nd; q[t++] = c - G; }
      if (c < N - G && !blocked[c + G] && d[c + G] === 65535) { d[c + G] = nd; q[t++] = c + G; }
    }
    return d;
  }

  fieldAt(field, x, z) {
    return field[this.cellIdx(x, z)];
  }

  // Dirección unitaria hacia la celda vecina más cercana al objetivo del campo.
  stepDir(field, x, z) {
    const G = this.G;
    const { CELL, HALF } = CFG;
    const idx = this.cellIdx(x, z);
    const i = idx % G;
    const j = (idx / G) | 0;
    let best = field[idx];
    let bi = -1;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
        const n = nj * G + ni;
        if (this.blocked[n]) continue;
        if (di && dj && (this.blocked[j * G + ni] || this.blocked[nj * G + i])) continue;
        const v = field[n] + (di && dj ? 0.5 : 0);
        if (v < best) {
          best = v;
          bi = n;
        }
      }
    }
    if (bi < 0) return null;
    const tx = -HALF + ((bi % G) + 0.5) * CELL;
    const tz = -HALF + (((bi / G) | 0) + 0.5) * CELL;
    const dx = tx - x;
    const dz = tz - z;
    const L = Math.hypot(dx, dz) || 1;
    return { x: dx / L, z: dz / L };
  }

  nearestIntersection(x, z) {
    let best = 0;
    let bd = Infinity;
    this.intersections.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  randomNeighbor(idx) {
    const n = this.interNeighbors[idx];
    return n[Math.floor(Math.random() * n.length)];
  }
}
