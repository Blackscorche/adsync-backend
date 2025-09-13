-- Migration to add complete content workflow columns
-- Run this if your content table is missing the designer workflow columns

-- Add missing columns if they don't exist
DO $$
BEGIN
    -- Add designed_by column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='designed_by') THEN
        ALTER TABLE content ADD COLUMN designed_by INTEGER REFERENCES users(id);
    END IF;

    -- Add designed_at column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='designed_at') THEN
        ALTER TABLE content ADD COLUMN designed_at TIMESTAMP;
    END IF;

    -- Add designed_file_url column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='designed_file_url') THEN
        ALTER TABLE content ADD COLUMN designed_file_url VARCHAR(500);
    END IF;

    -- Add published_by column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='published_by') THEN
        ALTER TABLE content ADD COLUMN published_by INTEGER REFERENCES users(id);
    END IF;

    -- Add published_at column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='published_at') THEN
        ALTER TABLE content ADD COLUMN published_at TIMESTAMP;
    END IF;

    -- Rename original columns if needed
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='content' AND column_name='filename') THEN
        ALTER TABLE content RENAME COLUMN filename TO original_filename;
    END IF;
END $$;

-- Update status constraint to include new statuses
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_status_check;
ALTER TABLE content ADD CONSTRAINT content_status_check
    CHECK (status IN ('pending', 'in_design', 'designed', 'approved', 'rejected', 'published'));

-- Add helpful indexes
CREATE INDEX IF NOT EXISTS idx_content_designed_by ON content(designed_by);
CREATE INDEX IF NOT EXISTS idx_content_published_by ON content(published_by);

COMMENT ON COLUMN content.status IS 'Content workflow: pending->in_design->designed->approved->published';