# Shared Postgres Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-org Postgres provisioning with a single shared Postgres server, creating logical databases via `CREATE DATABASE` to speed up org creation.

**Architecture:** The provisioning API gets a new `pg`-based module (`database.js`) that connects to a shared Postgres server and creates a database per org. A new stack mode `shared` in `railway.js` creates only the Mattermost service (no Postgres service/volume) and wires it to the shared Postgres using a direct connection string. The Supabase `organizations` table gets a `db_mode` column to distinguish legacy orgs from new shared-DB orgs.

**Tech Stack:** Node.js, `pg` (node-postgres), Railway GraphQL API, Supabase, Express

---

### Task 1: Add `pg` dependency

**Files:**
- Modify: `provisioning-api/package.json`

- [ ] **Step 1: Install pg**

```bash
cd provisioning-api && npm install pg
```

- [ ] **Step 2: Verify package.json**

Run: `cat provisioning-api/package.json | grep pg`
Expected: `"pg": "^8.x.x"` appears in dependencies

- [ ] **Step 3: Commit**

```bash
git add provisioning-api/package.json provisioning-api/package-lock.json
git commit -m "feat: add pg dependency for shared postgres"
```

---

### Task 2: Add `SHARED_POSTGRES_URL` to config

**Files:**
- Modify: `provisioning-api/src/config.js`

- [ ] **Step 1: Add the config entry**

In `provisioning-api/src/config.js`, add a new entry to the config object after `railwayStackMode`:

```js
sharedPostgresUrl: () => process.env.SHARED_POSTGRES_URL || null,
```

This is optional (returns `null` if not set) because existing `lite`/`full` modes don't need it. The `shared` mode will validate it at runtime.

- [ ] **Step 2: Commit**

```bash
git add provisioning-api/src/config.js
git commit -m "feat: add SHARED_POSTGRES_URL config"
```

---

### Task 3: Create `database.js` module

**Files:**
- Create: `provisioning-api/src/database.js`

- [ ] **Step 1: Create the database module**

Create `provisioning-api/src/database.js` with the following content:

```js
// Shared Postgres — create/delete per-org logical databases

import pg from 'pg';

import config from './config.js';

/**
 * Sanitize an org UUID into a valid Postgres database name.
 * e.g. "550e8400-e29b-41d4-a716-446655440000" → "org_550e8400_e29b_41d4_a716_446655440000"
 */
function orgDbName(orgId) {
    return `org_${orgId.replace(/-/g, '_')}`;
}

/**
 * Parse the shared Postgres URL into components for building per-org connection strings.
 * Input:  "postgres://user:password@host:port/dbname"
 * Returns: { user, password, host, port }
 */
function parsePostgresUrl(url) {
    const parsed = new URL(url);
    return {
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        host: parsed.hostname,
        port: parsed.port || '5432',
    };
}

/**
 * Create a new logical database for an organization on the shared Postgres server.
 * Returns the connection string that Mattermost should use.
 */
export async function createOrgDatabase(orgId) {
    const sharedUrl = config.sharedPostgresUrl();
    if (!sharedUrl) {
        throw new Error('SHARED_POSTGRES_URL is required for shared stack mode');
    }

    const dbName = orgDbName(orgId);
    const {user, password, host, port} = parsePostgresUrl(sharedUrl);

    // Connect to the default database to run CREATE DATABASE
    const client = new pg.Client({connectionString: sharedUrl});
    try {
        await client.connect();
        // Check if database already exists
        const check = await client.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [dbName],
        );
        if (check.rows.length === 0) {
            // Database names can't be parameterized; sanitize by allowing only [a-z0-9_]
            if (!/^[a-z0-9_]+$/.test(dbName)) {
                throw new Error(`Invalid database name: ${dbName}`);
            }
            await client.query(`CREATE DATABASE ${dbName}`);
            console.log(`[database] Created database: ${dbName}`);
        } else {
            console.log(`[database] Database already exists: ${dbName}`);
        }
    } finally {
        await client.end();
    }

    // Build the connection string for Mattermost
    return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}?sslmode=disable`;
}

/**
 * Delete an organization's database (for future cleanup/teardown).
 */
