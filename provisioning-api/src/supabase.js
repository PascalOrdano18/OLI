// Supabase client — organization registry

import {createClient} from '@supabase/supabase-js';

import config from './config.js';

/** Columns returned to clients (never includes `password`). */
const PUBLIC_ORG_COLUMNS =
    'id, name, created_by, is_private, server_url, railway_project_id, status, created_at, updated_at';

let client;
function getClient() {
    if (!client) {
        client = createClient(config.supabaseUrl(), config.supabaseServiceKey());
    }
    return client;
}

// Create a new organization record
export async function createOrganization({name, createdBy, isPrivate, password, serverUrl, railwayProjectId}) {
    const {data, error} = await getClient()
        .from('organizations')
        .insert({
            name,
            created_by: createdBy,
            is_private: isPrivate ?? false,
            password: password ?? null,
            server_url: serverUrl,
            railway_project_id: railwayProjectId,
            status: serverUrl ? 'ready' : 'provisioning',
        })
        .select(PUBLIC_ORG_COLUMNS)
        .single();

    if (error) {
        throw new Error(`Supabase insert error: ${error.message}`);
    }
    return data;
}

// Update an organization (e.g. set server_url once provisioning completes)
export async function updateOrganization(id, fields) {
    const {data, error} = await getClient()
        .from('organizations')
        .update(fields)
        .eq('id', id)
        .select(PUBLIC_ORG_COLUMNS)
        .single();

    if (error) {
        throw new Error(`Supabase update error: ${error.message}`);
    }
    return data;
}

// List ALL organizations (for the onboarding screen)
export async function listAllOrganizations() {
    const {data, error} = await getClient()
        .from('organizations')
        .select('id, name, is_private, server_url, status, created_at')
        .order('created_at', {ascending: false});

    if (error) {
        throw new Error(`Supabase query error: ${error.message}`);
    }
    return data;
}

// Get a single organization by ID (public fields only — no password)
export async function getOrganization(id) {
    const {data, error} = await getClient()
        .from('organizations')
        .select(PUBLIC_ORG_COLUMNS)
        .eq('id', id)
        .single();

    if (error) {
        throw new Error(`Supabase query error: ${error.message}`);
    }
    return data;
}

// Internal: includes password — use only for POST /join verification, never return raw to client
export async function getOrganizationWithPassword(id) {
    const {data, error} = await getClient()
        .from('organizations')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        throw new Error(`Supabase query error: ${error.message}`);
    }
    return data;
}
