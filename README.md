# ATRACO · Extracción

Juego 3D de atracos y extracción para el navegador, hecho con Three.js. Roba objetivos en una ciudad nocturna, esquiva a la policía y llega a la zona de extracción antes de que te atrapen.

Inspirado en el género de los crime sandbox de extracción. Proyecto propio, sin assets de terceros.

## Controles

| Acción | Tecla |
| --- | --- |
| Moverse | W A S D |
| Correr | Shift |
| Mirar | Ratón (o flechas) |
| Disparar / apuntar | Clic izquierdo / derecho |
| Recargar | R |
| Robar, abrir tienda | E (mantener para robar) |
| Calidad gráfica | G |
| Pausa | Esc o P |

## Desarrollo

```bash
npm install
npm run build   # genera dist/index.html (un solo archivo)
npm run smoke   # prueba de humo en Chrome headless
```

Abre `dist/index.html` en el navegador. Para publicarlo en Vercel, importa el repositorio: `vercel.json` ya indica el comando de build y la carpeta de salida.

Más contexto de diseño en [CLAUDE.md](CLAUDE.md).
