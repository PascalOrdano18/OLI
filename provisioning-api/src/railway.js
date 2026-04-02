// Railway GraphQL API client — provisions OLI + Postgres projects

import crypto from 'node:crypto';

import config from './config.js';

const RAILWAY_API = 'https://backboard.railway.com/graphql/v2';

async function railwayQuery(query, variables = {}, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const res = await fetch(RAILWAY_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.railwayApiToken()}`,
            },
            body: JSON.stringify({query, variables}),
        });

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            const text = await res.text();
            console.error(`[railway] API returned non-JSON (status ${res.status}, attempt ${attempt}/${retries}): ${text.slice(0, 300)}`);
            if (attempt < retries) {
                const delay = attempt * 2000;
                console.log(`[railway] Retrying in ${delay}ms...`);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            throw new Error(`Railway API returned non-JSON response (status ${res.status})`);
        }

        const json = await res.json();
        if (json.errors) {
            throw new Error(`Railway API error: ${JSON.stringify(json.errors)}`);
        }
        return json.data;
    }
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

// Persistent volume for OLI + SQLite (single-service stack). Mount root may contain
// lost+found; keep DB under mmdata/.
async function attachOLIVolume(projectId, environmentId, serviceId) {
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

// Step 4: Create the OLI service (Docker Hub: docker.io/owner/repo:tag; GHCR: ghcr.io/...)
async function createOLI(projectId) {
    const image = config.oliOLIImage();
    console.log(`[railway] OLI image: ${image}`);
    const data = await railwayQuery(
        `mutation($input: ServiceCreateInput!) {
            serviceCreate(input: $input) { id name }
        }`,
        {
            input: {
                projectId,
                name: 'OLI',
                source: {image},
            },
        },
    );

    return data.serviceCreate.id;
}

// Shared OLI env vars for open signup and relaxed security
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

// Step 5: Configure OLI env vars and wire to Postgres
async function configureOLI(projectId, serviceId, environmentId, postgresServiceId, siteUrl) {
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

// OLI with SQLite — one Railway service only (fits free-tier limits).
async function configureOLISqlite(projectId, serviceId, environmentId, siteUrl) {
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

// OLI with shared Postgres — connection string points to pre-existing shared server.
async function configureOLISharedPostgres(projectId, serviceId, environmentId, siteUrl, datasource) {
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
                    MM_SQLSETTINGS_MAXOPENCONNS: '10',
                    MM_SQLSETTINGS_MAXIDLECONNS: '5',
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

// Step 6: Expose OLI publicly (targetPort matches OLI HTTP listener)
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

// Wait for the OLI server to be reachable, then complete initial setup
// (create admin user + default team) so the desktop app sees a login page, not the setup wizard.
async function setupOLI(serverUrl, orgName) {
    console.log(`[setup] Waiting for OLI at ${serverUrl} to be reachable...`);

    // Require multiple consecutive successful pings before proceeding.
    // On first boot, Postgres may restart (volume checks, init) causing
    // OLI to briefly respond then crash-loop. Requiring consecutive
    // successes ensures the server is truly stable.
    const maxAttempts = 90; // 7.5 minutes at 5s intervals
    const requiredConsecutive = 3;
    let consecutiveOk = 0;

    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await fetch(`${serverUrl}/api/v4/system/ping`);
            if (res.ok) {
                consecutiveOk++;
                console.log(`[setup] OLI ping OK (${consecutiveOk}/${requiredConsecutive}, attempt ${i + 1})`);
                if (consecutiveOk >= requiredConsecutive) {
                    console.log(`[setup] OLI is stable after ${i + 1} attempts`);
                    break;
                }
            } else {
                if (consecutiveOk > 0) {
                    console.log(`[setup] OLI ping failed (resetting consecutive count, attempt ${i + 1})`);
                }
                consecutiveOk = 0;
            }
        } catch {
            if (consecutiveOk > 0) {
                console.log(`[setup] OLI unreachable (resetting consecutive count, attempt ${i + 1})`);
            }
            consecutiveOk = 0;
        }
        if (i === maxAttempts - 1) {
            console.error('[setup] OLI never became stable, skipping setup');
            throw new Error('OLI server never became stable after deployment');
        }
        await new Promise((r) => setTimeout(r, 5000));
    }

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

        // Configure the issues plugin with the shared AI service
        await configurePlugin(serverUrl, token);

        console.log(`[setup] OLI setup complete. Users can now sign up with email/password.`);
    } catch (err) {
        console.error(`[setup] Error during OLI setup:`, err);
    }
}

// Enable the issues plugin and configure it to use the shared AI service.
async function configurePlugin(serverUrl, token) {
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };

    const pluginId = 'com.mattermost.issues';

    // 1. Enable the plugin
    console.log(`[setup] Enabling plugin ${pluginId}...`);
    const enableRes = await fetch(`${serverUrl}/api/v4/plugins/${pluginId}/enable`, {
        method: 'POST',
        headers,
    });
    if (!enableRes.ok) {
        const body = await enableRes.text();
        console.error(`[setup] Failed to enable plugin: ${enableRes.status} ${body}`);
        return;
    }
    console.log(`[setup] Plugin enabled`);

    // Small delay for the plugin to activate
    await new Promise((r) => setTimeout(r, 2000));

    // 2. Set plugin configuration (AIServiceURL, AIServiceSecret, OpenAIAPIKey)
    const aiServiceUrl = config.aiServiceUrl();
    const aiServiceSecret = config.aiServiceSecret();
    const openaiApiKey = config.openaiApiKey();

    console.log(`[setup] Configuring plugin with AI service: ${aiServiceUrl}`);

    // Fetch current plugin config to merge with
    const getRes = await fetch(`${serverUrl}/api/v4/config`, {
        method: 'GET',
        headers,
    });
    if (!getRes.ok) {
        const body = await getRes.text();
        console.error(`[setup] Failed to get server config: ${getRes.status} ${body}`);
        return;
    }
    const serverConfig = await getRes.json();

    // Update plugin settings in the server config
    if (!serverConfig.PluginSettings) {
        serverConfig.PluginSettings = {};
    }
    if (!serverConfig.PluginSettings.Plugins) {
        serverConfig.PluginSettings.Plugins = {};
    }
    serverConfig.PluginSettings.Plugins[pluginId] = {
        aiserviceurl: aiServiceUrl,
        aiservicesecret: aiServiceSecret,
        openaiapikey: openaiApiKey,
    };

    const putRes = await fetch(`${serverUrl}/api/v4/config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(serverConfig),
    });
    if (!putRes.ok) {
        const body = await putRes.text();
        console.error(`[setup] Failed to update plugin config: ${putRes.status} ${body}`);
        return;
    }
    console.log(`[setup] Plugin configured with shared AI service`);
}

