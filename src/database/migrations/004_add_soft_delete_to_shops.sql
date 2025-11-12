-- Migration: Add soft delete to shops table
-- Date: 2025-11-12
-- Description: Add deleted_at column to enable soft deletes for shops instead of hard deletes

-- Add deleted_at column to shops table
ALTER TABLE shops
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL;

-- Add index for deleted_at for better query performance
CREATE INDEX IF NOT EXISTS idx_shops_deleted_at ON shops(deleted_at);

-- Add comment explaining the field
COMMENT ON COLUMN shops.deleted_at IS 'Timestamp when shop was soft deleted. NULL means shop is active.';
