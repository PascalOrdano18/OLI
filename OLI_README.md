# OLI - Gestion de Proyectos con IA para Mattermost

OLI es una capa de gestion de proyectos potenciada por IA construida sobre Mattermost. Rastrea automaticamente issues a partir de conversaciones del equipo, responde preguntas directas y puede orquestar agentes de IA para trabajar en issues de forma autonoma.

## Arquitectura

El proyecto consta de cuatro componentes:

```
OLI/
├── Desktop App (Electron)           # Cliente de escritorio Mattermost modificado
├── mattermost-plugin-issues/        # Plugin de Mattermost (Go + React)
│   ├── server/                      #   Servidor del plugin en Go
│   ├── webapp/                      #   UI del plugin en React (sidebar derecho)
│   └── ai-service/                  #   Servicio de agentes IA en Node.js
└── agent-orchestrator-main/         # Orquestador de agentes IA (monorepo pnpm)
```

**Como funciona:**

1. **@fiona** (bot de analisis automatico) monitorea todos los canales. Despues de 2 minutos de inactividad, analiza la conversacion y automaticamente crea/actualiza/elimina issues.
2. **@oli** (bot de chat) responde cuando se lo menciona directamente. Puede responder preguntas sobre el codigo, gestionar issues y buscar archivos.
3. **Agent Orchestrator** crea agentes de IA aislados (Claude Code) en git worktrees para implementar issues de forma autonoma.

## Prerequisitos

Instalar lo siguiente antes de comenzar:

| Herramienta | Version | Instalacion |
|-------------|---------|-------------|
| Node.js | 20+ | https://nodejs.org |
| npm | (viene con Node) | |
| pnpm | 9.15.4 | `npm install -g pnpm@9.15.4` |
| Docker | Ultima | https://docker.com |
| Go | 1.22 | https://go.dev (solo para desarrollo local del plugin) |
| tmux | Ultima | `brew install tmux` (macOS) |
| Git | 2.25+ | `brew install git` (macOS) |

## Inicio Rapido (Desarrollo Local)

### Paso 1: Clonar el repositorio

```bash
git clone <repo-url> OLI
cd OLI
```

### Paso 2: Compilar el Agent Orchestrator

```bash
cd agent-orchestrator-main
pnpm install
pnpm run build
cd ..
```

Esto compila el CLI que la app de escritorio usa para crear agentes de IA.

### Paso 3: Iniciar el Servicio de IA

```bash
cd mattermost-plugin-issues/ai-service
npm install
npm run dev
```

Esto inicia el servicio de agentes IA en `http://localhost:3001`. Dejar esta terminal abierta.

### Paso 4: Iniciar Mattermost (Docker)

En una nueva terminal:

```bash
cd mattermost-plugin-issues
docker compose up -d
```

Esto inicia PostgreSQL y Mattermost en `http://localhost:8065`.

### Paso 5: Desplegar el Plugin en Mattermost

En una nueva terminal:

```bash
cd mattermost-plugin-issues
make deploy
```

> **Nota:** Requiere que `MM_ADMIN_TOKEN` este configurado. Obtenerlo desde Mattermost: System Console > Integrations > Bot Accounts, o usando la API.

### Paso 6: Configurar el Plugin

1. Abrir Mattermost en `http://localhost:8065`
2. Ir a **System Console** > **Plugins** > **Issues Tracker**
3. Configurar:
   - **AI Service URL**: `http://host.docker.internal:3001`
   - **AI Service Shared Secret**: cualquier string (ej. `oli-shared-secret-2026`)
   - **OpenAI API Key**: tu clave de OpenAI
4. Hacer click en **Save** y asegurarse de que el plugin este **Enabled**

### Paso 7: Compilar y Ejecutar la App de Escritorio

En una nueva terminal (desde la raiz del proyecto):

```bash
cd /path/to/OLI
npm install
npm run build
npm start
```

Para desarrollo con hot reload:

```bash
npm run watch
```

Conectar la app de escritorio a tu Mattermost local en `http://localhost:8065`.

## Deploy en Railway

Railway hostea tres servicios: Mattermost (con plugin), el servicio de IA y PostgreSQL.

### Servicio 1: PostgreSQL

Agregar una base de datos PostgreSQL desde el dashboard de Railway. Anotar el connection string.

### Servicio 2: Mattermost + Plugin (`oli-mattermost`)

**Compilar y pushear la imagen:**

```bash
cd mattermost-plugin-issues
docker build --platform linux/amd64 -t <usuario-dockerhub>/oli-mattermost:latest .
docker push <usuario-dockerhub>/oli-mattermost:latest
```

**Variables en Railway:**

| Variable | Valor |
|----------|-------|
| `PORT` | `8065` |
| `MM_SQLSETTINGS_DATASOURCE` | `postgresql://postgres:<password>@postgres.railway.internal:5432/railway?sslmode=disable` |
| `MM_SERVICESETTINGS_SITEURL` | Tu URL publica de Railway (ej. `https://oli-mattermost-production-xxxx.up.railway.app`) |

Despues de deployar, configurar el plugin en System Console con:
- **AI Service URL**: `http://oli-ai-service.railway.internal:3001`
- **AI Service Shared Secret**: un string secreto compartido
- **OpenAI API Key**: tu clave

### Servicio 3: Servicio de IA (`oli-ai-service`)

**Compilar y pushear la imagen:**

```bash
cd mattermost-plugin-issues/ai-service
docker build --platform linux/amd64 -t <usuario-dockerhub>/oli-ai-service:latest .
docker push <usuario-dockerhub>/oli-ai-service:latest
```

**Variables en Railway:**

| Variable | Valor |
|----------|-------|
| `PORT` | `3001` |

No se necesitan otras variables. La clave de OpenAI se pasa por request desde el plugin.

