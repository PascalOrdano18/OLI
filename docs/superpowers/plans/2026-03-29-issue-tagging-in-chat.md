# Issue Tagging in Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `#` autocomplete for issue references in OLI chat, render them as rich cards, and make cards clickable to navigate to the issue's Docs tab.

**Architecture:** Four components — (1) server-side search endpoint in Go plugin, (2) IssueAutocomplete dropdown in plugin webapp, (3) IssueRefRenderer for rendering `{{issue:ID}}` as rich cards, (4) IPC channel for click-to-navigate. The existing `IssueRefCard` component is enhanced with click handling.

**Tech Stack:** Go (OLI plugin server), React/TypeScript (OLI plugin webapp), Electron IPC (desktop app)

**Spec:** `docs/superpowers/specs/2026-03-29-issue-tagging-in-chat-design.md`

---

### Task 1: Add search-issues-by-identifier endpoint (Go server)

**Files:**
- Modify: `mattermost-plugin-issues/server/store.go`
- Modify: `mattermost-plugin-issues/server/store_kv.go`
- Modify: `mattermost-plugin-issues/server/api.go`
- Create: `mattermost-plugin-issues/server/api_search.go`

- [ ] **Step 1: Add `GetIssueByIdentifier` and `SearchAllIssues` to Store interface**

In `mattermost-plugin-issues/server/store.go`, add two methods to the `Store` interface inside the `// Issues` section, after line 24 (`DeleteIssue`):

```go
	GetIssueByIdentifier(identifier string) (*Issue, error)
	SearchAllIssues(query string, limit int) ([]*Issue, error)
```

- [ ] **Step 2: Implement `GetIssueByIdentifier` in KV store**

In `mattermost-plugin-issues/server/store_kv.go`, add after the `DeleteIssue` method (after line 354):

```go
func (s *KVStore) GetIssueByIdentifier(identifier string) (*Issue, error) {
	// Get all projects to iterate their issue indices.
	projects, err := s.ListProjects()
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	upper := strings.ToUpper(identifier)
	for _, p := range projects {
		ids, err := s.getIndex(keyIssueIndex + p.ID)
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			var issue Issue
			found, err := s.get(keyIssuePrefix+id, &issue)
			if err != nil {
				return nil, err
			}
			if found && strings.ToUpper(issue.Identifier) == upper {
				return &issue, nil
			}
		}
	}
	return nil, fmt.Errorf("issue not found: %s", identifier)
}
```

- [ ] **Step 3: Implement `SearchAllIssues` in KV store**

In `mattermost-plugin-issues/server/store_kv.go`, add after `GetIssueByIdentifier`:

```go
func (s *KVStore) SearchAllIssues(query string, limit int) ([]*Issue, error) {
	projects, err := s.ListProjects()
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	q := strings.ToLower(query)
	var results []*Issue
	for _, p := range projects {
		ids, err := s.getIndex(keyIssueIndex + p.ID)
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			var issue Issue
			found, err := s.get(keyIssuePrefix+id, &issue)
			if err != nil {
				return nil, err
			}
			if !found {
				continue
			}
			if strings.Contains(strings.ToLower(issue.Identifier), q) ||
				strings.Contains(strings.ToLower(issue.Title), q) {
				results = append(results, &issue)
				if len(results) >= limit {
					return results, nil
				}
			}
		}
	}
	return results, nil
}
```

- [ ] **Step 4: Create API handlers**

Create `mattermost-plugin-issues/server/api_search.go`:

```go
// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

func (p *Plugin) handleGetIssueByIdentifier(w http.ResponseWriter, r *http.Request) {
	identifier := mux.Vars(r)["identifier"]
	issue, err := p.store.GetIssueByIdentifier(identifier)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, issue)
}

func (p *Plugin) handleSearchAllIssues(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		respondJSON(w, http.StatusOK, []*Issue{})
		return
	}
	limitStr := r.URL.Query().Get("limit")
	limit := 5
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	issues, err := p.store.SearchAllIssues(query, limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, issues)
}
```

- [ ] **Step 5: Register routes**

In `mattermost-plugin-issues/server/api.go`, add two routes in the `initRouter` function after line 31 (`handleGetIssue` route) inside the user-facing API section:

```go
	api.HandleFunc("/issues/by-identifier/{identifier}", p.handleGetIssueByIdentifier).Methods(http.MethodGet)
	api.HandleFunc("/issues/search", p.handleSearchAllIssues).Methods(http.MethodGet)
```

**Important:** These must be registered BEFORE the `/issues/{id}` route (line 30) because `{id}` is a catch-all. Move the new `by-identifier` and `search` routes to be before `/issues/{id}`:

```go
	// Issues
	api.HandleFunc("/projects/{id}/issues", p.handleListIssues).Methods(http.MethodGet)
	api.HandleFunc("/projects/{id}/issues", p.handleCreateIssue).Methods(http.MethodPost)
	api.HandleFunc("/issues/by-identifier/{identifier}", p.handleGetIssueByIdentifier).Methods(http.MethodGet)
	api.HandleFunc("/issues/search", p.handleSearchAllIssues).Methods(http.MethodGet)
	api.HandleFunc("/issues/{id}", p.handleGetIssue).Methods(http.MethodGet)
	api.HandleFunc("/issues/{id}", p.handleUpdateIssue).Methods(http.MethodPut)
	api.HandleFunc("/issues/{id}", p.handleDeleteIssue).Methods(http.MethodDelete)
```

- [ ] **Step 6: Verify Go compiles**

Run: `cd mattermost-plugin-issues && go build ./server/...`
Expected: clean build, no errors.

- [ ] **Step 7: Commit**

```bash
git add mattermost-plugin-issues/server/store.go mattermost-plugin-issues/server/store_kv.go mattermost-plugin-issues/server/api.go mattermost-plugin-issues/server/api_search.go
git commit -m "feat: add search-by-identifier and search-all-issues API endpoints"
```

---

### Task 2: Add client methods for new endpoints (webapp)

**Files:**
- Modify: `mattermost-plugin-issues/webapp/src/client/client.ts`

- [ ] **Step 1: Add `getIssueByIdentifier` and `searchAllIssues` methods**

In `mattermost-plugin-issues/webapp/src/client/client.ts`, add after the `deleteIssue` method (line 35):

```typescript
    getIssueByIdentifier = (identifier: string): Promise<Issue> => this.doGet(`/issues/by-identifier/${identifier}`);
    searchAllIssues = (query: string, limit = 5): Promise<Issue[]> => this.doGet(`/issues/search?q=${encodeURIComponent(query)}&limit=${limit}`);
```

Also add `Issue` to the existing import on line 7:

The import already includes `Issue` — verify it's there. If not, add it.

- [ ] **Step 2: Commit**

```bash
git add mattermost-plugin-issues/webapp/src/client/client.ts
git commit -m "feat: add client methods for issue search endpoints"
```

---

### Task 3: Enhance IssueRefCard with click handling

**Files:**
- Modify: `mattermost-plugin-issues/webapp/src/components/oli/issue_ref_card.tsx`

- [ ] **Step 1: Add `onClick` prop and clickable styles**

Replace the full content of `mattermost-plugin-issues/webapp/src/components/oli/issue_ref_card.tsx`:

