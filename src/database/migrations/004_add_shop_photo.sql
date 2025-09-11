-- Add shop photo field to shops table

ALTER TABLE shops
ADD COLUMN IF NOT EXISTS photo_url TEXT,
ADD COLUMN IF NOT EXISTS photo_uploaded_at TIMESTAMP;

-- Add index for shops with photos
CREATE INDEX IF NOT EXISTS idx_shops_photo ON shops(photo_url) WHERE photo_url IS NOT NULL;