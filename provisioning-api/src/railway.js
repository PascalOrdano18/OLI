// Railway GraphQL API client — provisions Mattermost + Postgres projects

import crypto from 'node:crypto';

import config from './config.js';

const RAILWAY_API = 'https://backboard.railway.com/graphql/v2';

async function railwayQuery(query, variables = {}) {
    const res = await fetch(RAILWAY_API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.railwayApiToken()}`,
        },
        body: JSON.stringify({query, variables}),
    });

    const json = await res.json();
    if (json.errors) {
        throw new Error(`Railway API error: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
}

// Step 1: Create a new Railway project for this organization
async function createProject(orgName) {
    const data = await railwayQuery(
        `mutation($input: ProjectCreateInput!) {
            projectCreate(input: $input) {
                id
                name
                environments { edges { node { id name } } }
            }
        }`,
        {input: {name: `oli-${orgName}`}},
    );

    const project = data.projectCreate;
    const prodEnv = project.environments.edges[0]?.node;

    return {
        projectId: project.id,
        environmentId: prodEnv.id,
    };
}

// Step 2: Create the Postgres service
async function createPostgres(projectId) {
    const data = await railwayQuery(
        `mutation($input: ServiceCreateInput!) {
            serviceCreate(input: $input) { id name }
        }`,
        {
            input: {
                projectId,
                name: 'Postgres',
                source: {image: 'ghcr.io/railwayapp-templates/postgres-ssl:16'},
            },
        },
    );

    return data.serviceCreate.id;
}

// Persistent volume for Mattermost + SQLite (single-service stack). Mount root may contain
// lost+found; keep DB under mmdata/.
async function attachMattermostVolume(projectId, environmentId, serviceId) {
    await railwayQuery(
        `mutation($input: VolumeCreateInput!) {
            volumeCreate(input: $input) {
                id
                name
            }
        }`,
        {
            input: {
                projectId,
                environmentId,
                serviceId,
                mountPath: '/var/lib/mattermost',
            },
        },
    );
}

// Step 2b: Persistent volume — required for image-based Postgres. Without it, the container
// crash-loops: "volume not mounted to the correct path ... expected /var/lib/postgresql/data".
async function attachPostgresVolume(projectId, environmentId, serviceId) {
    await railwayQuery(
        `mutation($input: VolumeCreateInput!) {
            volumeCreate(input: $input) {
                id
                name
            }
        }`,
        {
            input: {
                projectId,
                environmentId,
                serviceId,
                mountPath: '/var/lib/postgresql/data',
            },
        },
    );
}

// Step 3: Set Postgres env vars (projectId is required by Railway's variableCollectionUpsert API)
function randomDbPassword() {
    return crypto.randomBytes(24).toString('base64url');
}

async function configurePostgres(projectId, serviceId, environmentId) {
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
                    POSTGRES_USER: 'mmuser',
                    // Dashboard supports {{secret(n)}}; the GraphQL API often rejects it ("Problem processing request").
                    POSTGRES_PASSWORD: randomDbPassword(),
                    POSTGRES_DB: 'mattermost',
                    // Volume is mounted at /var/lib/postgresql/data; ext4 adds lost+found there, so initdb
                    // fails with "directory exists but is not empty". Use a subdirectory for the cluster.
                    PGDATA: '/var/lib/postgresql/data/pgdata',
                },
            },
        },
    );
}

// Step 4: Create the Mattermost service (Docker Hub: docker.io/owner/repo:tag; GHCR: ghcr.io/...)
async function createMattermost(projectId) {
    const image = config.oliMattermostImage();
    console.log(`[railway] Mattermost image: ${image}`);
    const data = await railwayQuery(
        `mutation($input: ServiceCreateInput!) {
            serviceCreate(input: $input) { id name }
        }`,
        {
            input: {
                projectId,
                name: 'Mattermost',
                source: {image},
            },
        },
    );

    return data.serviceCreate.id;
}

// Shared Mattermost env vars for open signup and relaxed security
const OPEN_ACCESS_VARS = {
    MM_TEAMSETTINGS_ENABLEOPENSERVER: 'true',
    MM_EMAILSETTINGS_ENABLESIGNUPWITHEMAIL: 'true',
    MM_EMAILSETTINGS_ENABLESIGNINWITHEMAIL: 'true',
    MM_EMAILSETTINGS_REQUIREEMAILVERIFICATION: 'false',
    MM_PASSWORDSETTINGS_MINIMUMLENGTH: '5',
    MM_SERVICESETTINGS_ALLOWCORSFROM: '*',
    MM_SERVICESETTINGS_ENABLEOPENTRACING: 'false',
    MM_SERVICESETTINGS_ALLOWEDUNTRUSTEDINTERNALCONNECTIONS: '',
    MM_TEAMSETTINGS_ENABLEUSERACCESS: 'true',
};

