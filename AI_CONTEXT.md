# AI_CONTEXT — docu-sentinel-backend

> Para la IA generadora de código que continuará este repo. Lee `README.md` y `docs/CONTRACT.md` (idéntico en los 3 repos: frontend `docu-sentinel-frontend`, este, y `docu-sentinel-ai`).
> Reglas: **código, identificadores y commits en inglés; mensajes que ve el usuario (errores, CSV) en español**.

## 0. Actualización (v0.2.0) — leer primero

Todo lo marcado como «NO ejecutado» abajo **ya se ejecutó y funciona** en Windows (Node 22):
`npm run typecheck` limpio · `npm test` → 32 OK · `npm run test:http` → 8 OK · `npm run build` OK · Swagger 200 en `/docs`.
Integración real verificada con `docu-sentinel-ai` (uvicorn) y E2E con el frontend (`npm run test:e2e` allí).

Nuevo en v0.2.0:
* `thresholdFloor` (0.5–0.99) en `POST /baselines` → se envía a la IA como `threshold_floor` y se guarda en `BaselineDto`.
* `schemaSignature` opcional en `POST /baselines/:id/score`; si no coincide con la de la línea base →
  `422 SCHEMA_MISMATCH` (`SchemaMismatchError`) **sin** llamar a la IA.
* Retención: `RETENTION_DAYS` / `RETENTION_INTERVAL_MS` → `AnalysisService.purgeOlderThan` (dominio, probado) +
  `modules/retention.scheduler.ts` (temporizador, sin `@nestjs/schedule`). Repositorio: `idsCreatedBefore(cutoff)`.
* `http/request-id.middleware.ts`: `X-Request-ID` (reutiliza uno seguro o crea uno) + una línea JSON por petición
  (`buildApp(config, { logRequests:false })` en pruebas).
* Tipos de la IA: `AiContribution.kind` admite `'coherence'` con `expected`.

## 1. Dónde quedó el trabajo (histórico v0.1 — ≈ 75 % del repo)

| Área | Estado | Cómo se comprobó |
|---|---|---|
| `src/domain/**` (validación, repositorio, servicios, cliente de IA, CSV, eventos, config) | **Hecho y probado** | `npm test` → 28 pruebas; `tsc` limpio |
| Capa Nest (`src/modules`, `src/http`, `main.ts`, `app.*.ts`, `core.module.ts`) | **Escrito, NO ejecutado** | El registro de npm estaba bloqueado: Nest no se pudo instalar. Solo se comprobó que el dominio que usa tipa bien (contra *stubs*) |
| `test/http/app.e2e.test.ts` (supertest + socket.io-client + IA falsa) | **Escrito, NO ejecutado** | — |
| `Dockerfile`, `docker-compose.yml`, CI | **Escrito, NO ejecutado** | — |

### Primeras cosas que hacer (en este orden)
1. `npm install && npm run typecheck && npm test` (debe quedar en verde; corrige primero tipos reales de Nest/Express).
2. `npm run build` y `npm start`; abrir `http://localhost:3001/docs` (si Swagger falla al inferir tipos, añade `type:` explícito en los `@ApiProperty` de `src/http/dto.ts`).
3. `npm run test:http`. **Qué vigilar**: (a) `tsx` no emite metadatos de decoradores → por eso todos los `constructor` usan `@Inject(TOKENS.X)` explícito; no los quites; (b) `buildApp(config, { swagger:false })` en las pruebas; (c) si `app.useBodyParser` no existe en tu versión de Nest, usa `NestFactory.create(..., { bodyParser:false })` + `app.use(json({ limit }))`.
4. `docker compose up --build` con `../docu-sentinel-ai` presente; crear una línea base real desde el frontend y puntuar con ella.
5. Probar con el frontend: `NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1`; guardar un reporte, ver `/reportes` y el chip «En vivo».

## 2. Qué falta para llegar al 100 %

