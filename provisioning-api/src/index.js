// OLI Provisioning API
// Creates OLI organizations on Railway and registers them in Supabase

import cors from 'cors';
import express from 'express';

import config from './config.js';
import {createOrgDatabase} from './database.js';
import {provisionOrganization} from './railway.js';
import {
    createOrganization,
    updateOrganization,
    listAllOrganizations,
    getOrganization,
    getOrganizationWithPassword,
} from './supabase.js';

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
    res.json({status: 'ok'});
});

// GET /organizations — list all orgs (for onboarding screen)
app.get('/organizations', async (_req, res) => {
    try {
        const orgs = await listAllOrganizations();
        res.json(orgs);
    } catch (err) {
        console.error('[GET /organizations]', err);
        res.status(500).json({error: err.message});
    }
});

// GET /organizations/:id — get a single org
app.get('/organizations/:id', async (req, res) => {
    try {
        const org = await getOrganization(req.params.id);
        res.json(org);
    } catch (err) {
        console.error('[GET /organizations/:id]', err);
        res.status(404).json({error: err.message});
    }
});

// POST /organizations — create a new org and provision infrastructure
//
// Body: { name: string, created_by: string, is_private?: boolean, password?: string }
//
// This endpoint:
// 1. Creates a Supabase record with status "provisioning"
// 2. Provisions OLI + Postgres on Railway
// 3. Updates the record with the server URL and status "ready"
app.post('/organizations', async (req, res) => {
    const {name, created_by, is_private, password} = req.body;

    if (!name || !created_by) {
        return res.status(400).json({error: 'name and created_by are required'});
    }

    try {
        const org = await createOrganization({
            name,
            createdBy: created_by,
            isPrivate: is_private || Boolean(password),
            password: password || null,
            serverUrl: null,
            railwayProjectId: null,
        });

        provisionInBackground(org.id, name);

        res.status(201).json(org);
    } catch (err) {
        console.error('[POST /organizations]', err);
        res.status(500).json({error: err.message});
    }
});

// POST /organizations/:id/join — check password for a private org
//
// Body: { password: string }
app.post('/organizations/:id/join', async (req, res) => {
    try {
        const org = await getOrganizationWithPassword(req.params.id);

        if (org.password) {
            const {password} = req.body || {};
            if (password !== org.password) {
                return res.status(401).json({error: 'Incorrect password'});
            }
        }

        res.json(await getOrganization(req.params.id));
    } catch (err) {
        console.error('[POST /organizations/:id/join]', err);
        res.status(404).json({error: err.message});
    }
});

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

app.listen(config.port, () => {
    console.log(`OLI Provisioning API listening on port ${config.port}`);
});
