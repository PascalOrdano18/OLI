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