/** Postgres + OLI (two services). Requires Railway plan that allows both. */
async function provisionPostgresAndOLI(orgName) {
    console.log(`[railway] Creating project for org: ${orgName}`);
    const {projectId, environmentId} = await createProject(orgName);

    console.log(`[railway] Creating Postgres service...`);
    const postgresId = await createPostgres(projectId);
    console.log(`[railway] Attaching Postgres volume at /var/lib/postgresql/data...`);
    await attachPostgresVolume(projectId, environmentId, postgresId);
    await configurePostgres(projectId, postgresId, environmentId);

    console.log(`[railway] Creating OLI service...`);
    const mattermostId = await createOLI(projectId);

    // Get domain BEFORE configuring so SITEURL is correct on first boot
    const domain = await exposeService(projectId, mattermostId, environmentId);
    const serverUrl = domain ? `https://${domain}` : null;
    console.log(`[railway] Assigned domain: ${domain}`);

    await configureOLI(projectId, mattermostId, environmentId, postgresId, serverUrl);

    console.log(`[railway] Deploying services...`);
    await deployService(postgresId, environmentId);
    await deployService(mattermostId, environmentId);

    // Wait for OLI to boot and complete initial setup
    if (serverUrl) {
        await setupOLI(serverUrl, orgName);
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

/** One OLI service + SQLite + volume — fits Railway free-tier service limits. */
async function provisionOLISqliteOnly(orgName) {
    console.log(`[railway] Creating project for org: ${orgName}`);
    const {projectId, environmentId} = await createProject(orgName);

    console.log(`[railway] Creating OLI service (SQLite, single service)...`);
    const mattermostId = await createOLI(projectId);
    console.log(`[railway] Attaching OLI data volume at /var/lib/mattermost...`);
    await attachOLIVolume(projectId, environmentId, mattermostId);

    // Get domain BEFORE configuring so SITEURL is correct on first boot
    const domain = await exposeService(projectId, mattermostId, environmentId);
    const serverUrl = domain ? `https://${domain}` : null;
    console.log(`[railway] Assigned domain: ${domain}`);

    await configureOLISqlite(projectId, mattermostId, environmentId, serverUrl);

    console.log(`[railway] Deploying OLI...`);
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

/** OLI service only — connects to shared Postgres (fast provisioning). */
async function provisionOLISharedPostgres(orgName, datasource) {
    console.log(`[railway] Creating project for org: ${orgName}`);
    const {projectId, environmentId} = await createProject(orgName);

    console.log(`[railway] Creating OLI service (shared Postgres)...`);
    const mattermostId = await createOLI(projectId);

    // Get domain BEFORE configuring so SITEURL is correct on first boot
    const domain = await exposeService(projectId, mattermostId, environmentId);
    const serverUrl = domain ? `https://${domain}` : null;
    console.log(`[railway] Assigned domain: ${domain}`);

    await configureOLISharedPostgres(projectId, mattermostId, environmentId, serverUrl, datasource);

    console.log(`[railway] Deploying OLI...`);
    await deployService(mattermostId, environmentId);

    // Wait for OLI to boot and complete initial setup
    if (serverUrl) {
        await setupOLI(serverUrl, orgName);
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

export async function provisionOrganization(orgName, options = {}) {
    const mode = config.railwayStackMode();
    if (mode === 'shared') {
        if (!options.datasource) {
            throw new Error('datasource is required for shared stack mode');
        }
        console.log('[railway] Stack mode: shared (OLI + shared Postgres — one service)');
        return provisionOLISharedPostgres(orgName, options.datasource);
    }
    if (mode === 'full') {
        console.log('[railway] Stack mode: full (Postgres + OLI — two services)');
        return provisionPostgresAndOLI(orgName);
    }
    if (mode !== 'lite') {
        console.warn(`[railway] Unknown OLI_RAILWAY_STACK_MODE="${mode}", using lite`);
    }
    console.log(
        '[railway] Stack mode: lite (OLI + SQLite — one service). Set OLI_RAILWAY_STACK_MODE=full for Postgres.',
    );
    return provisionOLISqliteOnly(orgName);
}