```tsx
// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useState} from 'react';

import type {IssueStatus, IssuePriority} from '../../types/model';
import {STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS} from '../../types/model';

export interface IssueRefData {
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: string;
}

interface Props {
    issueRef: IssueRefData;
    onClick?: (issueRef: IssueRefData) => void;
}

const PRIORITY_ICONS: Record<string, string> = {
    urgent: '!!!',
    high: '\u2191',
    medium: '\u2014',
    low: '\u2193',
    none: '\u25CB',
};

const IssueRefCard: React.FC<Props> = ({issueRef, onClick}) => {
    const [hovered, setHovered] = useState(false);
    const status = issueRef.status as IssueStatus;
    const priority = issueRef.priority as IssuePriority;
    const statusColor = STATUS_COLORS[status] || '#909399';
    const priorityColor = PRIORITY_COLORS[priority] || '#909399';
    const isClickable = Boolean(onClick);

    const handleClick = useCallback(() => {
        if (onClick) {
            onClick(issueRef);
        }
    }, [onClick, issueRef]);

    return (
        <div
            className='issues-oli-issue-ref'
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                backgroundColor: hovered && isClickable ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                borderRadius: '8px',
                border: '1px solid rgba(0, 0, 0, 0.08)',
                marginTop: '4px',
                cursor: isClickable ? 'pointer' : 'default',
                transition: 'background-color 0.15s',
            }}
            onClick={handleClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div
                style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    backgroundColor: statusColor + '20',
                    border: `1px solid ${statusColor}40`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                <span
                    style={{
                        color: priorityColor,
                        fontSize: '12px',
                        fontWeight: 700,
                    }}
                >
                    {PRIORITY_ICONS[priority] || '\u25CB'}
                </span>
            </div>
            <div style={{flex: 1, minWidth: 0}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <span
                        style={{
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: statusColor,
                        }}
                    >
                        {issueRef.identifier}
                    </span>
                    <span
                        style={{
                            backgroundColor: statusColor + '20',
                            color: statusColor,
                            border: `1px solid ${statusColor}40`,
                            padding: '1px 6px',
                            borderRadius: '12px',
                            fontSize: '10px',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {STATUS_LABELS[status] || issueRef.status}
                    </span>
                </div>
                <div
                    style={{
                        fontSize: '13px',
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {issueRef.title}
                </div>
            </div>
            {isClickable && (
                <div style={{color: '#999', fontSize: '16px', flexShrink: 0}}>{'\u2192'}</div>
            )}
        </div>
    );
};

export default IssueRefCard;
```

- [ ] **Step 2: Update OliResponsePost to pass onClick**

In `mattermost-plugin-issues/webapp/src/components/oli/oli_response_post.tsx`, update the issueRefs rendering section. Replace lines 57-61:

```tsx
                    {issueRefs.map((ref) => (
                        <IssueRefCard
                            key={ref.id}
                            issueRef={ref}
                            onClick={(ir) => {
                                const api = (window as any).desktopAPI;
                                if (api?.navigateToIssue) {
                                    api.navigateToIssue(ir.id);
                                }
                            }}
                        />
                    ))}
```

- [ ] **Step 3: Commit**

```bash
git add mattermost-plugin-issues/webapp/src/components/oli/issue_ref_card.tsx mattermost-plugin-issues/webapp/src/components/oli/oli_response_post.tsx
git commit -m "feat: make IssueRefCard clickable with navigate-to-issue support"
```

---

### Task 4: Add NAVIGATE_TO_ISSUE IPC channel (Electron)

**Files:**
- Modify: `src/common/communication.ts`
- Modify: `src/app/preload/externalAPI.ts`
- Modify: `src/app/preload/internalAPI.js`
- Modify: `src/app/tabs/tabManager.ts`
- Modify: `src/renderer/components/IssuesView/IssuesView.tsx`

- [ ] **Step 1: Add IPC constant**

In `src/common/communication.ts`, add after line 102 (`ISSUES_API_REQUEST`):

```typescript
export const NAVIGATE_TO_ISSUE = 'navigate-to-issue';
```

- [ ] **Step 2: Expose in external preload (for OLI WebView)**

In `src/app/preload/externalAPI.ts`, add `NAVIGATE_TO_ISSUE` to the imports from `common/communication` (line 55 area). Add it after `WINDOW_CLOSE`:

```typescript
    NAVIGATE_TO_ISSUE,
```

Then add a method to the `desktopAPI` object, after the `closeWindow` line (line 138):

```typescript
    navigateToIssue: (issueId: string) => ipcRenderer.send(NAVIGATE_TO_ISSUE, issueId),
```

- [ ] **Step 3: Expose in internal preload (for renderer)**

In `src/app/preload/internalAPI.js`, add `NAVIGATE_TO_ISSUE` to the imports from `common/communication` (after `AO_GET_GIT_STATUS` on line 147):

```javascript
    NAVIGATE_TO_ISSUE,
```

Then add a listener in the `window.desktop` object, after the `setViewMode` line (line 170):

```javascript
    onNavigateToIssue: (listener) => ipcRenderer.on(NAVIGATE_TO_ISSUE, (_, issueId) => listener(issueId)),
```

- [ ] **Step 4: Handle in TabManager (main process)**

In `src/app/tabs/tabManager.ts`, add `NAVIGATE_TO_ISSUE` to the imports from `common/communication` (after `SET_VIEW_MODE` on line 42):

```typescript
    NAVIGATE_TO_ISSUE,
```

