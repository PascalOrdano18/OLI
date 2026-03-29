# Issue Tagging in Mattermost Chat

## Summary

Enable users to reference issues from the issue tracker directly in Mattermost chat messages using `#` autocomplete. Referenced issues render as rich cards (identical to Oli's existing issue cards) in both user and agent messages. Clicking a card navigates the Electron app to Issues > that issue > Docs tab.

## Goals

1. Users can type `#` in the chat input to trigger an autocomplete dropdown of issues, searchable by identifier and title.
2. Selected issues are embedded in the message as `{{issue:IDENTIFIER}}` syntax.
3. All messages (user and Oli) containing `{{issue:...}}` render rich `IssueRefCard` components.
4. Clicking any issue card navigates to the Issues view, selects that issue, and opens its Docs tab.

## Non-Goals

- Changing how Oli generates issue references server-side (the existing `oli_data.issue_refs` mechanism stays; the new renderer handles both).
- URL-based routing for issues (navigation is state-driven within the Electron app).
- Issue creation from chat (only referencing existing issues).

## Architecture

Four components, all in the Mattermost plugin webapp except for a small IPC addition in the Electron app.

### 1. IssueAutocomplete

**Location:** `mattermost-plugin-issues/webapp/src/components/issue_autocomplete/`
**Registration:** `registerRootComponent` in plugin `index.tsx`

A floating dropdown that appears when the user types `#` in the Mattermost message textarea.

**Behavior:**
- Attaches a `keyup`/`input` listener to the Mattermost chat textarea (found via DOM query: `#post_textbox` or equivalent).
- Detects `#` preceded by a space or at the start of input.
- Extracts the query text after `#` (e.g., `#fix` -> query is `fix`).
- Searches across all projects, matching against both issue identifier and title (case-insensitive).
- Shows up to 5 results in a dropdown positioned above the textarea.
- Each result row shows: priority icon (24x24), identifier (monospace), title (ellipsized).
- Keyboard navigation: arrow keys to move highlight, Enter to select, Esc to dismiss.
- On selection: replaces the `#query` text in the textarea with `{{issue:BCK-3}}`.
- Dismissed on: Esc, clicking outside, deleting the `#` character.

**Data source:**
- Primary: search the Redux store (issues already loaded for the RHS panel).
- Fallback: API call to search across all projects when store doesn't have enough data. Uses the existing `client.getIssues(projectId, {search: query})` for each project, debounced at 200ms.

### 2. IssueRefRenderer

**Location:** `mattermost-plugin-issues/webapp/src/components/issue_ref_renderer/`
**Registration:** `registerRootComponent` in plugin `index.tsx`

A MutationObserver-based component that scans rendered message DOM for `{{issue:IDENTIFIER}}` patterns and replaces them with rich cards.

**Behavior:**
- On mount, creates a `MutationObserver` watching the Mattermost post list container for new/changed child nodes.
- When a post element is added or updated, scans its text content for the regex: `\{\{issue:([A-Z]+-\d+)\}\}`.
- For each match:
  - In the message text span, replaces `{{issue:BCK-3}}` with a styled inline identifier (bold, colored by status).
  - Appends an `IssueRefCard` component below the message text.
- Fetches issue data by identifier. Maintains a local cache (Map) keyed by identifier to avoid repeat API calls. Also checks the Redux store first.
- Renders using `ReactDOM.createRoot` to inject React components into the post DOM.

**API requirement:** A new endpoint or search parameter to fetch an issue by identifier (e.g., `GET /api/v1/issues/by-identifier/BCK-3`). Currently the API only supports fetch by UUID. This needs to be added to the Go plugin server.

### 3. IssueRefCard (enhanced)

**Location:** `mattermost-plugin-issues/webapp/src/components/oli/issue_ref_card.tsx` (existing file)

The existing card component, enhanced with:
- An `onClick` prop (optional, for backward compatibility).
- `cursor: pointer` style when `onClick` is provided.
- Hover effect: background changes to `rgba(0, 0, 0, 0.08)`.
- A small `->` arrow on the right side as a clickable affordance.
- On click: calls `window.desktopAPI.navigateToIssue(issueId)` where `issueId` is the UUID from the fetched issue data (not the identifier string).

The `OliResponsePost` component passes `onClick` to each `IssueRefCard` it renders. The `IssueRefRenderer` does the same when injecting cards into user messages.

### 4. IPC: navigateToIssue

A new IPC channel enabling the Mattermost WebView (external view) to tell the Electron app to navigate to a specific issue's Docs tab.

**Files changed:**

1. **`src/common/communication.ts`** — Add constant:
   ```
   NAVIGATE_TO_ISSUE = 'navigate-to-issue'
   ```

2. **`src/app/preload/externalAPI.ts`** — Expose to `window.desktopAPI`:
   ```
   navigateToIssue: (issueId: string) => ipcRenderer.send(NAVIGATE_TO_ISSUE, issueId)
   ```

3. **`src/main/app/initialize.ts`** — Register handler:
   ```
   ipcMain.on(NAVIGATE_TO_ISSUE, (_, issueId) => {
       // Switch to issues view mode
       mainWindow.setViewMode('issues');
       // Forward issueId to the IssuesView renderer
       mainWindow.webContents.send(NAVIGATE_TO_ISSUE, issueId);
   });
   ```

4. **`src/renderer/components/IssuesView/IssuesView.tsx`** — Add `useEffect` listener:
   ```
   useEffect(() => {
       const handler = (_, issueId) => {
           // Find the issue across all loaded projects
           // Set it as activeIssue
           // Switch subTab to 'docs'
       };
       window.desktop.on(NAVIGATE_TO_ISSUE, handler);
       return () => window.desktop.off(NAVIGATE_TO_ISSUE, handler);
   }, [issues]);
   ```

## Server-Side Changes (Go Plugin)

### New API endpoint: get issue by identifier

**Route:** `GET /api/v1/issues/by-identifier/:identifier`

Looks up an issue by its human-readable identifier (e.g., `BCK-3`) instead of UUID. Returns the same `Issue` JSON as the existing `GET /api/v1/issues/:id` endpoint.

This is needed because the `{{issue:BCK-3}}` syntax in messages contains the identifier, not the UUID. The renderer needs to resolve identifier -> full issue data.

### Search across all projects

**Route:** `GET /api/v1/issues/search?q=:query`

Searches issue identifiers and titles across all projects. Returns up to 5 matching issues. Used by the autocomplete when the Redux store doesn't have sufficient data.

## Rendering Rules

1. The regex `\{\{issue:([A-Z]+-\d+)\}\}` matches issue references in message text.
2. In the inline text, the `{{issue:BCK-3}}` token is replaced with a styled identifier span (bold, colored by the issue's status color).
3. Below the message text, each unique referenced issue renders as a full `IssueRefCard`.
4. Cards are deduplicated by identifier (if the same issue is referenced twice, only one card appears).
5. Cards are clickable, triggering the `navigateToIssue` IPC flow.
6. For Oli messages using the existing `custom_oli_response` post type: the `OliResponsePost` component continues to work as before, but now also passes `onClick` to each `IssueRefCard`.

## Autocomplete Trigger Rules

- `#` triggers autocomplete only when preceded by whitespace or at position 0 in the input.
- `#` inside a word (e.g., `foo#bar`) does not trigger.
- Minimum 1 character after `#` before searching.
- Dropdown dismissed on: Esc, click outside, backspacing past `#`, or sending the message.

## Edge Cases

- **Issue not found:** If the renderer can't resolve an identifier, it leaves the `{{issue:BCK-3}}` text as-is (no card, no inline styling). This handles deleted issues or typos.
- **Stale data:** Cards show data as of render time. No live-updating of cards in already-rendered messages.
- **Multiple references:** A message can contain multiple `{{issue:...}}` tokens. Each gets an inline identifier and a card. Cards are deduplicated.
- **Oli backward compatibility:** Oli's existing `oli_data.issue_refs` rendering continues to work unchanged. The new `onClick` prop is additive.
