# Force Organization Selection on Startup & Hide Server UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Always show the OrganizationList page on app startup (even when a server already exists), hide all server-related UI, and add a "Change organization" button that replaces server controls.

**Architecture:** Modify the startup flow in `intercom.ts` to always show the welcome screen modal (which renders OrganizationList). Change the modal's `onConnect` handler to replace the existing server instead of adding a new one. Replace the server dropdown and its button with a simple "Change organization" button. Hide server management from settings.

**Tech Stack:** Electron, React, TypeScript, IPC

---

### Task 1: Always show OrganizationList on startup

**Files:**
- Modify: `src/main/app/intercom.ts:69-93`

- [ ] **Step 1: Modify `handleMainWindowIsShown` to always show the welcome screen**

Change the logic so `showWelcomeScreen` is always `true` (unless `__SKIP_ONBOARDING_SCREENS__` is set), regardless of whether servers exist. Also make the modal closeable when servers already exist.

```typescript
export function handleMainWindowIsShown() {
    // eslint-disable-next-line no-undef
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const showWelcomeScreen = () => !Boolean(__SKIP_ONBOARDING_SCREENS__);
    const showNewServerModal = () => !ServerManager.hasServers();

    const mainWindow = MainWindow.get();

    log.debug('handleMainWindowIsShown', {showWelcomeScreen, showNewServerModal, mainWindow: Boolean(mainWindow)});
    if (mainWindow?.isVisible()) {
        handleShowOnboardingScreens(showWelcomeScreen(), showNewServerModal(), true);
        setTestField('__e2eAppReady', true);
    } else {
        mainWindow?.once('show', () => {
            handleShowOnboardingScreens(showWelcomeScreen(), showNewServerModal(), false);
            setTestField('__e2eAppReady', true);
        });
    }
}
```

- [ ] **Step 2: Modify `handleWelcomeScreenModal` to replace existing server on connect**

Change the `onConnect` handler so that when a server already exists, it removes the old one before adding the new one. Also make the modal closeable when servers exist.

```typescript
export function handleWelcomeScreenModal(prefillURL?: string) {
    log.debug('handleWelcomeScreenModal');

    const html = 'mattermost-desktop://renderer/welcomeScreen.html';

    const preload = getLocalPreload('internalAPI.js');

    const mainWindow = MainWindow.get();
    if (!mainWindow) {
        return;
    }
    const modalPromise = ModalManager.addModal<{prefillURL?: string}, UniqueServer>(ModalConstants.WELCOME_SCREEN_MODAL, html, preload, {prefillURL}, mainWindow, !ServerManager.hasServers());
    if (modalPromise) {
        modalPromise.then(async (data) => {
            let initialLoadURL;
            if (prefillURL) {
                const parsedServerURL = parseURL(data.url);
                if (parsedServerURL) {
                    initialLoadURL = parseURL(`${parsedServerURL.origin}${prefillURL.substring(prefillURL.indexOf('/'))}`);
                }
            }

            // Replace existing server if one exists (single-org model)
            const existingServers = ServerManager.getAllServers();
            for (const server of existingServers) {
                ServerManager.removeServer(server.id);
            }

            ServerManager.addServer(data, initialLoadURL);
        }).catch((e) => {
            // e is undefined for user cancellation
            if (e) {
                log.error(`there was an error in the welcome screen modal: ${e}`);
                log.error(e);
            }
        });
    } else {
        log.warn('There is already a welcome screen modal');
    }
}
```

- [ ] **Step 3: Build and verify startup always shows org selection**

Run: `npm run build`
Expected: Build succeeds. On `npm start`, the OrganizationList page always appears first. If a server already exists, the modal is closeable (X button works).

- [ ] **Step 4: Commit**

```bash
git add src/main/app/intercom.ts
git commit -m "feat: always show org selection on startup, replace server on connect"
```

---

### Task 2: Add IPC channel and preload API for "Change organization"

**Files:**
- Modify: `src/common/communication.ts`
- Modify: `src/app/preload/internalAPI.js`
- Modify: `src/types/window.ts`
- Modify: `src/main/app/initialize.ts`

- [ ] **Step 1: Add IPC channel constant**

In `src/common/communication.ts`, add a new constant:

```typescript
export const SHOW_CHANGE_ORGANIZATION = 'show-change-organization';
```

- [ ] **Step 2: Register IPC handler in initialize.ts**

