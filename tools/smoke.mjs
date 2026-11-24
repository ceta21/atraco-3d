// Prueba de humo: abre el juego en Chrome headless, juega unos segundos
// y falla si aparece algún error en consola. Guarda capturas en SHOTS_DIR.
import { chromium } from 'playwright-core';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOTS_DIR || join(root, 'dist', 'shots');
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(join(root, 'dist/index.html')).href);
await page.waitForTimeout(2500);
await page.screenshot({ path: join(shots, '1-menu.png') });

await page.click('#play');
await page.waitForTimeout(800);
const g = () => page.evaluate(() => {
  const a = window.__atraco;
  return { state: a.state, pos: a.player.pos.toArray().map((v) => +v.toFixed(1)), heat: +a.heat.toFixed(1), cops: a.cops.length, bank: a.bank, value: a.player.value };
});
console.log('inicio', await g());
await page.screenshot({ path: join(shots, '2-start.png') });

// caminar hacia delante
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyW');
console.log('tras andar', await g());

// Lógica determinista: se llama a update() a mano con pasos fijos,
// porque en Chrome headless (swiftshader) los fps son muy bajos.
const sim = (fn) => page.evaluate(fn);
console.log('robo', await sim(() => {
  const a = window.__atraco;
  const L = a.world.loot.find((l) => l.type === 'joyeria');
  a.player.pos.set(L.ix, 0.12, L.iz);
  a.camYaw = Math.atan2(-(L.wx - L.ix), -(L.wz - L.iz)) + Math.PI;
  a.keys.add('KeyE');
  for (let i = 0; i < 80; i++) a.update(0.05);
  a.keys.delete('KeyE');
  a.update(0.05);
  return { value: a.player.value, weight: a.player.weight, heat: +a.heat.toFixed(1), stars: a.stars, robbed: L.robbed };
}));
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, '3-robo.png') });

console.log('persecución', await sim(() => {
  const a = window.__atraco;
  for (let i = 0; i < 300; i++) a.update(0.05);
  const st = {};
  for (const c of a.cops) st[c.state] = (st[c.state] || 0) + 1;
  const near = Math.min(...a.cops.map((c) => Math.hypot(c.pos.x - a.player.pos.x, c.pos.z - a.player.pos.z)));
  return { state: a.state, hp: Math.round(a.player.hp), heat: +a.heat.toFixed(1), cops: a.cops.length, states: st, nearest: +near.toFixed(1) };
}));
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, '4-persecucion.png') });

console.log('disparo', await sim(() => {
  const a = window.__atraco;
  if (a.state !== 'play') a.respawn();
  const c = a.cops.find((c) => !c.dead);
  // colocar al jugador frente a un policía y apuntar
  a.player.pos.set(c.pos.x + 6, c.pos.y, c.pos.z);
  a.camYaw = Math.PI / 2; a.camPitch = 0.05;
  a.updateCamera(0.05);
  const dir = new (a.camera.position.constructor)(c.pos.x - a.camera.position.x, c.pos.y + 1.2 - a.camera.position.y, c.pos.z - a.camera.position.z).normalize();
  a.camera.lookAt(a.camera.position.clone().add(dir));
  a.camera.updateMatrixWorld();
  const hp0 = c.hp;
  a.player.aiming = true;
  a.shoot();
  return { hp0, hp1: c.hp, mag: a.player.mag, heat: +a.heat.toFixed(1) };
}));

console.log('extracción', await sim(() => {
  const a = window.__atraco;
  if (a.state !== 'play') a.respawn();
  a.heat = 0; for (const c of a.cops) c.state = 'patrol';
  a.player.value = 1234; a.player.weight = 3;
  const ex = a.world.extraction;
  for (let i = 0; i < 100; i++) { a.player.pos.set(ex.x, 0, ex.z); a.update(0.05); }
  return { state: a.state, bank: a.bank, value: a.player.value, heat: a.heat };
}));
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, '5-extraccion.png') });

console.log('tienda', await sim(() => {
  const a = window.__atraco;
  if (a.state !== 'play') a.respawn();
  a.bank += 2000;
  a.player.pos.set(a.world.safe.x, 0.12, a.world.safe.z);
  a.update(0.05);
  const inSafe = a.inSafe;
  a.openShop();
  a.buy('bag');
  return { inSafe, cap: a.cap, bank: a.bank, state: a.state };
}));
await page.screenshot({ path: join(shots, '6-tienda.png') });
await sim(() => window.__atraco.closeShop());

const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); };
  requestAnimationFrame(f);
}));
console.log('fps (swiftshader, orientativo):', fps);

await browser.close();
if (errors.length) {
  console.error('ERRORES DE CONSOLA:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK sin errores');
