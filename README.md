# OLI - Guia de Instalacion

## Descripcion General

OLI es un sistema de gestion de issues integrado con Mattermost. El backend (Mattermost, AI Service, base de datos) esta hosteado en **Railway**. El usuario solo necesita correr la **app de escritorio** localmente.

| Componente | Donde corre | Descripcion |
|---|---|---|
| **oli-mattermost** | Railway | Servidor Mattermost con el plugin de issues |
| **oli-ai-service** | Railway | Servicio de IA (agentes @oli y @fiona) |
| **agent-orchestrator** | Railway | Dashboard web + CLI para sesiones de agentes de codigo |
| **PostgreSQL** | Railway | Base de datos de Mattermost |
| **App de Escritorio** | Local | Cliente Electron que se conecta al servidor |

---

## Requisitos Previos

Instalar lo siguiente en tu maquina:

- **Node.js** >= 20.0.0 → [nodejs.org](https://nodejs.org/)
- **pnpm** >= 9.15.4 → `npm install -g pnpm`
- **Git** → [git-scm.com](https://git-scm.com/)

---

## Instalacion y Ejecucion

### Paso 1: Instalar dependencias del Agent Orchestrator

El Agent Orchestrator se ejecuta localmente desde la app de escritorio. Necesita estar compilado.

```bash
cd agent-orchestrator-main
pnpm install
pnpm run build
```

### Paso 2: Instalar dependencias de la App de Escritorio

```bash
cd ..
npm install
```

> Esto se ejecuta desde la raiz del proyecto (`OLI/`).

### Paso 3: Compilar y ejecutar la App de Escritorio

```bash
npm run build
npm start
```

### Paso 4: Conectar al servidor

Al abrir la app, agregar el servidor de Mattermost:

- **URL**: `https://oli-mattermost-production.up.railway.app`

Iniciar sesion con tu usuario y contrasena.

---

## Uso

### @oli (chat directo)

Escribir `@oli <mensaje>` en cualquier canal para interactuar con el agente. OLI puede:

- Crear y actualizar issues
- Buscar issues existentes
- Listar proyectos
- Responder preguntas sobre el contexto del proyecto

**Ejemplo:**
```
@oli crear un issue para actualizar la pagina de contactos
@oli dame los ultimos issues
```

### @fiona (monitor de conversaciones)

Fiona monitorea las conversaciones automaticamente. Despues de 2 minutos de inactividad en un canal, analiza la conversacion y puede:

- Crear issues automaticamente a partir de lo discutido
- Actualizar issues existentes con nueva informacion
- Generar resumenes de las conversaciones

No necesita ser invocada manualmente.

### Agent Orchestrator (sesiones de codigo)

Desde la app de escritorio, se pueden crear sesiones de agentes de codigo (Claude Code, etc.) vinculadas a issues. El orquestador:

- Crea worktrees de git por cada issue
- Ejecuta agentes de codigo en sesiones aisladas
- Muestra el progreso en un dashboard web

---

## Estructura del Proyecto

```
OLI/
├── mattermost-plugin-issues/     # Plugin de Mattermost + Dockerfiles
│   ├── server/                   # Backend del plugin (Go)
│   ├── webapp/                   # Frontend del plugin (React)
│   ├── ai-service/               # Servicio de IA (@oli y @fiona)
│   ├── Dockerfile                # Imagen de Mattermost con plugin
│   └── docker-compose.yml        # Stack de desarrollo local
├── agent-orchestrator-main/      # Orquestador de agentes de codigo
│   ├── packages/
│   │   ├── core/                 # Logica central
│   │   ├── cli/                  # CLI (comando `ao`)
│   │   ├── web/                  # Dashboard web (Next.js)
│   │   └── plugins/              # Plugins (agentes, notificadores, etc.)
│   └── Dockerfile                # Imagen del orquestador
└── src/                          # App de escritorio (Electron)
```

---

## Solucion de Problemas

### Error "Cannot find module .../cli/dist/index.js"

El Agent Orchestrator no esta compilado. Ejecutar:

```bash
cd agent-orchestrator-main
pnpm install
pnpm run build
```

### Error "invalid reference: origin/main"

El repositorio local no tiene un remote `origin` configurado o la rama principal se llama diferente. Verificar:

```bash
git remote -v
git branch
```

### La app no se conecta al servidor

- Verificar que la URL del servidor es `https://oli-mattermost-production.up.railway.app`
- Verificar conexion a internet
- Revisar que los servicios en Railway esten con estado **Online**

---

## Para Desarrolladores: Despliegue en Railway

Esta seccion es solo para quienes necesiten actualizar las imagenes Docker en Railway.

### Requisitos adicionales

- **Docker Desktop** → [docker.com](https://www.docker.com/products/docker-desktop/)
- **Una cuenta en Docker Hub** → [hub.docker.com](https://hub.docker.com/)
- **Acceso al proyecto en Railway**

### Actualizar imagenes

```bash
# AI Service
cd mattermost-plugin-issues/ai-service
docker build --no-cache --platform linux/amd64 -t <tu-usuario>/oli-ai-service:latest .
docker push <tu-usuario>/oli-ai-service:latest

# Mattermost + Plugin
cd ..
docker build --no-cache --platform linux/amd64 -t <tu-usuario>/oli-mattermost:latest .
docker push <tu-usuario>/oli-mattermost:latest

# Agent Orchestrator
cd ../../agent-orchestrator-main
docker build --no-cache --platform linux/amd64 -t <tu-usuario>/oli-orchestrator:latest .
docker push <tu-usuario>/oli-orchestrator:latest
```

Luego en Railway: ir al servicio → **Deployments** → click en `...` → **Redeploy**.

> **Tip**: Si Railway no detecta la nueva imagen, cambiar el tag (ej: `v2`, `v3`) y actualizar la referencia en la configuracion del servicio.

### Variables de entorno en Railway

#### Servicio: `oli-mattermost`

| Variable | Valor |
|---|---|
| `MM_SQLSETTINGS_DRIVERNAME` | `postgres` |
| `MM_SQLSETTINGS_DATASOURCE` | `postgresql://<user>:<pass>@postgres.railway.internal:5432/<db>?sslmode=disable` |
| `MM_SERVICESETTINGS_SITEURL` | `https://oli-mattermost-production.up.railway.app` |
| `PORT` | `8065` |

#### Servicio: `oli-ai-service`

| Variable | Valor |
|---|---|
| `PORT` | `3001` |
| `NODE_ENV` | `production` |

#### Servicio: `oli-orchestrator`

| Variable | Valor |
|---|---|
| `PORT` | `3000` |
| `TERMINAL_PORT` | `14800` |
| `DIRECT_TERMINAL_PORT` | `14801` |

### Configuracion del plugin en Mattermost

En **System Console** → **Plugins** → **Issues Tracker**:

| Campo | Valor |
|---|---|
| **AI Service URL** | `http://oli-ai-service.railway.internal:3001` |
| **AI Service Shared Secret** | el secreto elegido (ej: `oli-shared-secret-2026`) |
| **OpenAI API Key** | tu API key de OpenAI |