Then register the handler in the constructor, after the `SET_VIEW_MODE` handler (line 81):

```typescript
        ipcMain.on(NAVIGATE_TO_ISSUE, (event, issueId: string) => {
            this.setViewMode('issues');
            const mainWindow = MainWindow.get();
            if (mainWindow) {
                mainWindow.webContents.send(NAVIGATE_TO_ISSUE, issueId);
            }
        });
```

- [ ] **Step 5: Listen in IssuesView (renderer)**

In `src/renderer/components/IssuesView/IssuesView.tsx`, add a `useEffect` after the existing `useEffect` that fetches issues for all projects (after line 1073):

```tsx
    useEffect(() => {
        const handler = (issueId: string) => {
            for (const projIssues of Object.values(allIssues)) {
                const found = projIssues.find((i) => i.id === issueId);
                if (found) {
                    setActiveProjectId(found.project_id);
                    setActiveIssue(found);
                    setSubTab('docs');
                    return;
                }
            }
        };
        (window as any).desktop.onNavigateToIssue(handler);
    }, [allIssues]);
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Users/lolo/conductor/workspaces/oli/porto-v1 && npm run check-types`
Expected: no type errors related to the new changes.

- [ ] **Step 7: Commit**

```bash
git add src/common/communication.ts src/app/preload/externalAPI.ts src/app/preload/internalAPI.js src/app/tabs/tabManager.ts src/renderer/components/IssuesView/IssuesView.tsx
git commit -m "feat: add NAVIGATE_TO_ISSUE IPC channel for click-to-navigate"
```

---

### Task 5: Build the IssueAutocomplete component

**Files:**
- Create: `mattermost-plugin-issues/webapp/src/components/issue_autocomplete/issue_autocomplete.tsx`
- Modify: `mattermost-plugin-issues/webapp/src/index.tsx`

- [ ] **Step 1: Create the autocomplete component**

Create `mattermost-plugin-issues/webapp/src/components/issue_autocomplete/issue_autocomplete.tsx`:

