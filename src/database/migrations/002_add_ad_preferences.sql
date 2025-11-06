-- Migration: Add outside ad preferences for shops
-- This allows shop owners to control third-party ads and select ad categories

-- Add ad preference columns to shops table
ALTER TABLE shops
ADD COLUMN IF NOT EXISTS allow_outside_ads BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS blocked_ad_categories TEXT[] DEFAULT '{}';

-- Create index for faster ad preference queries
CREATE INDEX IF NOT EXISTS idx_shops_allow_outside_ads ON shops(allow_outside_ads);

-- Insert default ad categories into system_settings
INSERT INTO system_settings (setting_key, setting_value, description)
VALUES
  ('available_ad_categories', '["Food & Beverages", "Fashion & Apparel", "Electronics & Technology", "Health & Beauty", "Automotive", "Home & Garden", "Entertainment", "Travel & Tourism", "Financial Services", "Education", "Real Estate", "Sports & Fitness"]', 'Available ad categories for shop owners to choose from')
ON CONFLICT (setting_key) DO NOTHING;
