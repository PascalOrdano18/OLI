# OLI - Guia de Instalacion

## Descripcion General

OLI es un sistema de gestion de issues integrado con Mattermost. El usuario solo necesita correr la **app de escritorio** localmente.

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

### Paso 4: Conectar al servidor y hacer onboarding

Al abrir la app por primera vez, se mostrara la pantalla de onboarding.

1. **Agregar servidor**: Ingresar la URL del servidor de Mattermost si es requerida, de lo contrario proseguir:
   - **URL**: `https://oli-mattermost-production.up.railway.app`

2. **Iniciar sesion**: Usar una de las cuentas de invitado:

   | Usuario | Contrasena |
   |---|---|
   | `guest` | `computersociety` |
   | `guest2` | `computersociety` |

3. **Seleccionar equipo**: Cuando se muestre la lista de equipos, elegir **low cortisol**.

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

### Agent Orchestrator (sesiones de codigo)

Desde la app de escritorio, se pueden crear sesiones de agentes de codigo (Claude Code, etc.) vinculadas a issues. El orquestador:

- Crea worktrees de git por cada issue
- Ejecuta agentes de codigo en sesiones aisladas
- Muestra el progreso en un dashboard web

> **Importante**: Para que el Agent Orchestrator pueda realizar cambios exitosamente en un proyecto, es necesario que el proyecto tenga un repositorio **git** inicializado con un remote `origin` configurado. Sin esto, el orquestador no podra crear worktrees ni branches para las sesiones de codigo. Si se genera un error, la branch sobre la cual este trabajando el agent debe llamarse master.

---