**Prioridad alta**
* [x] Ejecutar y corregir lo no verificado (sección 1).
* [ ] **PostgreSQL**: implementar `AnalysisRepository` (y un `BaselineStore`) con tablas `analyses`, `findings` (índices por `analysis_id`, `risk`, `type`, `record_index`), y elegirla por variable `DATABASE_URL`. La interfaz y las pruebas de contrato ya existen: reutiliza `test/repository.test.ts` parametrizando el repositorio. Los filtros hoy se hacen en memoria (`queryFindings`): pasarlos a SQL.
* [ ] **Autenticación y propiedad** de reportes (JWT/sesión; cada reporte con `ownerId`). Hoy solo `X-API-Key` global; `NEXT_PUBLIC_API_KEY` en el frontend queda expuesta en el navegador.
* [x] **Paridad con la IA**: `thresholdFloor` en `CreateBaselineDto`/`AiClient.train` y `docs/CONTRACT.md` (3 repos).

**Prioridad media**
* [ ] Reentrenar/actualizar una línea base (hoy se crea otra) y versionarlas.
* [x] Retención: borrar reportes con más de N días (`RETENTION_DAYS`).
* [x] Validar compatibilidad de esquema al puntuar (`schemaSignature`) → `SCHEMA_MISMATCH` antes de llamar a la IA.
* [x] *Request id* en logs, logs JSON. — [ ] Métricas (`/metrics` Prometheus).
* [ ] Compresión de respuestas grandes (`compression`) y `ETag` en listados.

**Prioridad baja**
* [ ] Paginación por cursor; exportación a JSON/XLSX además de CSV.
* [ ] Webhooks cuando un reporte tenga hallazgos críticos.

## 3. Invariantes que no se deben romper
1. `src/domain` **no importa Nest ni Express**. Toda regla de negocio nueva va ahí, con prueba en `test/*.test.ts`.
2. **Solo se guardan resultados**, nunca el archivo original ni textos completos: `value` ≤ 200 caracteres, `matrix` solo numérica.
3. Cuerpos de entrada: validar siempre con `validation.ts`; los controladores reciben `@Body() body: unknown`.
4. Errores de salida con forma `{ statusCode, code, message }` y **mensaje en español**; los errores de IA caída son `503 AI_UNAVAILABLE` (el frontend depende de ese código para caer al modelo local).
5. Cambios en tipos/rutas/eventos ⇒ actualizar `docs/CONTRACT.md` en los **3 repos** y los tipos del frontend (`src/lib/api.ts`).
6. El CSV exportado mantiene BOM UTF-8 y las 5 columnas en este orden: Registro, Tipo de anomalía, Nivel de riesgo, Campo afectado, Explicación; y la neutralización de fórmulas.

## 4. Mapa rápido
* `domain/analysis-repository.ts` — `BlobAnalysisRepository` (índice en memoria al arrancar + dos blobs por reporte).
* `domain/baseline-service.ts` — crea (entrena en la IA, guarda metadatos; si falla el guardado borra el modelo huérfano), puntúa, borra (IA en *best effort*); escrituras serializadas con una cadena de promesas.
* `domain/ai-client.ts` — traduce fallos de la IA a `AiUnavailableError`/`DomainError`.
* `modules/realtime.gateway.ts` — reenvía los eventos del `EventBus` a socket.io.
* `test/helpers.ts` — `FakeAi` (misma interfaz que la IA real) y fábricas de datos.

## 5. Comandos
```bash
npm run typecheck
npm test               # dominio, ~1 s
npm run test:http      # Nest real + supertest + socket.io
docker compose up --build
```

## 6. Trampas conocidas
* `tsx --test` no emite `emitDecoratorMetadata`: las pruebas HTTP deben desactivar Swagger y todo `@Inject` debe ser explícito.
* `ThrottlerModule` v6 usa un arreglo en `forRoot([...])` (no el objeto de v5).
* El nombre del archivo exportado se sanea (`[^\w.-]` → `_`); si el nombre original es solo símbolos queda `_`.
* `BlobAnalysisRepository` carga el índice una vez al primer uso; si editas archivos a mano con el servidor encendido no se enterará.
