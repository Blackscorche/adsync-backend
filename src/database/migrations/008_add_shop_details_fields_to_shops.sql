-- Migration: Add promotion types table
-- Migration: Add promotion types table and shop column
-- Date: 2025-11-12
-- Description: Create a lookup table for different types of promotions and link to shops

CREATE TABLE IF NOT EXISTS promotion_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add shop details columns including promotion, wifi, cable, and display info
ALTER TABLE shops
ADD COLUMN IF NOT EXISTS promotion_type VARCHAR(255),
ADD COLUMN IF NOT EXISTS wifi_connection BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS wifi_distance VARCHAR(255),
ADD COLUMN IF NOT EXISTS cable_support BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cable_length VARCHAR(255),
ADD COLUMN IF NOT EXISTS display_fixed_at VARCHAR(255),
ADD COLUMN IF NOT EXISTS windows_photo_url VARCHAR(500);

-- Insert Values into promotion_types table
INSERT INTO promotion_types (name)
VALUES 
  ('Go Local'),
  ('Go Local Extra'),
  ('Premier'),
  ('Family Shopper'),
  ('Best One'),
  ('One Stop'),
  ('Independent');
