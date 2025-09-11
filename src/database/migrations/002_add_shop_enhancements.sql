-- Add shop type, postcode, and terms acceptance fields to shops table

-- Add shop_type enum (if it doesn't exist)
DO $$ BEGIN
  CREATE TYPE shop_type AS ENUM (
    'retail',
    'restaurant',
    'cafe',
    'bar',
    'hotel',
    'salon',
    'gym',
    'clinic',
    'office',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add new columns to shops table (only necessary ones)
ALTER TABLE shops
ADD COLUMN IF NOT EXISTS shop_type shop_type DEFAULT 'retail',
ADD COLUMN IF NOT EXISTS postcode VARCHAR(10),
ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS terms_accepted_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS terms_accepted_by INTEGER REFERENCES users(id);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_shops_type ON shops(shop_type);
CREATE INDEX IF NOT EXISTS idx_shops_postcode ON shops(postcode);