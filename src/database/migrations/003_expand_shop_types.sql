-- Expand shop type options for better categorization
-- First, we need to alter the existing enum type

-- Store existing data temporarily
ALTER TABLE shops ALTER COLUMN shop_type DROP DEFAULT;
ALTER TABLE shops ALTER COLUMN shop_type TYPE VARCHAR(50) USING shop_type::text;

-- Drop the old enum (CASCADE to handle dependencies)
DROP TYPE IF EXISTS shop_type CASCADE;

-- Create new enum with expanded options
CREATE TYPE shop_type AS ENUM (
  'supermarket',
  'convenience',
  'phone_shop',
  'electronics',
  'clothing',
  'restaurant',
  'pizza',
  'takeaway',
  'cafe',
  'bar',
  'hotel',
  'salon',
  'barber',
  'gym',
  'pharmacy',
  'clinic',
  'office',
  'retail',
  'other'
);

-- Convert back to enum
ALTER TABLE shops ALTER COLUMN shop_type TYPE shop_type USING shop_type::shop_type;

-- Set default for new shops
ALTER TABLE shops ALTER COLUMN shop_type SET DEFAULT 'retail';

-- Update any 'retail' shops that might be more specific (optional)
-- This would be done based on shop names in production
-- UPDATE shops SET shop_type = 'supermarket' WHERE LOWER(name) LIKE '%supermarket%';
-- UPDATE shops SET shop_type = 'phone_shop' WHERE LOWER(name) LIKE '%phone%' OR LOWER(name) LIKE '%mobile%';