// Step 5: Configure Mattermost env vars and wire to Postgres
async function configureMattermost(projectId, serviceId, environmentId, postgresServiceId, siteUrl) {
    // Railway reference variables use ${{service.VAR}} syntax
    const pgRef = (v) => `\${{${postgresServiceId}.${v}}}`;

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
                    MM_SQLSETTINGS_DATASOURCE: `postgres://${pgRef('POSTGRES_USER')}:${pgRef('POSTGRES_PASSWORD')}@${pgRef('RAILWAY_PRIVATE_DOMAIN')}:5432/${pgRef('POSTGRES_DB')}?sslmode=disable`,
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

// Mattermost with SQLite — one Railway service only (fits free-tier limits).
async function configureMattermostSqlite(projectId, serviceId, environmentId, siteUrl) {
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
                    MM_SQLSETTINGS_DRIVERNAME: 'sqlite3',
                    MM_SQLSETTINGS_DATASOURCE:
                        'file:/var/lib/mattermost/mmdata/mattermost.db?mode=rwc&cache=shared',
                    MM_SERVICESETTINGS_SITEURL: siteUrl,
                    MM_SERVICESETTINGS_LISTENADDRESS: ':8065',
                    MM_SERVICESETTINGS_ENABLELOCALMODE: 'true',
                    MM_PLUGINSETTINGS_ENABLEUPLOADS: 'true',
                    MM_PLUGINSETTINGS_ENABLE: 'true',
                    MM_BLEVESETTINGS_INDEXDIR: '/var/lib/mattermost/mmdata/bleve-indexes',
                    PORT: '8065',
                    ...OPEN_ACCESS_VARS,
                },
            },
        },
    );
}

// Step 6: Expose Mattermost publicly (targetPort matches Mattermost HTTP listener)
async function exposeService(_projectId, serviceId, environmentId) {
    const data = await railwayQuery(
        `mutation($input: ServiceDomainCreateInput!) {
            serviceDomainCreate(input: $input) {
                domain
                id
            }
        }`,
        {
            input: {
                serviceId,
                environmentId,
                targetPort: 8065,
            },
        },
    );
    return data.serviceDomainCreate?.domain ?? null;
}

// Step 7: Deploy both services
async function deployService(serviceId, environmentId) {
    await railwayQuery(
        `mutation($serviceId: String!, $environmentId: String!) {
            serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
        }`,
        {serviceId, environmentId},
    );
}

// Step 8: Read public hostname after deploy (root `serviceDomains` was removed; use `domains` + projectId)
async function getPublicDomain(projectId, serviceId, environmentId) {
    const data = await railwayQuery(
        `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
            domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
                serviceDomains {
                    domain
                }
            }
        }`,
        {projectId, environmentId, serviceId},
    );

    const list = data.domains?.serviceDomains;
    return list?.[0]?.domain ?? null;
}