```tsx
// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState, useRef, useCallback} from 'react';

import client from '../../client/client';
import type {Issue} from '../../types/model';
import {STATUS_COLORS, PRIORITY_COLORS} from '../../types/model';

const PRIORITY_ICONS: Record<string, string> = {
    urgent: '!!!',
    high: '\u2191',
    medium: '\u2014',
    low: '\u2193',
    none: '\u25CB',
};

const TRIGGER = '#';
const MAX_RESULTS = 5;
const DEBOUNCE_MS = 200;

const IssueAutocomplete: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [results, setResults] = useState<Issue[]>([]);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [position, setPosition] = useState({bottom: 0, left: 0, width: 0});
    const triggerStartRef = useRef<number>(-1);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const textboxRef = useRef<HTMLTextAreaElement | null>(null);

    const getTextbox = useCallback((): HTMLTextAreaElement | null => {
        if (textboxRef.current && document.body.contains(textboxRef.current)) {
            return textboxRef.current;
        }
        const el = document.getElementById('post_textbox') as HTMLTextAreaElement | null;
        textboxRef.current = el;
        return el;
    }, []);

    const insertIssueRef = useCallback((issue: Issue) => {
        const textbox = getTextbox();
        if (!textbox || triggerStartRef.current < 0) {
            return;
        }
        const value = textbox.value;
        const before = value.substring(0, triggerStartRef.current);
        const after = value.substring(textbox.selectionStart);
        const token = `{{issue:${issue.identifier}}}`;
        const newValue = before + token + after;

        // Set value via native input setter to trigger React's onChange.
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(textbox, newValue);
        } else {
            textbox.value = newValue;
        }
        textbox.dispatchEvent(new Event('input', {bubbles: true}));

        const cursorPos = before.length + token.length;
        textbox.setSelectionRange(cursorPos, cursorPos);
        textbox.focus();

        setOpen(false);
        setResults([]);
        triggerStartRef.current = -1;
    }, [getTextbox]);

    const search = useCallback(async (query: string) => {
        if (query.length < 1) {
            setResults([]);
            return;
        }
        try {
            const issues = await client.searchAllIssues(query, MAX_RESULTS);
            setResults(issues || []);
            setHighlightIndex(0);
        } catch {
            setResults([]);
        }
    }, []);

    useEffect(() => {
        const handleInput = () => {
            const textbox = getTextbox();
            if (!textbox) {
                return;
            }
            const value = textbox.value;
            const cursor = textbox.selectionStart;

            // Find the last # before cursor that is preceded by space or is at position 0.
            let triggerPos = -1;
            for (let i = cursor - 1; i >= 0; i--) {
                if (value[i] === ' ' || value[i] === '\n') {
                    break;
                }
                if (value[i] === TRIGGER) {
                    if (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\n') {
                        triggerPos = i;
                    }
                    break;
                }
            }

            if (triggerPos < 0) {
                setOpen(false);
                triggerStartRef.current = -1;
                return;
            }

            triggerStartRef.current = triggerPos;
            const query = value.substring(triggerPos + 1, cursor);

            // Position dropdown above the textbox.
            const rect = textbox.getBoundingClientRect();
            setPosition({
                bottom: window.innerHeight - rect.top + 4,
                left: rect.left,
                width: rect.width,
            });

            setOpen(true);

            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
            debounceRef.current = setTimeout(() => search(query), DEBOUNCE_MS);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (!open || results.length === 0) {
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIndex((prev) => (prev + 1) % results.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIndex((prev) => (prev - 1 + results.length) % results.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                insertIssueRef(results[highlightIndex]);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                triggerStartRef.current = -1;
            }
        };

        // Observe DOM for the textbox (it might not exist on mount).
        const interval = setInterval(() => {
            const textbox = getTextbox();
            if (textbox && !(textbox as any).__issueAutocompleteAttached) {
                textbox.addEventListener('input', handleInput);
                textbox.addEventListener('keydown', handleKeyDown, true);
                (textbox as any).__issueAutocompleteAttached = true;
            }
        }, 500);

        return () => {
            clearInterval(interval);
            const textbox = getTextbox();
            if (textbox) {
                textbox.removeEventListener('input', handleInput);
                textbox.removeEventListener('keydown', handleKeyDown, true);
                (textbox as any).__issueAutocompleteAttached = false;
            }
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [open, results, highlightIndex, getTextbox, search, insertIssueRef]);

    if (!open || results.length === 0) {
        return null;
    }

    return (
        <div
            style={{
                position: 'fixed',
                bottom: position.bottom,
                left: position.left,
                width: position.width,
                zIndex: 10001,
                backgroundColor: '#2a2a2e',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.4)',
                overflow: 'hidden',
            }}
        >
            <div
                style={{
                    padding: '8px 12px',
                    fontSize: '11px',
                    color: '#888',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
            >
                {'Issues'}
            </div>
            {results.map((issue, i) => {
                const statusColor = STATUS_COLORS[issue.status as keyof typeof STATUS_COLORS] || '#909399';
                const priorityColor = PRIORITY_COLORS[issue.priority as keyof typeof PRIORITY_COLORS] || '#909399';
                return (
                    <div
                        key={issue.id}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '8px 12px',
                            cursor: 'pointer',
                            backgroundColor: i === highlightIndex ? 'rgba(64, 158, 255, 0.1)' : 'transparent',
                        }}
                        onMouseEnter={() => setHighlightIndex(i)}
                        onMouseDown={(e) => {
                            e.preventDefault(); // Prevent textbox blur.
                            insertIssueRef(issue);
                        }}
                    >
                        <div
                            style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '4px',
                                backgroundColor: statusColor + '20',
                                border: `1px solid ${statusColor}40`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <span style={{color: priorityColor, fontSize: '10px', fontWeight: 700}}>
                                {PRIORITY_ICONS[issue.priority] || '\u25CB'}
                            </span>
                        </div>
                        <span
                            style={{
                                fontFamily: 'monospace',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: statusColor,
                                flexShrink: 0,
                            }}
                        >
                            {issue.identifier}
                        </span>
                        <span
                            style={{
                                fontSize: '13px',
                                color: '#ddd',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {issue.title}
                        </span>
                    </div>
                );
            })}
            <div
                style={{
                    padding: '6px 12px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                    fontSize: '11px',
                    color: '#666',
                }}
            >
                <kbd style={{background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: '3px', fontSize: '10px'}}>{'\u2191\u2193'}</kbd>{' navigate  '}
                <kbd style={{background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: '3px', fontSize: '10px'}}>{'Enter'}</kbd>{' select  '}
                <kbd style={{background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: '3px', fontSize: '10px'}}>{'Esc'}</kbd>{' dismiss'}
            </div>
        </div>
    );
};

export default IssueAutocomplete;
```

