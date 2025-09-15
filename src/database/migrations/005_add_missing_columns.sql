-- Migration: Add missing columns to existing tables
-- This migration adds columns that are referenced in the code but missing from the database

-- terms_accepted column removed - handled at login only

-- Add any other missing columns that might be needed
-- Add commission_rate to shops if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='shops' AND column_name='commission_rate') THEN
    ALTER TABLE shops ADD COLUMN commission_rate DECIMAL(5,2) DEFAULT 10.00;
  END IF;
END $$;

-- Add is_active to users if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='users' AND column_name='is_active') THEN
    ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
  END IF;
END $$;

-- Add screen size pricing columns to shops if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='shops' AND column_name='screen_32_price') THEN
    ALTER TABLE shops ADD COLUMN screen_32_price DECIMAL(10,2) DEFAULT 15.00;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='shops' AND column_name='screen_43_price') THEN
    ALTER TABLE shops ADD COLUMN screen_43_price DECIMAL(10,2) DEFAULT 20.00;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='shops' AND column_name='screen_55_price') THEN
    ALTER TABLE shops ADD COLUMN screen_55_price DECIMAL(10,2) DEFAULT 25.00;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='shops' AND column_name='screen_32_count') THEN
    ALTER TABLE shops ADD COLUMN screen_32_count INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='shops' AND column_name='screen_43_count') THEN
    ALTER TABLE shops ADD COLUMN screen_43_count INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='shops' AND column_name='screen_55_count') THEN
    ALTER TABLE shops ADD COLUMN screen_55_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add subscription_status to shops if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='shops' AND column_name='subscription_status') THEN
    ALTER TABLE shops ADD COLUMN subscription_status VARCHAR(20) DEFAULT 'trial';
  END IF;
END $$;

-- Add trial_ends_at to shops if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='shops' AND column_name='trial_ends_at') THEN
    ALTER TABLE shops ADD COLUMN trial_ends_at DATE DEFAULT (CURRENT_DATE + INTERVAL '30 days');
  END IF;
END $$;

-- Add photo_url to shops if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='shops' AND column_name='photo_url') THEN
    ALTER TABLE shops ADD COLUMN photo_url VARCHAR(500);
  END IF;
END $$;

-- Add content_type to content table if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='content' AND column_name='content_type') THEN
    ALTER TABLE content ADD COLUMN content_type VARCHAR(50);
  END IF;
END $$;

-- Add duration to content table if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='content' AND column_name='duration') THEN
    ALTER TABLE content ADD COLUMN duration INTEGER DEFAULT 30;
  END IF;
END $$;

-- Add title and description to content table if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='content' AND column_name='title') THEN
    ALTER TABLE content ADD COLUMN title VARCHAR(255);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='content' AND column_name='description') THEN
    ALTER TABLE content ADD COLUMN description TEXT;
  END IF;
END $$;

-- Add playlist_id to screens table if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='screens' AND column_name='playlist_id') THEN
    ALTER TABLE screens ADD COLUMN playlist_id INTEGER REFERENCES playlists(id);
  END IF;
END $$;

-- Add size column to screens table if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='screens' AND column_name='size') THEN
    ALTER TABLE screens ADD COLUMN size VARCHAR(10);
  END IF;
END $$;

-- Add device_id to screens table if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='screens' AND column_name='device_id') THEN
    ALTER TABLE screens ADD COLUMN device_id VARCHAR(100) UNIQUE;
  END IF;
END $$;

-- Add payment related columns to bills if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bills' AND column_name='payment_intent_id') THEN
    ALTER TABLE bills ADD COLUMN payment_intent_id VARCHAR(255);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='bills' AND column_name='payment_reference') THEN
    ALTER TABLE bills ADD COLUMN payment_reference VARCHAR(255);
  END IF;
END $$;

-- terms_accepted comment removed
COMMENT ON COLUMN shops.commission_rate IS 'Commission rate for sales person';
COMMENT ON COLUMN shops.subscription_status IS 'Current subscription status (trial, active, suspended, cancelled)';
COMMENT ON COLUMN shops.trial_ends_at IS 'Date when free trial ends';