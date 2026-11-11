# Despliegue: Neon (PostgreSQL) + Render (backend + IA) + Vercel (frontend)

Orden: **1) Neon** (base de datos) → **2) Render** (IA y backend con un solo Blueprint) → **3) Vercel** (frontend)
→ **4) CORS**.

```
Navegador ──► Vercel (Next.js) ──► Render: docu-sentinel-backend ──► Render: docu-sentinel-ai
                                         │                                │
                                         └──────────► Neon (PostgreSQL) ◄─┘
```

## 1. Neon (base de datos)

1. Neon → **New Project**. Nombre `docu-sentinel`, PostgreSQL 16 o 17 y región **AWS US West 2 (Oregon)**, la
   misma región de Render, para que las consultas sean rápidas.
2. En el panel del proyecto → **Connect** copia la *connection string*. Tiene esta forma:
   `postgresql://usuario:clave@ep-xxxx-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
   Sirve la versión con *pooler* (la que Neon muestra por defecto) o la directa.
3. No hay que crear tablas: al arrancar, el backend crea `ds_analyses`, `ds_findings` y `ds_kv`, y la IA crea
   `ds_ai_models`. Las dos apps comparten la misma base de datos con tablas distintas.

`?sslmode=require` activa SSL solo; **no** hace falta `DATABASE_SSL`. Neon suspende la base tras unos minutos sin uso
y la despierta sola con la siguiente consulta (tarda menos de un segundo).

## 2. Render (IA + backend)

Requisitos: los repos `docu-sentinel-backend` y `docu-sentinel-ai` en GitHub y una cuenta de Render conectada a GitHub.

1. Render → **New → Blueprint** → elige el repo **docu-sentinel-backend**. Render lee [`render.yaml`](render.yaml) y
   propone 2 servicios: `docu-sentinel-ai` y `docu-sentinel-backend`.
2. Te pedirá los valores `sync: false`:
   * `DATABASE_URL` (en **los dos** servicios): la connection string de Neon del paso 1.
   * `AI_URL`: déjalo con un valor temporal (`https://docu-sentinel-ai.onrender.com`); lo confirmas en el paso 4.
   * `CORS_ORIGINS`: por ahora `http://localhost:3000`; lo cambias en el paso 4 (CORS).
   * `WEBHOOK_URL`: vacío si no lo usas.
3. **Apply**. La primera construcción tarda unos minutos (las dos imágenes Docker).
4. Abre el servicio **docu-sentinel-ai** y copia su URL pública (p. ej. `https://docu-sentinel-ai-xxxx.onrender.com`).
   En **docu-sentinel-backend → Environment** pon `AI_URL` = esa URL y guarda (se redespliega solo).
5. Comprueba:
   * `https://<backend>.onrender.com/api/v1/health` → `{"status":"ok","ai":"up","auth":true,"store":"postgres",…}`
   * `https://<backend>.onrender.com/docs` → Swagger
   * `https://<ai>.onrender.com/health` → `{"status":"ok","store":"postgres",…}`
   * En Neon → **Tables** aparecen las tablas `ds_*`.

Qué configura el Blueprint (puedes cambiarlo en *Environment*):

| Variable | Servicio | Valor | Para qué |
|---|---|---|---|
| `DATABASE_URL` | ambos | connection string de Neon | reportes, líneas base, usuarios y modelos en PostgreSQL |
| `AI_API_KEY` | ambos | generado (grupo compartido) | el backend se autentica ante la IA |
| `JWT_SECRET` | backend | generado | activa cuentas de usuario; cada reporte es privado de su dueño |
| `ALLOW_REGISTRATION` | backend | `true` | pon `false` cuando ya hayas creado tus cuentas |
| `RETENTION_DAYS` | backend | `180` | borra reportes viejos |
| `METRICS_TOKEN` | backend | generado | `GET /metrics` con `Authorization: Bearer …` |
| `MODEL_TTL_DAYS` | IA | `180` | borra modelos viejos |

**Plan gratuito**: los servicios de Render se duermen tras ~15 min sin tráfico (la primera petición tarda ~1 min en
despertar y el frontend lo muestra como «backend no disponible» un momento). La base gratuita de Neon no expira
(0,5 GB, de sobra para este proyecto).

### Sin Blueprint (manual)
Crea dos *Web Services* con runtime **Docker** (uno por repo), con *Health Check Path* `/health` (IA) y
`/api/v1/health` (backend), y copia las variables de la tabla. `AI_API_KEY` debe tener el mismo valor en ambos
servicios (cualquier texto largo y aleatorio); `JWT_SECRET` también debe ser un texto aleatorio. `PORT` lo pone Render.

## 3. Vercel (frontend)

1. Vercel → **Add New → Project** → importa **docu-sentinel-frontend** (framework *Next.js* detectado; ver `vercel.json`).
2. **Environment Variables** (Production y Preview):

   | Variable | Valor |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<backend>.onrender.com/api/v1` |
   | `API_URL` | `https://<backend>.onrender.com/api/v1` |

   `NEXT_PUBLIC_API_URL` se incrusta en el *build*: si la cambias, **redepliega**.
3. **Deploy** y copia el dominio (p. ej. `https://docu-sentinel.vercel.app`).

## 4. CORS (une los dos lados)

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
| Error de conexión a PostgreSQL en los logs | `DATABASE_URL` incompleta: copia la de Neon entera, con `?sslmode=require` |
| `401 AUTH_REQUIRED` | Normal con cuentas activas: inicia sesión en `/ingresar` |
| «Socket» sin «En vivo» | Mismo origen que CORS: revisa `CORS_ORIGINS`; Render soporta WebSocket sin configuración extra |