In the `initializeInterCommunicationEventListeners()` function in `src/main/app/initialize.ts`, add a handler that triggers the welcome screen modal:

```typescript
ipcMain.on(SHOW_CHANGE_ORGANIZATION, () => {
    handleWelcomeScreenModal();
});
```

Import `SHOW_CHANGE_ORGANIZATION` from `common/communication` and `handleWelcomeScreenModal` from the intercom module (check if it's already imported).

- [ ] **Step 3: Expose in preload API**

In `src/app/preload/internalAPI.js`, add `SHOW_CHANGE_ORGANIZATION` to the imports and add to the `window.desktop` object:

```javascript
showChangeOrganization: () => ipcRenderer.send(SHOW_CHANGE_ORGANIZATION),
```

- [ ] **Step 4: Add TypeScript type**

In `src/types/window.ts`, add to the `DesktopAPI` type (or the interface that types `window.desktop`):

```typescript
showChangeOrganization: () => void;
```

- [ ] **Step 5: Commit**

```bash
git add src/common/communication.ts src/app/preload/internalAPI.js src/types/window.ts src/main/app/initialize.ts
git commit -m "feat: add IPC channel for change organization action"
```

---

### Task 3: Replace server dropdown with "Change organization" button

**Files:**
- Modify: `src/renderer/dropdown.tsx`

- [ ] **Step 1: Replace the dropdown content**

Replace the entire render method content of `ServerDropdown` with a simple "Change organization" button. Remove drag-and-drop, server list, edit/remove buttons, and "Add server" button:

```tsx
render() {
    if (!this.state.nonce) {
        return null;
    }

    return (
        <IntlProvider>
            <div
                onClick={this.preventPropagation}
                className='ServerDropdown'
                style={{
                    maxHeight: this.state.windowBounds ? (this.state.windowBounds.height - TAB_BAR_HEIGHT - 16) : undefined,
                    maxWidth: this.state.windowBounds ? (this.state.windowBounds.width - THREE_DOT_MENU_WIDTH_MAC) : undefined,
                }}
            >
                <button
                    className='ServerDropdown__button addServer'
                    onClick={this.changeOrganization}
                >
                    <i className='icon-swap-horizontal'/>
                    <FormattedMessage
                        id='renderer.dropdown.changeOrganization'
                        defaultMessage='Change organization'
                    />
                </button>
            </div>
        </IntlProvider>
    );
}
```

- [ ] **Step 2: Add the `changeOrganization` handler**

Add a method to the class that calls the new preload API and closes the menu:

```typescript
changeOrganization = () => {
    window.desktop.showChangeOrganization();
    this.closeMenu();
};
```

- [ ] **Step 3: Clean up unused imports and methods**

Remove unused imports: `DragDropContext`, `Draggable`, `Droppable`, and related types (`DraggingStyle`, `DropResult`, `NotDraggingStyle`). Remove the `getStyle` function. Remove unused methods: `selectServer`, `addServer`, `isActiveServer`, `onDragStart`, `onDragEnd`, `setButtonRef`, `addButtonRef`, `handleKeyboardShortcuts`, `handleClickOnDragHandle`, `editServer`, `removeServer`, `serverIsPredefined`. Remove unused state fields: `servers`, `serverOrder`, `orderedServers`, `activeServer`, `enableServerManagement`, `unreads`, `mentions`, `expired`, `isAnyDragging`. Simplify `handleUpdate` to only keep `windowBounds`. Remove `buttonRefs`, `addServerRef`, `focusedIndex` instance fields. Simplify `componentDidMount` to remove keyboard listener. Remove `componentWillUnmount` keyboard listener cleanup.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/dropdown.tsx
git commit -m "feat: replace server dropdown with change organization button"
```

---

### Task 4: Simplify ServerDropdownButton

**Files:**
- Modify: `src/renderer/components/ServerDropdownButton/ServerDropdownButton.tsx`
- Modify: `src/renderer/components/MainPage.tsx`

- [ ] **Step 1: Simplify ServerDropdownButton to show org name and trigger dropdown**

Remove mention/unread badge logic. Keep just the org name display and the click-to-toggle behavior:

```tsx
type Props = {
    isDisabled?: boolean;
    activeServerName?: string;
    isMenuOpen: boolean;
}

const ServerDropdownButton: React.FC<Props> = (props: Props) => {
    const {isDisabled, activeServerName, isMenuOpen} = props;
    const buttonRef: React.RefObject<HTMLButtonElement> = React.createRef();

    useEffect(() => {
        if (!isMenuOpen) {
            buttonRef.current?.blur();
        }
    }, [isMenuOpen]);

    const handleToggleButton = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (isMenuOpen) {
            window.desktop.closeServersDropdown();
        } else {
            window.desktop.openServersDropdown();
        }
    };

    return (
        <button
            ref={buttonRef}
            disabled={isDisabled}
            className={classNames('ServerDropdownButton', {
                disabled: isDisabled,
                isMenuOpen,
            })}
            onClick={handleToggleButton}
            onDoubleClick={(event) => {
                event.stopPropagation();
            }}
        >
            <i className='icon-server-variant'/>
            {activeServerName && <span>{activeServerName}</span>}
            {!activeServerName &&
                <FormattedMessage
                    id='renderer.components.serverDropdownButton.noServersConfigured'
                    defaultMessage='No servers configured'
                />
            }
            <i className='icon-chevron-down'/>
        </button>
    );
};
```

- [ ] **Step 2: Update MainPage to pass simplified props**

In `src/renderer/components/MainPage.tsx`, update the `ServerDropdownButton` usage to remove mention/unread props:

```tsx
<ServerDropdownButton
    isDisabled={this.state.modalOpen}
    activeServerName={activeServer.name}
    isMenuOpen={this.state.isMenuOpen}