- [ ] **Step 2: Register in plugin index.tsx**

In `mattermost-plugin-issues/webapp/src/index.tsx`, add the import after line 12 (after `OliResponsePost` import):

```typescript
import IssueAutocomplete from './components/issue_autocomplete/issue_autocomplete';
```

Then register it after the `registerRootComponent(CreateIssueModal)` line (line 37):

```typescript
        // Register issue autocomplete overlay (listens to chat textarea).
        registry.registerRootComponent(IssueAutocomplete);
```

- [ ] **Step 3: Commit**

```bash
git add mattermost-plugin-issues/webapp/src/components/issue_autocomplete/issue_autocomplete.tsx mattermost-plugin-issues/webapp/src/index.tsx
git commit -m "feat: add IssueAutocomplete dropdown triggered by # in chat"
```

---

### Task 6: Build the IssueRefRenderer component

**Files:**
- Create: `mattermost-plugin-issues/webapp/src/components/issue_ref_renderer/issue_ref_renderer.tsx`
- Modify: `mattermost-plugin-issues/webapp/src/index.tsx`

- [ ] **Step 1: Create the renderer component**

Create `mattermost-plugin-issues/webapp/src/components/issue_ref_renderer/issue_ref_renderer.tsx`:

```tsx
// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useCallback} from 'react';
import ReactDOM from 'react-dom/client';

import client from '../../client/client';
import type {Issue} from '../../types/model';
import {STATUS_COLORS} from '../../types/model';
import IssueRefCard from '../oli/issue_ref_card';
import type {IssueRefData} from '../oli/issue_ref_card';

const ISSUE_REF_REGEX = /\{\{issue:([A-Z]+-\d+)\}\}/g;
const PROCESSED_ATTR = 'data-issue-refs-processed';

const issueCache = new Map<string, Issue>();

async function resolveIssue(identifier: string): Promise<Issue | null> {
    if (issueCache.has(identifier)) {
        return issueCache.get(identifier)!;
    }
    try {
        const issue = await client.getIssueByIdentifier(identifier);
        issueCache.set(identifier, issue);
        return issue;
    } catch {
        return null;
    }
}

function handleIssueClick(issueRef: IssueRefData) {
    const api = (window as any).desktopAPI;
    if (api?.navigateToIssue) {
        api.navigateToIssue(issueRef.id);
    }
}

async function processPost(postEl: Element) {
    if (postEl.getAttribute(PROCESSED_ATTR)) {
        return;
    }
    postEl.setAttribute(PROCESSED_ATTR, 'true');

    // Find the message body element.
    const messageEl = postEl.querySelector('.post-message__text, .post-message__text-container');
    if (!messageEl) {
        return;
    }

    const textContent = messageEl.textContent || '';
    const matches = [...textContent.matchAll(ISSUE_REF_REGEX)];
    if (matches.length === 0) {
        return;
    }

    // Collect unique identifiers.
    const identifiers = [...new Set(matches.map((m) => m[1]))];
    const issues: Issue[] = [];
    for (const identifier of identifiers) {
        const issue = await resolveIssue(identifier);
        if (issue) {
            issues.push(issue);
        }
    }

    if (issues.length === 0) {
        return;
    }

    // Replace {{issue:ID}} tokens in the text with styled inline identifiers.
    const walker = document.createTreeWalker(messageEl, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        if (ISSUE_REF_REGEX.test(node.textContent || '')) {
            textNodes.push(node);
        }
        ISSUE_REF_REGEX.lastIndex = 0;
    }

    for (const textNode of textNodes) {
        const text = textNode.textContent || '';
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        const regex = new RegExp(ISSUE_REF_REGEX.source, 'g');

        while ((match = regex.exec(text)) !== null) {
            // Text before the match.
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            }

            // Create styled inline identifier.
            const identifier = match[1];
            const issue = issues.find((i) => i.identifier === identifier);
            const span = document.createElement('span');
            span.textContent = identifier;
            const color = issue ? (STATUS_COLORS[issue.status as keyof typeof STATUS_COLORS] || '#909399') : '#909399';
            span.style.fontWeight = '600';
            span.style.color = color;
            fragment.appendChild(span);

            lastIndex = regex.lastIndex;
        }

        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }

        textNode.parentNode?.replaceChild(fragment, textNode);
    }

    // Append issue cards below the message.
    const cardsContainer = document.createElement('div');
    cardsContainer.style.display = 'flex';
    cardsContainer.style.flexDirection = 'column';
    cardsContainer.style.gap = '4px';
    cardsContainer.style.marginTop = '8px';
    messageEl.parentElement?.appendChild(cardsContainer);

    const root = ReactDOM.createRoot(cardsContainer);
    root.render(
        <React.Fragment>
            {issues.map((issue) => (
                <IssueRefCard
                    key={issue.id}
                    issueRef={{
                        id: issue.id,
                        identifier: issue.identifier,
                        title: issue.title,
                        status: issue.status,
                        priority: issue.priority,
                    }}
                    onClick={handleIssueClick}
                />
            ))}
        </React.Fragment>,
    );
}

const IssueRefRenderer: React.FC = () => {
    const observerRef = useRef<MutationObserver | null>(null);

    const scanPosts = useCallback(() => {
        const posts = document.querySelectorAll(`.post:not([${PROCESSED_ATTR}])`);
        posts.forEach((post) => processPost(post));
    }, []);

    useEffect(() => {
        // Initial scan.
        scanPosts();

        // Observe for new posts.
        const container = document.getElementById('post-list') || document.body;
        observerRef.current = new MutationObserver(() => {
            scanPosts();
        });
        observerRef.current.observe(container, {childList: true, subtree: true});

        return () => {
            observerRef.current?.disconnect();
        };
    }, [scanPosts]);

    return null;
};

export default IssueRefRenderer;
```

