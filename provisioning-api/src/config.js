// Configuration — all values come from environment variables

const required = (name) => {
    const val = process.env[name];
    if (!val) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return val;
};

const config = {
    port: process.env.PORT || 3002,
    railwayApiToken: () => required('RAILWAY_API_TOKEN'),
    supabaseUrl: () => required('SUPABASE_URL'),
    supabaseServiceKey: () => required('SUPABASE_SERVICE_KEY'),
    oliOLIImage: () =>
        process.env.OLI_MATTERMOST_IMAGE || 'docker.io/vosv/oli-mattermost:latest',
    /**
     * Railway free tier usually allows only one *service* per new project before upgrades.
     * - lite: one OLI container + SQLite + one volume (works on free tier)
     * - full: Postgres service + OLI service (needs a plan that allows 2+ services per project)
     */
    railwayStackMode: () => (process.env.OLI_RAILWAY_STACK_MODE || 'lite').toLowerCase(),
    sharedPostgresUrl: () => process.env.SHARED_POSTGRES_URL || null,

    // Shared AI service — all orgs use the same hosted instance
    aiServiceUrl: () => required('OLI_AI_SERVICE_URL'),
    aiServiceSecret: () => required('OLI_AI_SERVICE_SECRET'),
    openaiApiKey: () => required('OLI_OPENAI_API_KEY'),
};

export default config;