/>
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ServerDropdownButton/ServerDropdownButton.tsx src/renderer/components/MainPage.tsx
git commit -m "feat: simplify server dropdown button, remove badge props"
```

---

### Task 5: Hide server management in settings

**Files:**
- Modify: `src/renderer/components/SettingsModal/components/ServerSetting.tsx`

- [ ] **Step 1: Return null from ServerSetting**

The simplest approach — make the entire component render nothing:

```tsx
export default function ServerSetting() {
    return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/SettingsModal/components/ServerSetting.tsx
git commit -m "feat: hide server management section from settings"
```

---

### Task 6: Hide server-related menu items

**Files:**
- Modify: `src/app/menus/appMenu/file.ts`

- [ ] **Step 1: Check what server-related menu items exist**

Read `src/app/menus/appMenu/file.ts` and identify any "New Server" or server management menu items.

- [ ] **Step 2: Remove or hide server-related menu items**

Comment out or remove any menu items related to adding/managing servers (e.g., items that send `SHOW_NEW_SERVER_MODAL`).

- [ ] **Step 3: Commit**

```bash
git add src/app/menus/appMenu/file.ts
git commit -m "feat: hide server-related menu items"
```

---

### Task 7: Handle replace behavior in ServerHub.showNewServerModal

**Files:**
- Modify: `src/app/serverHub.ts`

- [ ] **Step 1: Update showNewServerModal to replace existing server**

Modify the `modalPromise.then` handler to remove existing servers before adding the new one, same as we did in `handleWelcomeScreenModal`:

```typescript
modalPromise.then(async (data) => {
    let initialLoadURL;
    if (prefillURL) {
        const parsedServerURL = parseURL(data.url);
        if (parsedServerURL) {
            initialLoadURL = parseURL(`${parsedServerURL.origin}${prefillURL.substring(prefillURL.indexOf('/'))}`);
        }
    }

    // Replace existing server if one exists (single-org model)
    const existingServers = ServerManager.getAllServers();
    for (const server of existingServers) {
        ServerManager.removeServer(server.id);
    }

    ServerManager.addServer(data, initialLoadURL);
}).catch((e) => {
    // e is undefined for user cancellation
    if (e) {
        log.error(`there was an error in the new server modal: ${e}`);
    }
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/serverHub.ts
git commit -m "feat: new server modal replaces existing server instead of adding"
```

---

### Task 8: Build and manual verification

- [ ] **Step 1: Run type check**

Run: `npm run check-types`
Expected: No type errors.

- [ ] **Step 2: Run linter**

Run: `npm run lint:js`
Expected: No lint errors (or only pre-existing ones).

- [ ] **Step 3: Build and run**

Run: `npm run build && npm start`
Expected:
1. App starts and immediately shows OrganizationList (search/create org page)
2. If a server was previously configured, the modal can be dismissed (X button)
3. Connecting to an org replaces any existing server
4. The server dropdown now only shows "Change organization" button
5. No server list, edit, remove, or "Add server" buttons visible anywhere
6. Settings modal has no server management section
7. Clicking "Change organization" opens the OrganizationList modal

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address any issues found during manual verification"
```
