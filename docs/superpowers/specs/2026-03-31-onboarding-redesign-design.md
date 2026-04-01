# Onboarding Redesign — Simplified 2-Page Flow

## Overview

Replace the current onboarding flow (organization list + Mattermost's own signup/login) with a streamlined 2-page experience:

1. **Page 1 — Organization**: Search for an existing org by exact name match, or create a new one
2. **Page 2 — Username**: Enter a username; all Mattermost registration happens invisibly with hardcoded values

No backend changes. All modifications are in a single component rewrite.

## Architecture

### Approach

Rewrite `OrganizationList.tsx` in-place. Same file, same props interface (`{ provisioningApiUrl, onConnect }`). Internal state machine manages the flow:

```
step: 'org' → 'username' → 'settingUp' → finishModal()
```

The `'org'` step handles search, create, and provisioning internally. Once an org is ready, it transitions to `'username'`. After the user clicks Continue, it transitions to `'settingUp'` while hidden API calls execute.

### Files Modified

- `src/renderer/components/OrganizationList/OrganizationList.tsx` — full rewrite of component logic
- `src/renderer/components/OrganizationList/OrganizationList.scss` — add styles for new steps; remove password/private org styles

### Files NOT Modified

- `src/renderer/modals/welcomeScreen/welcomeScreen.tsx` — unchanged
- `src/main/app/intercom.ts` — unchanged
- `src/common/config/buildConfig.ts` — unchanged
- Any backend, plugin, or IPC code — unchanged

No new files created.

## Page 1 — Organization Step

### Search

- Single text input with placeholder "Search organization by name..."
- On submit (Enter key or Search button): calls `GET {provisioningApiUrl}/organizations`, filters client-side for exact name match (case-insensitive)
- Match found: show org as a clickable card
  - If `status === 'ready'` and `server_url` exists: clicking transitions to Page 2
  - If still provisioning: show provisioning spinner, poll until ready
- No match: show "No organization found" message

### Create

- "Create Organization" button toggles a create form with a single input (org name only, no password)
- `POST {provisioningApiUrl}/organizations` with body: `{ name: "<trimmed input>", created_by: "desktop-user" }`
- Polls `GET {provisioningApiUrl}/organizations/{id}` every 5 seconds until `status === 'ready'`
- Once ready, auto-transitions to Page 2

### Removed from Current

- Listing all organizations on load (replaced by search)
- Password fields on create and join
- Private org handling (`is_private`, lock icons, `handleJoin`)
- `passwordOrg` state and related UI

## Page 2 — Username Step

### Input

- Single text input for username
- Org name shown in subtitle: "This is how others will see you in {orgName}"
- Client-side validation (Mattermost rules):
  - 3-22 characters
  - Lowercase alphanumeric, dots (`.`), dashes (`-`), underscores (`_`) only
  - Auto-lowercase input as the user types
- "Continue" button disabled until validation passes
- Validation errors shown inline in red

### Hidden Registration Sequence

After clicking Continue, the component transitions to `'settingUp'` step (shows a spinner with "Setting up your account...") and executes these calls against the org's Mattermost server (`org.server_url`):

1. **Create user** — `POST {serverUrl}/api/v4/users`
   ```json
   {
     "username": "{username}",
     "email": "{username}@oli.local",
     "password": "OliUser123!"
   }
   ```

2. **Login** — `POST {serverUrl}/api/v4/users/login`
   ```json
   {
     "login_id": "{username}@oli.local",
     "password": "OliUser123!"
   }
   ```
   Extract auth token from `Token` response header.

3. **Create team** — `POST {serverUrl}/api/v4/teams` (with `Authorization: Bearer {token}`)
   ```json
   {
     "name": "{orgName}-team",
     "display_name": "{orgName}",
     "type": "O"
   }
   ```
   If 409 (team already exists): `GET {serverUrl}/api/v4/teams/name/{orgName}-team` to get the existing team ID.

4. **Join team** — `POST {serverUrl}/api/v4/teams/{teamId}/members` (with auth token)
   ```json
   {
     "team_id": "{teamId}",
     "user_id": "{userId}"
   }
   ```

5. **Finish** — call `onConnect({ url: serverUrl, name: orgName })` which triggers `finishModal()` and the app loads the main view.

### Hardcoded Values

| Field | Value | Rationale |
|-------|-------|-----------|
| Email | `{username}@oli.local` | Unique per user, never shown |
| Password | `OliUser123!` | Meets Mattermost complexity requirements, never shown |
| Team name | `{orgName}-team` (sanitized: lowercased, spaces/special chars replaced with `-`, truncated to fit Mattermost's 64-char limit) | Derived from org, predictable |
| Team type | `"O"` (open) | Anyone can join |
| `created_by` | `"desktop-user"` | Same as current |

### Error Handling

- User creation returns 409 (username taken): show "Username already taken" on the username page
- Any other API failure: show the error message on the username page with a "Retry" button that re-attempts the sequence
- Network errors: show generic "Connection error" message

## Visual Design

Both pages use the existing app's dark theme and styling patterns (CSS custom properties from the current `OrganizationList.scss`). Layout is centered, max-width 400-500px, consistent with the current onboarding aesthetic.

### Page 1 States
- **Default**: search input + "Create Organization" button
- **Create mode**: org name input + Create/Cancel buttons
- **Search match found**: org displayed as clickable card with status badge
- **Provisioning**: spinner with "Setting up your organization..." message

### Page 2 States
- **Username entry**: input + validation hints + Continue button
- **Validation error**: red border, inline error messages, button disabled
- **Setting up**: spinner with "Setting up your account..." message
- **Error**: error message + Retry button
