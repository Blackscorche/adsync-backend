ALTER TABLE content
ADD COLUMN IF NOT EXISTS playlist_scope VARCHAR(20) DEFAULT 'none',
ADD COLUMN IF NOT EXISTS playlist_scope_value TEXT;
