# OLI Provisioning API

API that provisions new OLI organizations on Railway and registers them in Supabase. Designed to run on Railway itself.

## How It Works

```
Desktop App (onboarding)
    │
    ├── GET  /organizations       → lists all orgs from Supabase
    └── POST /organizations       → creates org record in Supabase
                                       then asynchronously:
                                       ├── creates Railway project
                                       ├── creates Postgres service
                                       ├── creates OLI service
                                       ├── wires env vars + deploys
                                       └── updates Supabase with server URL
```

### Provisioning Flow (POST /organizations)

When the desktop app calls `POST /organizations`, the API does the following:

1. **Creates a Supabase record** — Inserts the org into the `organizations` table with `status: "provisioning"` and returns it immediately. The client can start polling `GET /organizations/:id` right away.

2. **Provisions on Railway in the background** — The HTTP response doesn't wait for this. It runs 6 Railway GraphQL API calls in sequence:

   - **Create a project** — `projectCreate` with name `oli-{orgName}`. Returns a `projectId` and a default `environmentId` (production).
   - **Create Postgres service** — `serviceCreate` with the `postgres-ssl:16` image, then sets env vars (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).
   - **Create OLI service** — `serviceCreate` with the `OLI_MATTERMOST_IMAGE`. Wires it to Postgres using Railway's reference variable syntax (`${{serviceId.VAR_NAME}}`) so `MM_SQLSETTINGS_DATASOURCE` points to the Postgres service's internal hostname.
   - **Expose OLI publicly** — `serviceDomainCreate` assigns a `*.up.railway.app` domain.
   - **Deploy both services** — `serviceInstanceDeployV2` for Postgres first, then OLI.
   - **Fetch the public domain** — After deploy, queries `domains { serviceDomains { domain } }` (with `projectId`, `environmentId`, `serviceId`) to read the `*.up.railway.app` hostname.

3. **Updates Supabase** — Writes `server_url` and `railway_project_id` back to the org record and sets `status: "ready"`. If anything failed, sets `status: "failed"` instead.

The desktop app polls `GET /organizations/:id` and connects to `server_url` once `status` is `"ready"`.

---

## Deployment on Railway

### Step 1: Create the Supabase table

Go to your Supabase project → **SQL Editor** → run:

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text not null,
  is_private boolean default false,
  password text,                   -- plaintext, null = no password
  server_url text,
  railway_project_id text,
  status text not null default 'provisioning',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_organizations_status on organizations(status);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger organizations_updated_at
  before update on organizations
  for each row execute function update_updated_at();
```

### Step 2: Push the Docker image

From the `provisioning-api/` directory:

```bash
# Build
docker build -t ghcr.io/YOUR_ORG/oli-provisioning-api:latest .

# Login to GHCR (use a GitHub PAT with write:packages scope)
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Push
docker push ghcr.io/YOUR_ORG/oli-provisioning-api:latest
```

### Step 3: Create the service on Railway

1. Go to your Railway dashboard → **New Project** → **Empty Project**
2. Click **+ New** → **Docker Image** → enter `ghcr.io/YOUR_ORG/oli-provisioning-api:latest`
3. Go to the service → **Settings** → **Networking** → **Generate Domain** (this gives you the public URL)

### Step 4: Set environment variables on Railway

Go to the service → **Variables** tab → add these:

| Variable | Value | Where to find it |
|---|---|---|
| `RAILWAY_API_TOKEN` | `your-token` | [railway.com/account/tokens](https://railway.com/account/tokens) — create a token with permission to create projects |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | Supabase → Settings → API → `service_role` secret key (NOT the anon key) |
| `OLI_MATTERMOST_IMAGE` | `docker.io/vosv/oli-mattermost:latest` | OLI image Railway deploys per org (Docker Hub or GHCR path; must match what you pushed) |
| `OLI_RAILWAY_STACK_MODE` | `lite` (default) or `full` | **`lite`** = one service (OLI + **SQLite**) — fits Railway **free** tier. **`full`** = Postgres + OLI (**two services**) — needs a plan that allows both. |
| `PORT` | `3002` | Railway will also set its own PORT — the app uses whichever is available |

Railway auto-deploys after you save the variables.

### Step 5: Push the OLI OLI image

This is the image that gets deployed for each new organization. Build it from the existing Dockerfile:

```bash
cd mattermost-plugin-issues

# Docker Hub (example)
docker build -t vosv/oli-mattermost:latest .
docker push vosv/oli-mattermost:latest
# Set OLI_MATTERMOST_IMAGE=docker.io/vosv/oli-mattermost:latest on the provisioning API service.