// Wait for the Mattermost server to be reachable, then complete initial setup
// (create admin user + default team) so the desktop app sees a login page, not the setup wizard.
async function setupMattermost(serverUrl, orgName) {
    console.log(`[setup] Waiting for Mattermost at ${serverUrl} to be reachable...`);

    // Poll until the server responds
    const maxAttempts = 60; // 5 minutes at 5s intervals
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await fetch(`${serverUrl}/api/v4/system/ping`);
            if (res.ok) {
                console.log(`[setup] Mattermost is reachable (attempt ${i + 1})`);
                break;
            }
        } catch {
            // not ready yet
        }
        if (i === maxAttempts - 1) {
            console.error('[setup] Mattermost never became reachable, skipping setup');
            return;
        }
        await new Promise((r) => setTimeout(r, 5000));
    }

    // Small extra delay for the server to fully initialize
    await new Promise((r) => setTimeout(r, 3000));

    // Create the first admin user
    const adminEmail = `admin@${orgName.toLowerCase().replace(/[^a-z0-9]/g, '')}.oli.app`;
    const adminPassword = 'OliAdmin123!';
    const adminUsername = 'admin';

    try {
        console.log(`[setup] Creating admin user: ${adminEmail}`);
        const userRes = await fetch(`${serverUrl}/api/v4/users`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                email: adminEmail,
                username: adminUsername,
                password: adminPassword,
            }),
        });

        if (!userRes.ok) {
            const body = await userRes.text();
            console.error(`[setup] Failed to create admin user: ${userRes.status} ${body}`);
            return;
        }

        const adminUser = await userRes.json();
        console.log(`[setup] Admin user created: ${adminUser.id}`);

        // Login to get a token
        const loginRes = await fetch(`${serverUrl}/api/v4/users/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                login_id: adminEmail,
                password: adminPassword,
            }),
        });

        if (!loginRes.ok) {
            console.error(`[setup] Failed to login: ${loginRes.status}`);
            return;
        }

        const token = loginRes.headers.get('token');
        console.log(`[setup] Logged in as admin`);

        // Create a default team
        const teamName = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 60) || 'default';
        const teamRes = await fetch(`${serverUrl}/api/v4/teams`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                name: teamName,
                display_name: orgName,
                type: 'O', // open team, anyone can join
            }),
        });

        if (!teamRes.ok) {
            const body = await teamRes.text();
            console.error(`[setup] Failed to create team: ${teamRes.status} ${body}`);
            return;
        }

        console.log(`[setup] Default team "${orgName}" created`);
        console.log(`[setup] Mattermost setup complete. Users can now sign up with email/password.`);
    } catch (err) {
        console.error(`[setup] Error during Mattermost setup:`, err);
    }
}

/** Postgres + Mattermost (two services). Requires Railway plan that allows both. */
async function provisionPostgresAndMattermost(orgName) {
    console.log(`[railway] Creating project for org: ${orgName}`);
    const {projectId, environmentId} = await createProject(orgName);

    console.log(`[railway] Creating Postgres service...`);
    const postgresId = await createPostgres(projectId);
    console.log(`[railway] Attaching Postgres volume at /var/lib/postgresql/data...`);
    await attachPostgresVolume(projectId, environmentId, postgresId);
    await configurePostgres(projectId, postgresId, environmentId);

    console.log(`[railway] Creating Mattermost service...`);
    const mattermostId = await createMattermost(projectId);

    // Get domain BEFORE configuring so SITEURL is correct on first boot
    const domain = await exposeService(projectId, mattermostId, environmentId);
    const serverUrl = domain ? `https://${domain}` : null;
    console.log(`[railway] Assigned domain: ${domain}`);

    await configureMattermost(projectId, mattermostId, environmentId, postgresId, serverUrl);

    console.log(`[railway] Deploying services...`);
    await deployService(postgresId, environmentId);
    await deployService(mattermostId, environmentId);

    // Wait for Mattermost to boot and complete initial setup
    if (serverUrl) {
        await setupMattermost(serverUrl, orgName);
    }

    console.log(`[railway] Provisioned: ${serverUrl}`);

    return {
        projectId,
        environmentId,
        postgresServiceId: postgresId,
        mattermostServiceId: mattermostId,
        serverUrl,
    };
}

/** One Mattermost service + SQLite + volume — fits Railway free-tier service limits. */
async function provisionMattermostSqliteOnly(orgName) {
    console.log(`[railway] Creating project for org: ${orgName}`);
    const {projectId, environmentId} = await createProject(orgName);

    console.log(`[railway] Creating Mattermost service (SQLite, single service)...`);
    const mattermostId = await createMattermost(projectId);
    console.log(`[railway] Attaching Mattermost data volume at /var/lib/mattermost...`);
    await attachMattermostVolume(projectId, environmentId, mattermostId);

    // Get domain BEFORE configuring so SITEURL is correct on first boot
    const domain = await exposeService(projectId, mattermostId, environmentId);
    const serverUrl = domain ? `https://${domain}` : null;
    console.log(`[railway] Assigned domain: ${domain}`);

    await configureMattermostSqlite(projectId, mattermostId, environmentId, serverUrl);

    console.log(`[railway] Deploying Mattermost...`);
    await deployService(mattermostId, environmentId);

    console.log(`[railway] Provisioned (lite): ${serverUrl}`);

    return {
        projectId,
        environmentId,
        postgresServiceId: null,
        mattermostServiceId: mattermostId,
        serverUrl,
    };
}

export async function provisionOrganization(orgName) {
    const mode = config.railwayStackMode();
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
