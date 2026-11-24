// Constantes del juego. Cambia aquí los números para equilibrar la dificultad.

export const CFG = {
  // Ciudad: N x N manzanas
  N: 5,
  BLOCK: 44, // lado de cada manzana
  PITCH: 58, // distancia entre centros de manzana (manzana + calle de 14)
  HALF: 152, // mitad del mapa (límite con muro)
  CELL: 2, // tamaño de celda de la rejilla de navegación

  // Jugador
  PLAYER_R: 0.45,
  WALK: 5.2,
  RUN: 8.6,
  BASE_HP: 100,
  BASE_STAMINA: 100,
  BASE_CAP: 6, // capacidad de mochila (peso)
  BASE_DMG: 20,
  MAG: 12,
  START_RESERVE: 60,
  MAX_RESERVE: 120,

  // Policía
  COPS_BASE: 6,
  COPS_PER_STAR: 4,
  COP_HP: 60,
  COP_R: 0.45,

  // Cámara
  CAM_DIST: 5.2,
  SHOULDER: 0.85,
  SENS: 0.0022,

  // Objetivo
  GOAL: 10000,
  EXTRACT_TIME: 4,
  LOOT_RESPAWN: 80,
};

export const LOOT_TYPES = {
  atm: { name: 'Cajero automático', min: 250, max: 450, weight: 1, time: 2.0, heat: 22, color: 0x33ffaa },
  joyeria: { name: 'Joyería', min: 900, max: 1500, weight: 3, time: 3.5, heat: 40, color: 0xffd24a },
  caja: { name: 'Caja fuerte', min: 2000, max: 3200, weight: 5, time: 6.0, heat: 60, color: 0xff4466 },
};

export const UPGRADES = [
  { id: 'bag', name: 'Mochila reforzada', desc: '+2 de capacidad de carga', max: 6, base: 300 },
  { id: 'shoes', name: 'Zapatillas de sprint', desc: '+6% velocidad y +15 de resistencia', max: 5, base: 250 },
  { id: 'vest', name: 'Chaleco antibalas', desc: '+25 de vida máxima', max: 4, base: 400 },
  { id: 'aim', name: 'Entrenamiento de tiro', desc: '+5 de daño y menos dispersión', max: 4, base: 500 },
];
export const AMMO_PACK = { amount: 24, cost: 150 };
