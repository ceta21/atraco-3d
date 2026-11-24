# ATRACO · Extracción — contexto del proyecto

Juego 3D en el navegador (Three.js), de un jugador, en tercera persona. Está **inspirado en el género** del extraction-crime sandbox "ROB RUN" (Kefir, acceso anticipado desde el 4 nov 2026): robar, vender y salir con vida mientras la policía te persigue. **No copiamos** su nombre, mapa, arte ni marca; todo aquí es propio.

El proyecto nació en una conversación de Claude.ai y se continúa aquí en Claude Code. Este archivo recoge lo decidido para no perder contexto.

## Objetivo del proyecto

- Pieza de portfolio: se publica en Vercel y se comparte en LinkedIn, así que tiene que cargar rápido y verse llamativa (de ahí el 3D, el estilo neón nocturno y el bloom).
- Una persona al teclado y ratón (PC). Sin móvil por ahora.
- El multijugador masivo del juego original (miles de jugadores) queda **fuera de alcance**. La policía y las bandas las controla la IA.

## Stack y estructura

- Three.js (v0.187) + esbuild. Sin framework. JavaScript moderno en módulos ES.
- `npm run build` genera `dist/index.html`: **un único HTML autocontenido** con todo el JS inlined (así también se puede publicar como página suelta). Vercel usa `vercel.json` (`npm run build` → `dist`).
- `npm run smoke` abre el juego en Chrome headless (playwright-core, `/usr/bin/google-chrome`) y falla si hay errores de consola.

```
index.template.html   plantilla con CSS y HUD (el build inyecta el JS)
src/config.js         constantes de equilibrio, tipos de botín, mejoras
src/util.js           matemáticas, rayo-caja, rayo-cilindro
src/audio.js          efectos con WebAudio (sin archivos de audio)
src/world.js          ciudad procedural, colliders, botín, rejilla de navegación
src/actors.js         modelos humanoides y la IA de la policía
src/ui.js             HUD, minimapa, tienda
src/main.js           bucle principal y reglas del juego
tools/build.mjs       empaquetado
tools/smoke.mjs       prueba de humo
```

## Diseño del juego

**Bucle:** salir del escondite (safehouse) → robar objetivos marcados (cajero, joyería, caja fuerte) → la policía reacciona → llegar a la zona de extracción activa → el botín pasa al banco → comprar mejoras → repetir. Si te abaten o te arrestan en la calle, pierdes el contenido de la mochila (el dinero ya ingresado se conserva).

**Reglas clave**
- *Calor (heat) 0–100*, mostrado como 0–4 estrellas. Robar sube el calor; que un policía te vea robar sube más. Disparar y matar policías también. Baja si nadie te ve durante unos segundos, o más rápido en el safehouse.
- Con calor 0 la policía solo patrulla. Con calor > 0 responde y persigue; refuerzos según estrellas (`COPS_BASE + estrellas * COPS_PER_STAR`).
- *Mochila con peso:* cada objetivo pesa (cajero 1, joyería 3, caja fuerte 5). Capacidad base 6, mejorable. Cargar peso ralentiza un poco.
- *Extracción:* una sola zona activa a la vez, se reubica tras cada extracción. Hay que aguantar 4 s dentro.
- *Pistola:* hitscan desde el centro de la cámara, 12 balas por cargador, headshot x2.
- *Tienda* (tecla E en el safehouse): mochila, zapatillas, chaleco, entrenamiento de tiro y munición. Progreso en `localStorage` (siempre con try/catch).
- Meta simbólica: $10.000 ingresados.

**IA de la policía (sin navmesh):** la ciudad se discretiza en una rejilla de 2 m. Se precalcula un campo de distancias (BFS) hacia cada uno de los 36 cruces para patrullar, y uno dinámico hacia el último punto donde la policía vio al jugador. Cada policía baja por el gradiente del campo. Con línea de visión, persigue directo y dispara. Estados: `patrol`, `respond`, `chase`.

**Cámara:** tercera persona sobre el hombro derecho, bloqueo de puntero. Convención de ángulos: `yaw` 0 mira hacia −Z; el delantero horizontal es `(-sin yaw, -cos yaw)`. Si el bloqueo de puntero falla (p. ej. dentro de un iframe), se puede girar con las flechas.

## Decisiones y restricciones

- Todo en español: textos de interfaz y comentarios.
- Sin assets externos: modelos con cajas, texturas de ventanas generadas con canvas, sonido sintetizado. Así el build es un solo archivo.
- Calidad: bloom y sombras se pueden desactivar con la tecla G (equipos modestos).
- Nada de librerías de red ni servidor. Si algún día hay multijugador pequeño (2–8 jugadores), irá en un servidor aparte.

## Estado y siguientes pasos

Primer prototipo en construcción. Ideas ya pensadas, por orden:
1. Coches de policía y helicóptero en 4 estrellas.
2. Más tipos de botín y un banco con cámara acorazada.
3. Bandas rivales controladas por IA y territorios.
4. Varios mapas o semilla de ciudad con selector.
5. Multijugador pequeño (WebSocket) como último paso.
