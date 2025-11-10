-- Migration: Add VAT number to shops table
-- Date: 2025-11-10
-- Description: Add VAT number field for UK tax compliance on invoices

-- Add VAT number column to shops table
ALTER TABLE shops
ADD COLUMN IF NOT EXISTS vat_number VARCHAR(50);

-- Add index for VAT number lookups
CREATE INDEX IF NOT EXISTS idx_shops_vat_number ON shops(vat_number);

-- Add comment explaining the field
COMMENT ON COLUMN shops.vat_number IS 'UK VAT registration number for tax purposes (optional)';