### Servicio 4 (Opcional): Dashboard del Agent Orchestrator (`oli-orchestrator`)

**Compilar y pushear la imagen:**

```bash
cd agent-orchestrator-main
docker build --platform linux/amd64 -t <usuario-dockerhub>/oli-orchestrator:latest .
docker push <usuario-dockerhub>/oli-orchestrator:latest
```

**Variables en Railway:**

| Variable | Valor |
|----------|-------|
| `PORT` | `3000` |
| `TERMINAL_PORT` | `14800` |
| `DIRECT_TERMINAL_PORT` | `14801` |
| `NEXT_PUBLIC_TERMINAL_PORT` | `14800` |
| `NEXT_PUBLIC_DIRECT_TERMINAL_PORT` | `14801` |

### Actualizar Imagenes Deployadas

Para actualizar cualquier servicio despues de cambios en el codigo:

```bash
# Recompilar y pushear
docker build --no-cache --platform linux/amd64 -t <usuario-dockerhub>/<nombre-imagen>:latest .
docker push <usuario-dockerhub>/<nombre-imagen>:latest
```

Luego en Railway: ir al servicio > pestaña **Deployments** > click en `...` del ultimo deployment > **Redeploy**.

Si Railway no detecta la nueva imagen, pushear con un tag nuevo:

```bash
docker build --platform linux/amd64 -t <usuario-dockerhub>/<nombre-imagen>:v2 .
docker push <usuario-dockerhub>/<nombre-imagen>:v2
```

Luego actualizar la referencia de imagen en la configuracion del servicio en Railway.

## App de Escritorio + Agent Orchestrator

La app de escritorio integra el agent orchestrator de forma local. Cuando se hace click en "Start Agent" en un issue de la UI del plugin:

1. Crea una sesion tmux con un agente de IA (Claude Code)
2. Crea un git worktree aislado para el issue
3. Envia el contexto del issue al agente
4. Transmite la salida de la terminal de vuelta a la app de escritorio

**Requisitos para esta funcionalidad:**
- `tmux` debe estar instalado localmente
- El agent orchestrator debe estar compilado (`cd agent-orchestrator-main && pnpm install && pnpm run build`)
- Un repositorio git local debe estar vinculado al proyecto mediante el selector de carpetas en la UI

## Estructura del Proyecto

### App de Escritorio (`src/`)

Cliente de escritorio Mattermost modificado con:
- `src/main/aoManager.ts` — Integracion con el agent orchestrator (crea agentes, transmite output)
- `src/renderer/` — UI React para la interfaz del escritorio
- `src/common/communication.ts` — Definiciones de canales IPC

### Plugin (`mattermost-plugin-issues/`)

- `server/plugin.go` — Entry point del plugin, creacion de bots, hooks de mensajes
- `server/conversation_monitor.go` — Rastrea conversaciones, activa @fiona despues de inactividad
- `server/ai_client.go` — Cliente HTTP hacia el servicio de IA
- `server/config.go` — Configuracion del plugin (AIServiceURL, Secret, clave OpenAI)
- `webapp/` — Sidebar derecho en React para gestion de issues

### Servicio de IA (`mattermost-plugin-issues/ai-service/`)

- `src/index.ts` — Servidor Express con endpoints `/analyze`, `/chat`, `/transcribe-and-analyze`
- `src/agent.ts` — Agente @fiona (analisis de conversaciones, CRUD de issues)
- `src/oli-agent.ts` — Agente @oli (respuestas de chat, busqueda de codigo, gestion de issues)
- `src/oli-tools.ts` — Herramientas: busqueda de archivos, listado de directorios, info de la empresa
- `src/shared-tools.ts` — Herramientas compartidas: CRUD de issues, listado de proyectos
- `src/plugin-client.ts` — Cliente HTTP para la API de callback del plugin

### Agent Orchestrator (`agent-orchestrator-main/`)

- `packages/core` — Tipos, configuracion, gestion de sesiones
- `packages/web` — Dashboard Next.js (puerto 3000)
- `packages/cli` — Comandos CLI (`ao spawn`, `ao send`, `ao session`)
- `packages/plugins/` — Agentes, runtimes, SCM, trackers y notificadores pluggables

## Solucion de Problemas

### "Cannot find module .../cli/dist/index.js"

El agent orchestrator no esta compilado. Ejecutar:

```bash
cd agent-orchestrator-main
pnpm install && pnpm run build
```

### @oli no responde (404 en los logs)

La imagen del servicio de IA esta desactualizada o no tiene la ruta `/chat`. Recompilar y pushear:

```bash
cd mattermost-plugin-issues/ai-service
docker build --no-cache --platform linux/amd64 -t <usuario-dockerhub>/oli-ai-service:latest .
docker push <usuario-dockerhub>/oli-ai-service:latest
```

Luego re-deployar en Railway.

### Menciones de @oli detectadas pero sin respuesta

Revisar los logs de Mattermost buscando `[Oli] checking mention`. Si `contains_oli=false`, Mattermost puede estar codificando la mencion de forma diferente. Asegurarse de que el usuario bot `oli` exista (System Console > Bot Accounts).

### El plugin no carga

- Asegurarse de que `MM_PLUGINSETTINGS_ENABLEUPLOADS=true` este configurado
- Verificar que System Console > Plugins > Issues Tracker este habilitado
- Revisar los logs de Mattermost por errores de activacion del plugin

### La imagen de Railway no se actualiza

Pushear con un tag unico en lugar de `:latest`:

```bash
docker build --platform linux/amd64 -t <usuario-dockerhub>/<imagen>:v2 .
docker push <usuario-dockerhub>/<imagen>:v2
```

Actualizar la referencia de imagen en la configuracion del servicio en Railway.