# Or GHCR
docker build -t ghcr.io/YOUR_ORG/oli-mattermost:latest .
docker push ghcr.io/YOUR_ORG/oli-mattermost:latest
```

Make sure `OLI_MATTERMOST_IMAGE` in step 4 matches the registry and tag you pushed.

> If the registry is private, you'll need to configure Railway's registry credentials under Project Settings → Integrations.

---

## Verify It's Running

Once deployed, hit the health endpoint:

```bash
curl https://YOUR-SERVICE.up.railway.app/health
# → {"status":"ok"}
```

List organizations:

```bash
curl https://YOUR-SERVICE.up.railway.app/organizations
# → []
```

Create one:

```bash
curl -X POST https://YOUR-SERVICE.up.railway.app/organizations \
  -H "Content-Type: application/json" \
  -d '{"name": "test-org", "created_by": "you@email.com"}'
```

Then poll `GET /organizations/:id` until `status` is `"ready"`.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{"status":"ok"}` |
| `GET` | `/organizations` | List all organizations |
| `GET` | `/organizations/:id` | Get one organization by ID |
| `POST` | `/organizations` | Create org + provision infra (async) |
| `POST` | `/organizations/:id/join` | Check password for a private org |

### POST /organizations body

```json
{
  "name": "My Company",
  "created_by": "user-id-or-email",
  "is_private": false,
  "password": "optional-org-password"
}
```

If `password` is provided, `is_private` is automatically set to `true`.

### POST /organizations/:id/join body

```json
{
  "password": "the-org-password"
}
```

Returns the org if the password matches. Returns `401` if wrong.
```

### Organization statuses

| Status | Meaning |
|---|---|
| `provisioning` | Railway infra is being created (takes ~1-2 min) |
| `ready` | OLI server is live, `server_url` is populated |
| `failed` | Provisioning failed — check API logs on Railway |

### Troubleshooting

- **Supabase vs Railway:** Supabase only stores the **organizations** table (names, status, URLs). Each provisioned org gets a **new Railway project** with **Postgres + OLI** services. The “Postgres” tile on the Railway canvas is **not** Supabase.
- **Postgres crash loop — wrong volume path:** If logs say the volume is not mounted at `/var/lib/postgresql/data`, the API must call Railway’s **`volumeCreate`** for the Postgres service before deploy (the provisioning code does this). Redeploy the provisioning API after pulling that fix.
- **Only Postgres, no OLI:** The script stops if an earlier step errors (e.g. `variableCollectionUpsert`). Check **oli-provisioning-api** logs on Railway for the stack trace; fix Postgres first, then re-create the org or delete the stuck Railway project and try again.
- **`variableCollectionUpsert` / “Problem processing request”:** Railway expects **`projectId`** in the upsert input (not only `serviceId` + `environmentId`). The provisioning code passes all three. Do not use dashboard-only `{{secret(n)}}` strings in API payloads; use a normal generated secret value instead.
- **Postgres `initdb: directory exists but is not empty` / `lost+found`:** The volume is mounted at `/var/lib/postgresql/data`, which often contains `lost+found`. The API sets **`PGDATA=/var/lib/postgresql/data/pgdata`** so the cluster initializes in a subdirectory. Redeploy the provisioning API if you still see the old error.
- **OLI service never created — `Free plan resource provision limit exceeded` on `serviceCreate`:** Railway **free** tier often blocks a **second** service in the same project (Postgres already counts as one). Use **`OLI_RAILWAY_STACK_MODE=lite`** (default): one OLI service with **SQLite** + one volume. Use **`full`** only when your plan allows Postgres **and** OLI as separate services.

---

## What the Next Agent Needs to Do

Wire the OLI desktop app onboarding screen to this API:

1. Replace the hardcoded server in `src/common/config/buildConfig.ts` — remove the `defaultServers` entry and set `enableServerManagement: true`
2. On app launch, `GET /organizations` from this API and display the list
3. "Create Organization" button → `POST /organizations` → show a loading state → poll until `ready` → connect to `server_url`
4. "Join Organization" → user picks from the list → connect to its `server_url`

The provisioning API URL should be stored as a build config constant (similar to how `defaultServers` works now) so it can be changed per environment.

---

## Local Development

```bash
cd provisioning-api
npm install
cp .env.example .env   # fill in your tokens
npm run dev             # http://localhost:3002
```

---

## Railway Requirements

- **Paid plan** (Hobby $5/mo or Pro) — free tier cannot create multiple projects via API
- The API token must have permission to create projects in your workspace
- Each "Create Organization" provisions 1 Railway project with 2 services (Postgres + OLI), so costs scale per org
