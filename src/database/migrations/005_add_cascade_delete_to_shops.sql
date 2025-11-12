-- Migration: Add CASCADE delete to all foreign keys referencing shops
-- Date: 2025-11-12
-- Description: Update all foreign key constraints to CASCADE delete when shop is deleted

-- Drop and recreate foreign key constraints with CASCADE

-- 1. content.shop_id
ALTER TABLE content
DROP CONSTRAINT IF EXISTS content_shop_id_fkey,
ADD CONSTRAINT content_shop_id_fkey
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;

-- 2. screens.shop_id
ALTER TABLE screens
DROP CONSTRAINT IF EXISTS screens_shop_id_fkey,
ADD CONSTRAINT screens_shop_id_fkey
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;

-- 3. playlists.shop_id
ALTER TABLE playlists
DROP CONSTRAINT IF EXISTS playlists_shop_id_fkey,
ADD CONSTRAINT playlists_shop_id_fkey
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;

-- 4. invoices.shop_id (already has reference, add CASCADE)
ALTER TABLE invoices
DROP CONSTRAINT IF EXISTS invoices_shop_id_fkey,
ADD CONSTRAINT invoices_shop_id_fkey
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;

-- 5. support_tickets.shop_id
ALTER TABLE support_tickets
DROP CONSTRAINT IF EXISTS support_tickets_shop_id_fkey,
ADD CONSTRAINT support_tickets_shop_id_fkey
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;

-- 6. screen_requests.shop_id
ALTER TABLE screen_requests
DROP CONSTRAINT IF EXISTS screen_requests_shop_id_fkey,
ADD CONSTRAINT screen_requests_shop_id_fkey
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;

-- Note: credit_transactions, billing, and sales_commissions already have ON DELETE CASCADE
-- Note: users.shop_id should be SET NULL, not CASCADE (handled separately in delete endpoint)

-- Add comment
COMMENT ON CONSTRAINT content_shop_id_fkey ON content IS 'Cascade delete content when shop is deleted';
COMMENT ON CONSTRAINT screens_shop_id_fkey ON screens IS 'Cascade delete screens when shop is deleted';
COMMENT ON CONSTRAINT playlists_shop_id_fkey ON playlists IS 'Cascade delete playlists when shop is deleted';
COMMENT ON CONSTRAINT invoices_shop_id_fkey ON invoices IS 'Cascade delete invoices when shop is deleted';
COMMENT ON CONSTRAINT support_tickets_shop_id_fkey ON support_tickets IS 'Cascade delete support tickets when shop is deleted';
COMMENT ON CONSTRAINT screen_requests_shop_id_fkey ON screen_requests IS 'Cascade delete screen requests when shop is deleted';
