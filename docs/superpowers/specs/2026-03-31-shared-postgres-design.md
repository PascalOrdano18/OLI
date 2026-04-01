# Shared Postgres Database for Multi-Org Provisioning

## Problem

Creating an organization is slow because the provisioning API spins up a dedicated Railway Postgres service (with volume, env vars, deployment, and health check) per org. This adds 1-2+ minutes to provisioning time.

## Solution

Replace per-org Postgres provisioning with a single shared Postgres server on Railway. Each org gets its own logical database (`CREATE DATABASE`) on the shared server. Mattermost instances remain separate Railway services but all connect to the shared Postgres host.

## Architecture

### Shared Postgres Server

- A single Railway project (`oli-shared-postgres`) hosts one Postgres service with a persistent volume.
- Provisioned once manually, not by the provisioning API.
- Shared credentials: all Mattermost instances use the same Postgres user.

### Org Creation Flow (New)

1. Create org record in Supabase with status `"provisioning"` (unchanged).
2. Connect to shared Postgres, run `CREATE DATABASE org_<sanitized_org_id>`.
3. Create Mattermost Railway service (unchanged).
4. Configure Mattermost env vars with `MM_SQLSETTINGS_DATASOURCE` pointing to the shared Postgres host and the org-specific database name.
5. Deploy Mattermost, health check, admin setup (unchanged).

### What Gets Removed

- `serviceCreate` for Postgres per org
- `volumeCreate` for Postgres per org
- Postgres env var configuration per org
- `serviceInstanceDeployV2` for Postgres per org
- Waiting for Postgres to become healthy

### What Stays

- Mattermost service creation per org
- Domain assignment, env var config, deployment, health check, admin setup

## Provisioning API Changes

### New Dependency

- `pg` npm package for direct Postgres connection.

### New Config

- `SHARED_POSTGRES_URL` — Connection string to the shared Postgres server (admin user with `CREATEDB` privilege).

### New File: `provisioning-api/src/database.js`

- `createOrgDatabase(orgId)` — Runs `CREATE DATABASE`, returns connection string for that database.
- `deleteOrgDatabase(orgId)` — For future cleanup/teardown.

### Changes to `provisioning-api/src/railway.js`

- Remove or stop calling `createPostgresService()` and `attachPostgresVolume()`.
- Modify `provisionOrganization()` to call `createOrgDatabase()` instead of Postgres service creation.
- Update Mattermost env var config to use a constructed connection string instead of Railway reference syntax (`${{postgres.VAR}}`).

## Connection String

**Current (Railway references):**
```
postgres://${{postgres.POSTGRES_USER}}:${{postgres.POSTGRES_PASSWORD}}@${{postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/${{postgres.POSTGRES_DB}}?sslmode=disable
```

**New (direct string):**
```
postgres://mmuser:<shared_password>@<shared_postgres_host>:5432/org_<sanitized_org_id>?sslmode=disable
```

- Host, user, and password come from `SHARED_POSTGRES_URL` config.
- Database name derived from org UUID (hyphens replaced with underscores): `org_550e8400_e29b_41d4_a716_446655440000`.
- Mattermost's `MM_SQLSETTINGS_DATASOURCE` gets this string directly.

**Networking:** The shared Postgres and per-org Mattermost services live in different Railway projects. The shared Postgres service must expose a public domain (via `serviceDomainCreate`) so that Mattermost instances in other Railway projects can reach it. The connection string uses this public domain.

## Migration & Rollback

### Existing Organizations

No migration. Existing orgs keep their dedicated Postgres services.

### New Organizations

All newly created orgs use the shared Postgres.

### Supabase Schema Change

Add `db_mode` column to the `organizations` table:
- Values: `'dedicated'` (existing orgs) or `'shared'` (new orgs).
- Default: `'shared'`.

### Rollback Plan

Flip the provisioning API back to the old code path (create per-org Postgres services). The `db_mode` column identifies which orgs use which approach.

### Future Cleanup (Optional)

Migrate existing dedicated-DB orgs to the shared Postgres by dump/restore, then decommission their Railway Postgres services.
