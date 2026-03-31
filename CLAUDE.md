# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OLI is an AI-powered issue management system built as a fork of the Mattermost Desktop app (Electron). It integrates three components:

1. **Desktop App** (this repo root) — Mattermost Desktop fork with an embedded Issues view and Agent Orchestrator UI
2. **Agent Orchestrator** (`agent-orchestrator-main/`) — Spawns parallel AI coding agents in isolated git worktrees to work on issues autonomously
3. **Mattermost Plugin** (`mattermost-plugin-issues/`) — Server-side issue tracker plugin with an AI service (`@oli` bot) for conversation analysis and issue management

The production Mattermost server is at `https://oli-mattermost-production.up.railway.app`.

## Architecture

### Desktop App (Electron)

Standard Mattermost Desktop Electron process model:

- **Main process**: `src/main/` (OS-level), `src/app/` (windows/tabs/modals), `src/common/` (shared). Entry: `src/main/app/index.ts` → `initialize()`.
- **Renderer**: `src/renderer/` — React UI. Each window/modal is a separate webpack entry.
- **Preload scripts**: `src/app/preload/internalAPI.js` → `window.desktop`, `externalAPI.ts` → `window.desktopAPI`.
- **IPC channels**: Defined in `src/common/communication.ts`, handlers registered in `src/main/app/initialize.ts` or module constructors.

### OLI-Specific Additions

- **View mode switching**: `MainPage` has `activeMode` state (`'strategy'` | `'issues'`). Controlled via `SET_VIEW_MODE` IPC channel. `BasePage` conditionally renders the IssuesView when mode is `'issues'`.
- **IssuesView** (`src/renderer/components/IssuesView/`): Full issue tracker UI with projects, status/priority views, inline create/edit modals. Communicates with the plugin API via `window.desktop.issuesApiRequest()`.
- **Agent Orchestrator Manager** (`src/main/aoManager.ts`): Manages tmux sessions, pipes, and session state. Exposed to renderer via `window.desktop.ao.*` preload API (spawn sessions, send messages, get git status/diffs, kill sessions).
- **IPC channels**: `ISSUES_API_REQUEST`, `NAVIGATE_TO_ISSUE`, `AO_*` constants for orchestrator session management.

### Agent Orchestrator (`agent-orchestrator-main/`)

pnpm monorepo with packages: `ao`, `cli`, `core`, `web`, `mobile`, `plugins`, `integration-tests`. Orchestrates AI coding agents (Claude Code, Codex, etc.) in isolated git worktrees per issue.

### Mattermost Plugin (`mattermost-plugin-issues/`)

- **Server** (Go): Issue tracker plugin with projects, labels, cycles, priorities. Responds to `@oli` mentions.
- **AI Service** (`ai-service/`): Express server with endpoints — `/analyze` (conversation analysis via OpenAI), `/chat` (Oli agent using Claude with tool use), `/transcribe-and-analyze` (Whisper audio transcription).
- **Webapp** (`webapp/`): React sidebar integration for the Mattermost web app.

## Development Commands

### Desktop App

| Command | Description |
|---|---|
| `npm install` | Install dependencies (runs patch-package + electron-builder) |
| `npm run build` | Development build (main + preload + renderer in parallel) |
| `npm start` | Run the built app |
| `npm run watch` | Dev mode with auto-rebuild and Electron restart |
| `npm run restart` | Build then start |
| `npm run check` | Lint + type check + unit tests in parallel |
| `npm run lint:js` | ESLint |
| `npm run fix:js` | ESLint with auto-fix |
| `npm run check-types` | TypeScript type checking |
| `npm test:unit` | Jest unit tests |
| `npx jest path/to/file.test.ts` | Run a single test file |
| `npm run e2e` | Build test bundle and run Playwright E2E tests |

### Agent Orchestrator

```bash
cd agent-orchestrator-main
pnpm install
pnpm run build        # build all packages
pnpm run dev          # dev mode (web dashboard)
pnpm run test         # run tests
pnpm run typecheck    # TypeScript type checking
pnpm run lint         # ESLint
```

### Mattermost Plugin

```bash
cd mattermost-plugin-issues
make                  # build plugin (Go server + React webapp)
```

## Build System

### Webpack (Desktop App)

Three configs merging from `webpack.config.base.js`:

- `webpack.config.main.js` — `electron-main` target, entry: `src/main/app/index.ts`
- `webpack.config.preload.js` — `electron-preload` target, entries: `internalAPI.js`, `externalAPI.ts`
- `webpack.config.renderer.js` — `web` target, multiple entries (one per UI surface)

**Path aliases** (configured in webpack + `tsconfig.json`, `baseUrl: ./src`): `renderer`, `main`, `app`, `common`, `assets`. Use as: `import Config from 'common/config';`.

**Compile-time constants** via `DefinePlugin`: `__IS_MAC_APP_STORE__`, `__IS_NIGHTLY_BUILD__`, `__HASH_VERSION__`, `__DISABLE_GPU__`, `__SKIP_ONBOARDING_SCREENS__`, `__SENTRY_DSN__`. Available as bare globals. When adding a new one, also add it to `jest.globals` in `package.json`.

## Code Conventions

### File Header

Every source file must start with:
```
// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
```

### Imports

ES module `import`/`export` only, never `require()`. Order enforced by ESLint: builtins → external → `@mattermost/*` → internal aliases → `types` → siblings/parent.

### Singletons

Main-process modules: export the class (for tests) + create a single instance + default-export it. Import with PascalCase: `import ServerManager from 'common/servers/serverManager';`.

### IPC Pattern

1. Define channel in `src/common/communication.ts`
2. Register handler in `src/main/app/initialize.ts` or module constructor
3. `handle`/`invoke` for request/response, `on`/`send` for fire-and-forget
4. Expose to renderer via appropriate preload script

## Testing

- **Unit tests**: Jest, co-located as `*.test.js` / `*.test.ts`. Mock singletons with `jest.mock()` using `__esModule: true` + `default`. Use `jest.mocked()` for type safety.
- **E2E tests**: Playwright in `e2e/` (separate `package.json`).
- **Test globals**: Must match `jest.globals` in `package.json`.

## Setup (First Run)

```bash
# 1. Build agent orchestrator
cd agent-orchestrator-main && pnpm install && pnpm run build && cd ..

# 2. Build and run desktop app
npm install && npm run build && npm start
```

Connect to `https://oli-mattermost-production.up.railway.app`, login with `guest`/`computersociety`, select team **low cortisol**.
