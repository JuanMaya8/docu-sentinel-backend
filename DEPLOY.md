# Despliegue: Render (backend + IA + PostgreSQL) y Vercel (frontend)

Orden: **1) Render** (base de datos, IA y backend con un solo Blueprint) → **2) Vercel** (frontend) → **3) CORS**.

```
Navegador ──► Vercel (Next.js) ──► Render: docu-sentinel-backend ──► Render: docu-sentinel-ai
                                         │                                │
                                         └──────────► PostgreSQL ◄────────┘
```

## 1. Render

Requisitos: los repos `docu-sentinel-backend` y `docu-sentinel-ai` en GitHub y una cuenta de Render conectada a GitHub.

1. Render → **New → Blueprint** → elige el repo **docu-sentinel-backend**. Render lee [`render.yaml`](render.yaml) y
   propone 3 recursos: `docu-sentinel-db` (PostgreSQL), `docu-sentinel-ai` y `docu-sentinel-backend`.
2. Te pedirá los valores `sync: false`:
   * `AI_URL`: déjalo con un valor temporal (`https://docu-sentinel-ai.onrender.com`); lo confirmas en el paso 4.
   * `CORS_ORIGINS`: por ahora `http://localhost:3000`; lo cambias en el paso 3 de Vercel.
   * `WEBHOOK_URL`: vacío si no lo usas.
3. **Apply**. La primera construcción tarda unos minutos (las dos imágenes Docker).
4. Abre el servicio **docu-sentinel-ai** y copia su URL pública (p. ej. `https://docu-sentinel-ai-xxxx.onrender.com`).
   En **docu-sentinel-backend → Environment** pon `AI_URL` = esa URL y guarda (se redespliega solo).
5. Comprueba:
   * `https://<backend>.onrender.com/api/v1/health` → `{"status":"ok","ai":"up","auth":true,"store":"postgres",…}`
   * `https://<backend>.onrender.com/docs` → Swagger
   * `https://<ai>.onrender.com/health` → `{"status":"ok","store":"postgres",…}`

Qué configura el Blueprint (puedes cambiarlo en *Environment*):

| Variable | Servicio | Valor | Para qué |
|---|---|---|---|
| `DATABASE_URL` | ambos | de `docu-sentinel-db` | reportes, líneas base, usuarios y modelos en PostgreSQL |
| `AI_API_KEY` | ambos | generado (grupo compartido) | el backend se autentica ante la IA |
| `JWT_SECRET` | backend | generado | activa cuentas de usuario; cada reporte es privado de su dueño |
| `ALLOW_REGISTRATION` | backend | `true` | pon `false` cuando ya hayas creado tus cuentas |
| `RETENTION_DAYS` | backend | `180` | borra reportes viejos |
| `METRICS_TOKEN` | backend | generado | `GET /metrics` con `Authorization: Bearer …` |
| `MODEL_TTL_DAYS` | IA | `180` | borra modelos viejos |

**Plan gratuito**: los servicios se duermen tras ~15 min sin tráfico (la primera petición tarda ~1 min en despertar y el
frontend lo muestra como «backend no disponible» un momento) y la base de datos gratuita **expira a los 30 días**
(Render avisa antes; súbela a un plan de pago o crea otra y cambia `DATABASE_URL`).

### Sin Blueprint (manual)
Crea un PostgreSQL y dos *Web Services* con runtime **Docker** (uno por repo), con *Health Check Path* `/health` (IA) y
`/api/v1/health` (backend), y copia las variables de la tabla. `PORT` lo pone Render.

## 2. Vercel (frontend)

1. Vercel → **Add New → Project** → importa **docu-sentinel-frontend** (framework *Next.js* detectado; ver `vercel.json`).
2. **Environment Variables** (Production y Preview):

   | Variable | Valor |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<backend>.onrender.com/api/v1` |
   | `API_URL` | `https://<backend>.onrender.com/api/v1` |

   `NEXT_PUBLIC_API_URL` se incrusta en el *build*: si la cambias, **redepliega**.
3. **Deploy** y copia el dominio (p. ej. `https://docu-sentinel.vercel.app`).

## 3. CORS (une los dos lados)

En Render → **docu-sentinel-backend → Environment** → `CORS_ORIGINS` = dominio de Vercel. Para aceptar también los
*preview deployments* de Vercel usa un comodín de **una sola etiqueta**:

```
https://docu-sentinel.vercel.app,https://docu-sentinel-*-<tu-equipo>.vercel.app
```

Guarda (redespliega). Abre el sitio, crea tu cuenta en **Ingresar**, analiza un archivo de ejemplo, **Guardar en
historial** y revisa **Reportes** (debe decir «En vivo»).

## Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| «No se pudo conectar con el backend» la primera vez | El servicio gratuito estaba dormido; espera ~1 min y recarga |
| Error de CORS en la consola del navegador | `CORS_ORIGINS` no incluye el dominio exacto de Vercel (con `https://`, sin `/` final) |
| `ai: "down"` en `/api/v1/health` | `AI_URL` mal escrita o la IA aún se está construyendo/despertando |
| `401 AUTH_REQUIRED` | Normal con cuentas activas: inicia sesión en `/ingresar` |
| «Socket» sin «En vivo» | Mismo origen que CORS: revisa `CORS_ORIGINS`; Render soporta WebSocket sin configuración extra |
