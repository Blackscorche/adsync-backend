-- Migration to remove terms-related fields from shops table
-- These fields are not needed as terms acceptance is handled at login only

-- Remove terms_accepted column from shops table
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name='shops' AND column_name='terms_accepted') THEN
        ALTER TABLE shops DROP COLUMN terms_accepted;
    END IF;
END $$;

-- Remove terms_accepted_date column from shops table
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name='shops' AND column_name='terms_accepted_date') THEN
        ALTER TABLE shops DROP COLUMN terms_accepted_date;
    END IF;
END $$;

-- Remove terms_accepted_by column from shops table
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name='shops' AND column_name='terms_accepted_by') THEN
        ALTER TABLE shops DROP COLUMN terms_accepted_by;
    END IF;
END $$;

COMMIT;