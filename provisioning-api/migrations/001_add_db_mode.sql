-- Add db_mode column to track which database mode each organization uses.
-- 'dedicated' = legacy orgs with their own Postgres/SQLite Railway service
-- 'shared'    = new orgs using the shared Postgres server

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS db_mode text NOT NULL DEFAULT 'dedicated';

-- Set existing orgs to 'dedicated' (they already have their own databases)
UPDATE organizations SET db_mode = 'dedicated' WHERE db_mode = 'dedicated';

COMMENT ON COLUMN organizations.db_mode IS 'Database mode: dedicated (own Postgres/SQLite) or shared (shared Postgres server)';
