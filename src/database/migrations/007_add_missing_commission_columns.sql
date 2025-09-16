-- Migration: Add missing columns to sales_commissions table
-- Date: 2025-01-15

-- Add percentage column to sales_commissions
ALTER TABLE sales_commissions
ADD COLUMN IF NOT EXISTS percentage DECIMAL(5,2) DEFAULT 10.00;

-- Add any other missing columns that might be referenced
-- Update existing records to have default percentage
UPDATE sales_commissions
SET percentage = 10.00
WHERE percentage IS NULL;

-- Add comment to document the column
COMMENT ON COLUMN sales_commissions.percentage IS 'Commission percentage rate (e.g., 10.00 for 10%)';