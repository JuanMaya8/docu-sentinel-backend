# docu-sentinel-backend

Backend (NestJS) del proyecto *Motor Inteligente para Detectar Inconsistencias en Documentos*.
Es el segundo repositorio del sistema (junto a `docu-sentinel-frontend` y `docu-sentinel-ai`).

Qué hace:
* **Historial de reportes**: guarda los *resultados* de un análisis (hallazgos, columnas, tiempos) — **nunca el archivo original** — y los sirve con filtros, búsqueda, orden, paginación y exportación a CSV.
* **Líneas base históricas**: recibe una matriz numérica de un archivo histórico, la entrena en `docu-sentinel-ai` y luego puntúa archivos nuevos contra ella.
* **Tiempo real**: avisa por socket.io (`/realtime`) cuando se guarda o borra un reporte o una línea base.
* Si la IA no responde, devuelve `503 AI_UNAVAILABLE` y el frontend cae a su modelo local.

> **Estado: avance funcional (v0.1.0)**, no el proyecto terminado. Lee *Qué está hecho y qué no* y `AI_CONTEXT.md`.

## Cómo ejecutarlo

Requisitos: **Node 18.18+** (recomendado 20). La IA (`docu-sentinel-ai`) es opcional para guardar reportes; es necesaria para las líneas base.

```bash
npm install
cp .env.example .env          # y expórtalo o usa un gestor de .env; las variables están documentadas dentro
npm run start:dev             # http://localhost:3001/api/v1   ·   Swagger: http://localhost:3001/docs
```

| Comando | Qué hace |
|---|---|
| `npm run start:dev` | Desarrollo con recarga |
| `npm run build && npm start` | Producción (`dist/main.js`) |
| `npm test` | **28 pruebas del dominio** (validación, repositorio, líneas base, cliente de IA con HTTP real) con `tsx --test` |
| `npm run test:http` | Pruebas HTTP/WebSocket (supertest + socket.io-client) contra la app real y una IA falsa |
| `npm run typecheck` | `tsc --noEmit` |
| `docker compose up --build` | Backend + IA juntos (espera `../docu-sentinel-ai` junto a este repo) |

> Las variables de `.env.example` se leen de `process.env`. En Node 20.6+ puedes arrancar con `node --env-file=.env dist/main.js`.

Prueba rápida:
```bash
curl localhost:3001/api/v1/health
curl "localhost:3001/api/v1/analyses?limit=5"
```

## Arquitectura

```
src/
├── main.ts · app.factory.ts · app.module.ts · core.module.ts   Arranque y cableado de Nest (prefijo /api/v1, helmet, CORS, Swagger)
├── modules/
│   ├── analyses.controller.ts    /analyses…     historial
│   ├── baselines.controller.ts   /baselines…    líneas base
│   ├── health.controller.ts      /health        estado + ¿la IA responde?
│   └── realtime.gateway.ts       socket.io /realtime
├── http/ api-key.guard.ts · exceptions.filter.ts · dto.ts (solo documentación Swagger)
└── domain/   ← TypeScript puro, sin Nest. Es lo que se prueba con `npm test`
    ├── validation.ts       Validación manual de cada cuerpo (mensajes en español)
    ├── analysis-repository.ts + blob-store.ts   Persistencia (archivos JSON, atómica) tras una interfaz
    ├── analysis-service.ts · baseline-service.ts · ai-client.ts · events.ts · csv.ts · findings-query.ts · summary.ts
    └── errors.ts · labels.ts · types.ts · config.ts
```

Capas: **HTTP (Nest) → servicios de dominio → repositorio/almacén / cliente de IA**. Solo `src/modules`, `src/http` y los archivos de arranque importan Nest; el dominio se prueba sin servidor.

Decisiones:
* **Validación a mano** (no `class-validator`): los mismos mensajes en español, sin decoradores, y se prueba sin Nest. Las clases de `http/dto.ts` existen solo para que Swagger documente los cuerpos.
* **Almacenamiento**: cada reporte son dos archivos JSON (`<id>.detail.json` y `<id>.findings.json`, ordenados por puntaje), escritos de forma atómica; listar no lee los hallazgos. Está detrás de la interfaz `AnalysisRepository`, así que migrar a PostgreSQL es reemplazar **una clase** (ver `AI_CONTEXT.md`).
* **La IA se llama con `fetch`** con tiempo máximo; errores de red, tiempo agotado, 5xx y 401/403 de la IA → `503 AI_UNAVAILABLE`; los 4xx de la IA conservan su `code` y mensaje.
* **Seguridad**: `helmet`, CORS por lista, límite de cuerpo (`BODY_LIMIT_MB`), *throttling* por IP, `X-API-Key` opcional en escrituras (comparación en tiempo constante), claves de almacenamiento a prueba de *path traversal*, y el CSV exportado neutraliza fórmulas (`=`, `+`, `-`, `@`).
* **Privacidad**: la API solo guarda hallazgos con una vista previa del valor (≤ 200 caracteres) y matrices numéricas; el archivo original nunca llega aquí.

