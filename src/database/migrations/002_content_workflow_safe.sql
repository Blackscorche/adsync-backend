-- ============================================
-- SAFE MIGRATION: Add Content Workflow Fields
-- This migration safely updates existing database without data loss
-- ============================================

BEGIN;

-- 1. Add new columns if they don't exist
DO $$
BEGIN
    -- Add designed_by column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='designed_by') THEN
        ALTER TABLE content ADD COLUMN designed_by INTEGER REFERENCES users(id);
        RAISE NOTICE 'Added column: designed_by';
    ELSE
        RAISE NOTICE 'Column already exists: designed_by';
    END IF;

    -- Add designed_at column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='designed_at') THEN
        ALTER TABLE content ADD COLUMN designed_at TIMESTAMP;
        RAISE NOTICE 'Added column: designed_at';
    ELSE
        RAISE NOTICE 'Column already exists: designed_at';
    END IF;

    -- Add designed_file_url column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='designed_file_url') THEN
        ALTER TABLE content ADD COLUMN designed_file_url VARCHAR(500);
        RAISE NOTICE 'Added column: designed_file_url';
    ELSE
        RAISE NOTICE 'Column already exists: designed_file_url';
    END IF;

    -- Add published_by column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='published_by') THEN
        ALTER TABLE content ADD COLUMN published_by INTEGER REFERENCES users(id);
        RAISE NOTICE 'Added column: published_by';
    ELSE
        RAISE NOTICE 'Column already exists: published_by';
    END IF;

    -- Add published_at column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='published_at') THEN
        ALTER TABLE content ADD COLUMN published_at TIMESTAMP;
        RAISE NOTICE 'Added column: published_at';
    ELSE
        RAISE NOTICE 'Column already exists: published_at';
    END IF;

    -- Add original_filename if missing (rename from filename if exists)
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='content' AND column_name='filename') THEN
        -- Rename filename to original_filename
        ALTER TABLE content RENAME COLUMN filename TO original_filename;
        RAISE NOTICE 'Renamed column: filename -> original_filename';
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name='content' AND column_name='original_filename') THEN
        -- Add original_filename if neither exists
        ALTER TABLE content ADD COLUMN original_filename VARCHAR(255);
        RAISE NOTICE 'Added column: original_filename';
    ELSE
        RAISE NOTICE 'Column already exists: original_filename';
    END IF;

    -- Add file_type if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='file_type') THEN
        ALTER TABLE content ADD COLUMN file_type VARCHAR(20);
        -- Try to infer file type from existing file_url
        UPDATE content
        SET file_type = CASE
            WHEN file_url ILIKE '%.mp4' OR file_url ILIKE '%.avi' OR file_url ILIKE '%.mov' THEN 'video'
            WHEN file_url ILIKE '%.pdf' THEN 'pdf'
            ELSE 'image'
        END
        WHERE file_type IS NULL;
        RAISE NOTICE 'Added column: file_type';
    ELSE
        RAISE NOTICE 'Column already exists: file_type';
    END IF;

    -- Add file_size if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='file_size') THEN
        ALTER TABLE content ADD COLUMN file_size BIGINT;
        RAISE NOTICE 'Added column: file_size';
    ELSE
        RAISE NOTICE 'Column already exists: file_size';
    END IF;

    -- Add thumbnail_url if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='content' AND column_name='thumbnail_url') THEN
        ALTER TABLE content ADD COLUMN thumbnail_url VARCHAR(500);
        RAISE NOTICE 'Added column: thumbnail_url';
    ELSE
        RAISE NOTICE 'Column already exists: thumbnail_url';
    END IF;
END $$;

-- 2. Update status column constraint
-- First, check current constraint and update if needed
DO $$
DECLARE
    constraint_exists BOOLEAN;
    old_constraint_name TEXT;
BEGIN
    -- Find existing status constraint
    SELECT conname INTO old_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'content'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%';

    IF old_constraint_name IS NOT NULL THEN
        -- Drop old constraint
        EXECUTE 'ALTER TABLE content DROP CONSTRAINT ' || old_constraint_name;
        RAISE NOTICE 'Dropped old constraint: %', old_constraint_name;
    END IF;

    -- Migrate existing status values to new workflow
    -- Map old statuses to new workflow
    UPDATE content SET status =
        CASE
            WHEN status = 'pending_review' THEN 'pending'
            WHEN status = 'under_review' THEN 'in_design'
            WHEN status IN ('active', 'live') THEN 'published'
            ELSE status
        END
    WHERE status NOT IN ('pending', 'in_design', 'designed', 'approved', 'rejected', 'published');

    -- Add new constraint with all workflow statuses
    ALTER TABLE content ADD CONSTRAINT content_status_check
        CHECK (status IN ('pending', 'in_design', 'designed', 'approved', 'rejected', 'published'));
    RAISE NOTICE 'Added new status constraint with workflow states';
END $$;

-- 3. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_content_designed_by ON content(designed_by);
CREATE INDEX IF NOT EXISTS idx_content_published_by ON content(published_by);
CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
CREATE INDEX IF NOT EXISTS idx_content_shop_status ON content(shop_id, status);

-- 4. Add helpful comments
COMMENT ON COLUMN content.status IS 'Content workflow: pending (owner uploaded) -> in_design (designer working) -> designed (awaiting admin review) -> approved/rejected -> published';
COMMENT ON COLUMN content.designed_file_url IS 'URL of the designer-edited version of the content';
COMMENT ON COLUMN content.original_filename IS 'Original filename uploaded by the shop owner';
COMMENT ON COLUMN content.file_url IS 'URL of the original content uploaded by owner';

-- 5. Update existing approved content to be ready for publishing
-- This assumes previously approved content should be publishable
UPDATE content
SET status = 'approved'
WHERE status = 'approved'
  AND published_at IS NULL;

-- 6. Log migration completion
DO $$
DECLARE
    content_count INTEGER;
    pending_count INTEGER;
    approved_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO content_count FROM content;
    SELECT COUNT(*) INTO pending_count FROM content WHERE status = 'pending';
    SELECT COUNT(*) INTO approved_count FROM content WHERE status = 'approved';

    RAISE NOTICE '=========================================';
    RAISE NOTICE 'Migration completed successfully!';
    RAISE NOTICE 'Total content items: %', content_count;
    RAISE NOTICE 'Pending items: %', pending_count;
    RAISE NOTICE 'Approved (ready to publish): %', approved_count;
    RAISE NOTICE '=========================================';
    RAISE NOTICE 'New workflow: pending -> in_design -> designed -> approved -> published';
    RAISE NOTICE '=========================================';
END $$;

COMMIT;

-- Rollback instructions (if needed):
-- BEGIN;
-- ALTER TABLE content DROP COLUMN IF EXISTS designed_by;
-- ALTER TABLE content DROP COLUMN IF EXISTS designed_at;
-- ALTER TABLE content DROP COLUMN IF EXISTS designed_file_url;
-- ALTER TABLE content DROP COLUMN IF EXISTS published_by;
-- ALTER TABLE content DROP COLUMN IF EXISTS published_at;
-- ALTER TABLE content DROP CONSTRAINT IF EXISTS content_status_check;
-- ALTER TABLE content ADD CONSTRAINT content_status_check CHECK (status IN ('pending', 'approved', 'rejected'));
-- COMMIT;