- [ ] **Step 2: Register in plugin index.tsx**

In `mattermost-plugin-issues/webapp/src/index.tsx`, add the import after the `IssueAutocomplete` import:

```typescript
import IssueRefRenderer from './components/issue_ref_renderer/issue_ref_renderer';
```

Then register it after the `IssueAutocomplete` registration:

```typescript
        // Register issue reference renderer (scans posts for {{issue:ID}} patterns).
        registry.registerRootComponent(IssueRefRenderer);
```

- [ ] **Step 3: Commit**

```bash
git add mattermost-plugin-issues/webapp/src/components/issue_ref_renderer/issue_ref_renderer.tsx mattermost-plugin-issues/webapp/src/index.tsx
git commit -m "feat: add IssueRefRenderer to render {{issue:ID}} as rich cards in messages"
```

---

### Task 7: Build and verify end-to-end

**Files:**
- No new files

- [ ] **Step 1: Build the Go plugin**

Run: `cd mattermost-plugin-issues && go build ./server/...`
Expected: clean build.

- [ ] **Step 2: Build the webapp**

Run: `cd mattermost-plugin-issues/webapp && npm run build` (or the project's standard webapp build command)
Expected: clean build with no errors.

- [ ] **Step 3: Build the Electron app**

Run: `cd /Users/lolo/conductor/workspaces/oli/porto-v1 && npm run build`
Expected: successful build of main, preload, and renderer bundles.

- [ ] **Step 4: Manual smoke test checklist**

1. Start the app with `npm start`.
2. Open a OLI channel.
3. Type `#` followed by part of an issue identifier or title — verify the autocomplete dropdown appears.
4. Use arrow keys to navigate the dropdown — verify highlighting moves.
5. Press Enter to select — verify `{{issue:BCK-3}}` is inserted in the textbox.
6. Send the message — verify the `{{issue:BCK-3}}` text is replaced with a styled inline identifier and a rich card appears below the message.
7. Click the issue card — verify the app switches to Issues view with that issue selected and the Docs tab active.
8. Ask `@oli` about an issue — verify Oli's response cards are also clickable and navigate correctly.
9. Press Esc during autocomplete — verify it dismisses.
10. Type `#` in the middle of a word (e.g., `foo#bar`) — verify autocomplete does NOT trigger.

- [ ] **Step 5: Final commit with all files**

If any build issues were fixed during this task, commit them:

```bash
git add -A
git commit -m "fix: resolve build issues for issue tagging feature"
```