## API

El contrato exacto (tipos, parámetros, errores y eventos) está en [`docs/CONTRACT.md`](docs/CONTRACT.md), idéntico en los 3 repos. Resumen (prefijo `/api/v1`):

| Método | Ruta | |
|---|---|---|
| POST | `/analyses` | Guarda un reporte (≤ 100 000 hallazgos) |
| GET | `/analyses?limit&offset` | Lista (más reciente primero) |
| GET | `/analyses/:id` · `/analyses/:id/findings?risk&type&field&q&sort&limit&offset` | Detalle y hallazgos |
| GET | `/analyses/:id/export.csv` | CSV: Registro, Tipo de anomalía, Nivel de riesgo, Campo afectado, Explicación |
| DELETE | `/analyses/:id` | 204 |
| POST/GET/DELETE | `/baselines` · `/baselines/:id` | Líneas base |
| POST | `/baselines/:id/score` | Puntúa filas nuevas (las columnas las pone el backend) |
| GET | `/health` | `{ status, ai: "up"|"down", version }` |

Errores: `{ "statusCode": 400, "code": "VALIDATION_ERROR", "message": "…en español…" }`. Códigos: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `AI_UNAVAILABLE`, `PAYLOAD_TOO_LARGE`, `INVALID_JSON`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR` y los de la IA (`INVALID_TRAINING_DATA`, `SCHEMA_MISMATCH`, …).
Eventos socket.io (namespace `/realtime`): `analysis.saved`, `analysis.deleted`, `baseline.trained`, `baseline.deleted`.

### Patrón de renderizado
No aplica a este repo (es una API). El patrón del sistema —SSG + CSR + SSR por ruta— está en el README de `docu-sentinel-frontend`; este backend sostiene la parte **SSR** (`/reportes`) entregando datos frescos y el aviso en tiempo real.

## Qué está hecho y qué no

| Estado | Elemento |
|---|---|
| ✅ **Verificado** (28 pruebas ejecutadas; `tsc` sin errores en `src/domain` y pruebas; HTTP real contra un servidor local para el cliente de IA) | Todo `src/domain`: validación, historial (memoria y disco, 100 000 hallazgos), filtros/orden/paginación, CSV, líneas base (con IA simulada), errores, configuración |
| ⚠️ **Escrito pero NO ejecutado** (en el entorno de creación el registro de npm estaba bloqueado: no se pudo instalar NestJS) | Capa Nest: `main.ts`, módulos, controladores, guard, filtro, gateway, Swagger, `Dockerfile`, `docker-compose.yml`, y `test/http/app.e2e.test.ts` |
| ⚠️ **Riesgos conocidos al primer arranque** | Swagger infiere tipos con metadatos de decoradores (solo funciona con `nest build`/`tsc`, no con `tsx`); `app.useBodyParser` requiere Nest ≥ 10.2; el contrato con `socket.io-client` del frontend |
| ❌ **No hecho** | PostgreSQL, autenticación de usuarios (hoy solo `X-API-Key`), reentrenar una línea base existente, paginación por cursor, métricas/observabilidad, retención automática de reportes viejos |

## Limitaciones conocidas
* El almacenamiento en archivos es para una sola instancia. Con varias réplicas hay que pasar a una base de datos (la interfaz ya existe).
* Cada reporte se carga completo en memoria al consultarlo (hay una caché de 3); con 100 000 hallazgos son ~25 MB.
* Sin usuarios: todos los reportes son visibles para quien llegue a la API.

## Despliegue (más adelante)
Imagen Docker lista (`Dockerfile`, usuario no-root, volumen `/data`). Variables: `PORT`, `API_KEY`, `AI_URL`, `AI_API_KEY`, `DATA_DIR` (volumen persistente), `CORS_ORIGINS` (dominio del frontend), `BODY_LIMIT_MB`, `THROTTLE_LIMIT`.
Opciones simples: Render, Railway, Fly.io o Cloud Run con un volumen (o migrar a Postgres gestionado). Despliega primero la IA y apunta `AI_URL` a ella.

## Nombre de repositorio sugerido
`docu-sentinel-backend`

```bash
git init -b main && git add . && git commit -m "feat: avance inicial del backend (historial, líneas base, tiempo real)"
git remote add origin git@github.com:<tu-usuario>/docu-sentinel-backend.git && git push -u origin main
```

## Notas para una IA generadora de código
Lee **`AI_CONTEXT.md`** primero: dice qué está terminado, qué falta para el 100 %, convenciones (código en inglés, mensajes al usuario en español), comandos de verificación y trampas conocidas.
