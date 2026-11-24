// HUD, minimapa, tienda y pantallas superpuestas.

import { CFG, LOOT_TYPES, UPGRADES, AMMO_PACK } from './config.js';

const $ = (id) => document.getElementById(id);
const money = (v) => '$' + Math.round(v).toLocaleString('es-ES');
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class UI {
  constructor(game) {
    this.g = game;
    this.el = {};
    for (const id of ['hud', 'bank', 'goal', 'obj', 'stars', 'hp', 'st', 'bag', 'ammo', 'reload', 'cross', 'prompt', 'prog', 'prog-label', 'prog-fill', 'bust', 'bust-fill', 'toasts', 'hurt', 'menu', 'pause', 'pause-stats', 'shop', 'shop-bank', 'shop-list', 'dead', 'dead-title', 'dead-text', 'win', 'win-text', 'reset']) {
      this.el[id] = $(id);
    }
    this.mm = $('mm').getContext('2d');
    this.hitT = 0;
    this.hurtA = 0;
    this.resetArmed = false;

    $('play').addEventListener('click', () => game.start());
    $('resume').addEventListener('click', () => game.resume());
    $('respawn').addEventListener('click', () => game.respawn());
    $('shop-close').addEventListener('click', () => game.closeShop());
    $('win-close').addEventListener('click', () => game.closeWin());
    this.el.reset.addEventListener('click', () => {
      if (!this.resetArmed) {
        this.resetArmed = true;
        this.el.reset.textContent = '¿Seguro? Pulsa otra vez';
        return;
      }
      this.resetArmed = false;
      this.el.reset.textContent = 'Borrar progreso';
      game.resetProgress();
    });
  }

  set(el, v, html = false) {
    if (el._v === v) return;
    el._v = v;
    if (html) el.innerHTML = v;
    else el.textContent = v;
  }

  show(id, on) {
    this.el[id].classList.toggle('hidden', !on);
  }

  toast(msg, cls = 'info') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls;
    d.textContent = msg;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => d.remove(), 3200);
  }

  hitMarker() {
    this.hitT = 0.15;
  }

  hurt() {
    this.hurtA = 0.8;
  }

  update(dt) {
    const g = this.g;
    const p = g.player;
    const e = this.el;
    this.set(e.bank, money(g.bank));
    e.goal.firstChild.style.width = Math.min(100, (g.bank / CFG.GOAL) * 100) + '%';

    let obj;
    if (p.value > 0) {
      const d = Math.round(Math.hypot(g.world.extraction.x - p.pos.x, g.world.extraction.z - p.pos.z));
      obj = `Lleva el botín a la <b style="color:var(--green)">extracción</b> (${d} m)`;
    } else if (g.stars > 0) obj = 'Despista a la policía o vuelve al <b style="color:var(--cyan)">refugio</b>';
    else obj = 'Roba un objetivo marcado en el mapa';
    this.set(e.obj, obj, true);

    const s = g.stars;
    let st = '';
    for (let i = 0; i < 4; i++) st += `<span class="${i < s ? 'on' : 'off'}">★</span>`;
    this.set(e.stars, st, true);
    e.stars.classList.toggle('flash', s > 0 && g.unseenT < 1.5);

    e.hp.style.width = Math.max(0, (p.hp / g.maxHp) * 100) + '%';
    e.st.style.width = Math.max(0, (p.stamina / g.maxStamina) * 100) + '%';
    e.st.style.opacity = p.exhausted ? 0.4 : 1;
    this.set(e.bag, `MOCHILA <b>${money(p.value)}</b> · peso ${p.weight}/${g.cap}`, true);
    this.set(e.ammo, `${p.mag}<small> / ${p.reserve}</small>`, true);
    this.set(e.reload, p.reloadT > 0 ? 'RECARGANDO…' : p.mag === 0 && p.reserve === 0 ? 'SIN MUNICIÓN' : '');

    this.hitT -= dt;
    e.cross.classList.toggle('hit', this.hitT > 0);
    e.cross.classList.toggle('aim', p.aiming);
    this.hurtA = Math.max(0, this.hurtA - dt * 1.6);
    e.hurt.style.opacity = Math.max(this.hurtA, p.hp < g.maxHp * 0.3 ? 0.35 + Math.sin(g.time * 5) * 0.1 : 0);

    // aviso contextual
    let prompt = '';
    if (g.robTarget) prompt = '';
    else if (g.nearLoot) {
      const L = g.nearLoot;
      prompt = p.weight + L.def.weight > g.cap ? 'Mochila llena: ve a la extracción' : `<kbd>E</kbd> Mantén para robar · ${L.def.name}`;
    } else if (g.inSafe) prompt = '<kbd>E</kbd> Abrir tienda del refugio';
    this.set(e.prompt, prompt, true);

    // barra de progreso: robo o extracción
    if (g.robTarget) {
      this.show('prog', true);
      e.prog.classList.remove('ex');
      this.set(e['prog-label'], 'ROBANDO · ' + g.robTarget.def.name.toUpperCase());
      e['prog-fill'].style.width = (g.robT / g.robTarget.def.time) * 100 + '%';
    } else if (g.extractT > 0) {
      this.show('prog', true);
      e.prog.classList.add('ex');
      this.set(e['prog-label'], 'EXTRAYENDO…');
      e['prog-fill'].style.width = (g.extractT / CFG.EXTRACT_TIME) * 100 + '%';
    } else this.show('prog', false);

    this.show('bust', g.bust > 0.02);
    e['bust-fill'].style.width = g.bust * 100 + '%';

    this.drawMinimap();
  }

  drawMinimap() {
    const g = this.g;
    const c = this.mm;
    const W = 200;
    const R = 95; // metros de radio visibles
    const k = W / 2 / R;
    const p = g.player.pos;
    const tx = (x) => W / 2 + (x - p.x) * k;
    const tz = (z) => W / 2 + (z - p.z) * k;
    c.fillStyle = '#0b0d16';
    c.fillRect(0, 0, W, W);
    c.fillStyle = '#20232e';
    for (const b of g.world.blockRects) c.fillRect(tx(b.minX), tz(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);
    c.fillStyle = '#1d3b28';
    for (const b of g.world.parkRects) c.fillRect(tx(b.minX), tz(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);
    c.fillStyle = '#3a3f52';
    for (const b of g.world.buildingRects) c.fillRect(tx(b.minX), tz(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);

    const clampPt = (x, z) => {
      let dx = (x - p.x) * k;
      let dz = (z - p.z) * k;
      const d = Math.hypot(dx, dz);
      const max = W / 2 - 9;
      const out = d > max;
      if (out) {
        dx *= max / d;
        dz *= max / d;
      }
      return [W / 2 + dx, W / 2 + dz, out];
    };
    // refugio
    {
      const [x, y] = clampPt(g.world.safe.x, g.world.safe.z);
      c.fillStyle = '#22e6ff';
      c.fillRect(x - 5, y - 5, 10, 10);
    }
    // botín
    for (const L of g.world.loot) {
      if (L.robbed) continue;
      const [x, y, out] = clampPt(L.ix, L.iz);
      if (out) continue;
      c.fillStyle = hex(LOOT_TYPES[L.type].color);
      c.beginPath();
      c.arc(x, y, L.type === 'caja' ? 4.5 : 3.5, 0, Math.PI * 2);
      c.fill();
    }
    // extracción
    {
      const ex = g.world.extraction;
      const [x, y] = clampPt(ex.x, ex.z);
      const pulse = 6 + Math.sin(g.time * 5) * 2;
      c.strokeStyle = '#3dffb0';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x, y, pulse, 0, Math.PI * 2);
      c.stroke();
    }
    // policía
    for (const cop of g.cops) {
      if (cop.dead) continue;
      const d = Math.hypot(cop.pos.x - p.x, cop.pos.z - p.z);
      if (g.heat <= 0 && d > 45) continue;
      const [x, y, out] = clampPt(cop.pos.x, cop.pos.z);
      if (out) continue;
      c.fillStyle = cop.state === 'patrol' ? '#5b8cff' : Math.sin(g.time * 12) > 0 ? '#ff4466' : '#5b8cff';
      c.beginPath();
      c.arc(x, y, 3.5, 0, Math.PI * 2);
      c.fill();
    }
    // jugador: flecha hacia donde mira la cámara
    const a = Math.atan2(-Math.cos(g.camYaw), -Math.sin(g.camYaw));
    c.save();
    c.translate(W / 2, W / 2);
    c.rotate(a);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(8, 0);
    c.lineTo(-6, -5.5);
    c.lineTo(-3, 0);
    c.lineTo(-6, 5.5);
    c.closePath();
    c.fill();
    c.restore();
  }

  showPause(on) {
    const g = this.g;
    if (on) {
      const s = g.stats;
      this.set(this.el['pause-stats'], `Robos: ${s.robs} · Extracciones: ${s.extracts} · Mejor botín: ${money(s.best)} · Policías neutralizados: ${s.kills}`);
    }
    this.show('pause', on);
  }

  renderShop() {
    const g = this.g;
    this.set(this.el['shop-bank'], money(g.bank));
    const list = this.el['shop-list'];
    list.innerHTML = '';
    for (const u of UPGRADES) {
      const lvl = g.up[u.id];
      const maxed = lvl >= u.max;
      const cost = g.upgradeCost(u);
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<div class="info"><div class="nm">${u.name}</div><div class="ds">${u.desc}</div><div class="pips">${'■'.repeat(lvl)}${'□'.repeat(u.max - lvl)}</div></div>`;
      const b = document.createElement('button');
      b.textContent = maxed ? 'MÁXIMO' : money(cost);
      b.disabled = maxed || g.bank < cost;
      b.addEventListener('click', () => g.buy(u.id));
      row.appendChild(b);
      list.appendChild(row);
    }
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = `<div class="info"><div class="nm">Munición</div><div class="ds">+${AMMO_PACK.amount} balas (reserva ${g.player.reserve}/${CFG.MAX_RESERVE})</div></div>`;
    const b = document.createElement('button');
    b.textContent = money(AMMO_PACK.cost);
    b.disabled = g.bank < AMMO_PACK.cost || g.player.reserve >= CFG.MAX_RESERVE;
    b.addEventListener('click', () => g.buy('ammo'));
    row.appendChild(b);
    list.appendChild(row);
  }

  showDead(kind, lost) {
    this.set(this.el['dead-title'], kind === 'detenido' ? 'DETENIDO' : 'ABATIDO');
    this.set(this.el['dead-text'], lost > 0 ? `Has perdido el botín que llevabas encima: ${money(lost)}. Lo que ya estaba en el banco sigue a salvo.` : 'No llevabas botín. Lo que está en el banco sigue a salvo.');
    this.show('dead', true);
  }

  showWin() {
    this.set(this.el['win-text'], `Has reunido ${money(this.g.bank)} en el banco. La ciudad sigue ahí: puedes seguir mejorando tu equipo y batir tu mejor botín.`);
    this.show('win', true);
  }
}