export async function deleteOrgDatabase(orgId) {
    const sharedUrl = config.sharedPostgresUrl();
    if (!sharedUrl) {
        throw new Error('SHARED_POSTGRES_URL is required for shared stack mode');
    }

    const dbName = orgDbName(orgId);

    const client = new pg.Client({connectionString: sharedUrl});
    try {
        await client.connect();
        if (!/^[a-z0-9_]+$/.test(dbName)) {
            throw new Error(`Invalid database name: ${dbName}`);
        }
        await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
        console.log(`[database] Dropped database: ${dbName}`);
    } finally {
        await client.end();
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add provisioning-api/src/database.js
git commit -m "feat: add database.js for shared postgres database management"
```

---

### Task 4: Add shared Postgres provisioning mode to `railway.js`

**Files:**
- Modify: `provisioning-api/src/railway.js`

- [ ] **Step 1: Add `configureMattermostSharedPostgres` function**

Add this function after `configureMattermostSqlite` (around line 228) in `provisioning-api/src/railway.js`:

```js
// Mattermost with shared Postgres — connection string points to pre-existing shared server.
async function configureMattermostSharedPostgres(projectId, serviceId, environmentId, siteUrl, datasource) {
    await railwayQuery(
        `mutation($input: VariableCollectionUpsertInput!) {
            variableCollectionUpsert(input: $input)
        }`,
        {
            input: {
                projectId,
                serviceId,
                environmentId,
                variables: {
                    MM_SQLSETTINGS_DRIVERNAME: 'postgres',
                    MM_SQLSETTINGS_DATASOURCE: datasource,
                    MM_SERVICESETTINGS_SITEURL: siteUrl,
                    MM_SERVICESETTINGS_LISTENADDRESS: ':8065',
                    MM_SERVICESETTINGS_ENABLELOCALMODE: 'true',
                    MM_PLUGINSETTINGS_ENABLEUPLOADS: 'true',
                    MM_PLUGINSETTINGS_ENABLE: 'true',
                    MM_BLEVESETTINGS_INDEXDIR: '/mattermost/bleve-indexes',
                    PORT: '8065',
                    ...OPEN_ACCESS_VARS,
                },
            },
        },
    );
}
```

- [ ] **Step 2: Add `provisionMattermostSharedPostgres` function**

Add this function after `provisionMattermostSqliteOnly` (around line 535) in `provisioning-api/src/railway.js`:

```js
/** Mattermost service only — connects to shared Postgres (fast provisioning). */
async function provisionMattermostSharedPostgres(orgName, datasource) {
    console.log(`[railway] Creating project for org: ${orgName}`);
    const {projectId, environmentId} = await createProject(orgName);

    console.log(`[railway] Creating Mattermost service (shared Postgres)...`);
    const mattermostId = await createMattermost(projectId);

    // Get domain BEFORE configuring so SITEURL is correct on first boot
    const domain = await exposeService(projectId, mattermostId, environmentId);
    const serverUrl = domain ? `https://${domain}` : null;
    console.log(`[railway] Assigned domain: ${domain}`);

    await configureMattermostSharedPostgres(projectId, mattermostId, environmentId, serverUrl, datasource);

    console.log(`[railway] Deploying Mattermost...`);
    await deployService(mattermostId, environmentId);

    // Wait for Mattermost to boot and complete initial setup
    if (serverUrl) {
        await setupMattermost(serverUrl, orgName);
    }

    console.log(`[railway] Provisioned (shared postgres): ${serverUrl}`);

    return {
        projectId,
        environmentId,
        postgresServiceId: null,
        mattermostServiceId: mattermostId,
        serverUrl,
    };
}
```

- [ ] **Step 3: Update `provisionOrganization` to support `shared` mode**

Replace the `provisionOrganization` export at the bottom of `provisioning-api/src/railway.js` with:

```js
export async function provisionOrganization(orgName, options = {}) {
    const mode = config.railwayStackMode();
    if (mode === 'shared') {
        if (!options.datasource) {
            throw new Error('datasource is required for shared stack mode');
        }
        console.log('[railway] Stack mode: shared (Mattermost + shared Postgres — one service)');
        return provisionMattermostSharedPostgres(orgName, options.datasource);
    }
    if (mode === 'full') {
        console.log('[railway] Stack mode: full (Postgres + Mattermost — two services)');
        return provisionPostgresAndMattermost(orgName);
    }
    if (mode !== 'lite') {
        console.warn(`[railway] Unknown OLI_RAILWAY_STACK_MODE="${mode}", using lite`);
    }
    console.log(
        '[railway] Stack mode: lite (Mattermost + SQLite — one service). Set OLI_RAILWAY_STACK_MODE=full for Postgres.',
    );
    return provisionMattermostSqliteOnly(orgName);
}
```

- [ ] **Step 4: Commit**

```bash
git add provisioning-api/src/railway.js
git commit -m "feat: add shared postgres provisioning mode to railway.js"
```

---

### Task 5: Update `index.js` to use shared Postgres flow

**Files:**
- Modify: `provisioning-api/src/index.js`

- [ ] **Step 1: Add database import**

Add the import at the top of `provisioning-api/src/index.js`, after the existing imports:

```js
import {createOrgDatabase} from './database.js';
import config from './config.js';
```

Note: `config` is already imported indirectly but we need it directly now.

- [ ] **Step 2: Update `provisionInBackground` to create org database when in shared mode**

Replace the `provisionInBackground` function in `provisioning-api/src/index.js` with:

```js
async function provisionInBackground(orgId, orgName) {
    try {
        const options = {};

        // In shared mode, create the org's database first
        if (config.railwayStackMode() === 'shared') {
            console.log(`[provision] Creating database for org "${orgName}"...`);
            options.datasource = await createOrgDatabase(orgId);
            console.log(`[provision] Database created for org "${orgName}"`);
        }

        const result = await provisionOrganization(orgName, options);

        await updateOrganization(orgId, {
            server_url: result.serverUrl,
            railway_project_id: result.projectId,
            status: 'ready',
            db_mode: config.railwayStackMode() === 'shared' ? 'shared' : 'dedicated',
        });

        console.log(`[provision] Org "${orgName}" is ready at ${result.serverUrl}`);
    } catch (err) {
        console.error(`[provision] Failed for org "${orgName}":`, err);
        if (err instanceof Error && err.stack) {
            console.error(err.stack);
        }

        await updateOrganization(orgId, {
            status: 'failed',
        }).catch((e) => console.error('[provision] Failed to update status:', e));
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add provisioning-api/src/index.js
git commit -m "feat: integrate shared postgres into provisioning flow"
```

---

### Task 6: Add `db_mode` column to Supabase organizations table

**Files:**
- Create: `provisioning-api/migrations/001_add_db_mode.sql` (reference SQL, run manually in Supabase)

- [ ] **Step 1: Create migration SQL file**

Create `provisioning-api/migrations/001_add_db_mode.sql`:

```sql
-- Add db_mode column to track which database mode each organization uses.
-- 'dedicated' = legacy orgs with their own Postgres/SQLite Railway service
-- 'shared'    = new orgs using the shared Postgres server

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS db_mode text NOT NULL DEFAULT 'dedicated';

-- Set existing orgs to 'dedicated' (they already have their own databases)
UPDATE organizations SET db_mode = 'dedicated' WHERE db_mode = 'dedicated';

COMMENT ON COLUMN organizations.db_mode IS 'Database mode: dedicated (own Postgres/SQLite) or shared (shared Postgres server)';
```

- [ ] **Step 2: Run the migration in Supabase**

Go to the Supabase dashboard SQL Editor and execute the SQL above. Alternatively:

```bash
# If you have the Supabase CLI configured:
# psql "$SUPABASE_DB_URL" -f provisioning-api/migrations/001_add_db_mode.sql
```

- [ ] **Step 3: Commit**

```bash
git add provisioning-api/migrations/001_add_db_mode.sql
git commit -m "feat: add db_mode column migration for organizations table"
```

---

### Task 7: Update Supabase public columns to include `db_mode`

**Files:**
- Modify: `provisioning-api/src/supabase.js`

- [ ] **Step 1: Add `db_mode` to PUBLIC_ORG_COLUMNS**

In `provisioning-api/src/supabase.js`, change line 8 from:

```js
const PUBLIC_ORG_COLUMNS =
    'id, name, created_by, is_private, server_url, railway_project_id, status, created_at, updated_at';
```

to:

```js
const PUBLIC_ORG_COLUMNS =
    'id, name, created_by, is_private, server_url, railway_project_id, status, db_mode, created_at, updated_at';
```

- [ ] **Step 2: Commit**

```bash
git add provisioning-api/src/supabase.js
git commit -m "feat: include db_mode in public organization columns"
```

---

### Task 8: Set environment variables and test

- [ ] **Step 1: Set up the shared Postgres Railway project**

Manually create a Railway project `oli-shared-postgres` with:
- A Postgres service (image: `ghcr.io/railwayapp-templates/postgres-ssl:16`)
- A persistent volume at `/var/lib/postgresql/data`
- Env vars: `POSTGRES_USER=mmuser`, `POSTGRES_PASSWORD=<secure-password>`, `POSTGRES_DB=postgres`, `PGDATA=/var/lib/postgresql/data/pgdata`
- A public domain (via Railway dashboard: Settings → Networking → Generate Domain)

- [ ] **Step 2: Set environment variables on the provisioning API**

On the Railway service running the provisioning API, add:

```
OLI_RAILWAY_STACK_MODE=shared
SHARED_POSTGRES_URL=postgres://mmuser:<password>@<public-domain>:5432/postgres
```

- [ ] **Step 3: Test org creation**

Create a new organization via the API or the desktop app. Verify:
1. The provisioning API logs show `Creating database for org...` and `Database created`
2. No Postgres Railway service is created in the new project
3. The Mattermost service starts and connects to the shared Postgres
4. The org record in Supabase has `db_mode = 'shared'`
5. Provisioning completes faster than before

- [ ] **Step 4: Verify existing orgs are unaffected**

Confirm existing organizations with `db_mode = 'dedicated'` continue to work normally.
