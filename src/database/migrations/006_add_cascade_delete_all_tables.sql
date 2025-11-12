-- Migration: Add CASCADE delete to ALL foreign key constraints
-- Date: 2025-11-12
-- Description: Update all foreign key constraints across all tables to CASCADE delete

-- SHOPS REFERENCES
-- Already handled in migration 005

-- USERS REFERENCES (CASCADE where appropriate, SET NULL for shop ownership)
ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_shop_id_fkey,
ADD CONSTRAINT users_shop_id_fkey
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL;

-- CONTENT REFERENCES
ALTER TABLE content
DROP CONSTRAINT IF EXISTS content_uploaded_by_fkey,
ADD CONSTRAINT content_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE content
DROP CONSTRAINT IF EXISTS content_designed_by_fkey,
ADD CONSTRAINT content_designed_by_fkey
  FOREIGN KEY (designed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE content
DROP CONSTRAINT IF EXISTS content_reviewed_by_fkey,
ADD CONSTRAINT content_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE content
DROP CONSTRAINT IF EXISTS content_published_by_fkey,
ADD CONSTRAINT content_published_by_fkey
  FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL;

-- SCREENS REFERENCES
ALTER TABLE screens
DROP CONSTRAINT IF EXISTS screens_size_inches_fkey,
ADD CONSTRAINT screens_size_inches_fkey
  FOREIGN KEY (size_inches) REFERENCES screen_sizes(size_inches) ON DELETE SET NULL;

ALTER TABLE screens
DROP CONSTRAINT IF EXISTS screens_screen_type_id_fkey,
ADD CONSTRAINT screens_screen_type_id_fkey
  FOREIGN KEY (screen_type_id) REFERENCES screen_types(id) ON DELETE SET NULL;

ALTER TABLE screens
DROP CONSTRAINT IF EXISTS screens_current_content_id_fkey,
ADD CONSTRAINT screens_current_content_id_fkey
  FOREIGN KEY (current_content_id) REFERENCES content(id) ON DELETE SET NULL;

-- PLAYLISTS REFERENCES
ALTER TABLE playlists
DROP CONSTRAINT IF EXISTS playlists_created_by_fkey,
ADD CONSTRAINT playlists_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

-- SCREEN_PLAYLISTS REFERENCES
ALTER TABLE screen_playlists
DROP CONSTRAINT IF EXISTS screen_playlists_screen_id_fkey,
ADD CONSTRAINT screen_playlists_screen_id_fkey
  FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE CASCADE;

ALTER TABLE screen_playlists
DROP CONSTRAINT IF EXISTS screen_playlists_playlist_id_fkey,
ADD CONSTRAINT screen_playlists_playlist_id_fkey
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE;

-- SCREEN_REQUESTS REFERENCES
ALTER TABLE screen_requests
DROP CONSTRAINT IF EXISTS screen_requests_requested_by_fkey,
ADD CONSTRAINT screen_requests_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE screen_requests
DROP CONSTRAINT IF EXISTS screen_requests_screen_type_id_fkey,
ADD CONSTRAINT screen_requests_screen_type_id_fkey
  FOREIGN KEY (screen_type_id) REFERENCES screen_types(id) ON DELETE CASCADE;

ALTER TABLE screen_requests
DROP CONSTRAINT IF EXISTS screen_requests_transaction_id_fkey,
ADD CONSTRAINT screen_requests_transaction_id_fkey
  FOREIGN KEY (transaction_id) REFERENCES credit_transactions(id) ON DELETE SET NULL;

ALTER TABLE screen_requests
DROP CONSTRAINT IF EXISTS screen_requests_reviewed_by_fkey,
ADD CONSTRAINT screen_requests_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE screen_requests
DROP CONSTRAINT IF EXISTS screen_requests_screen_id_fkey,
ADD CONSTRAINT screen_requests_screen_id_fkey
  FOREIGN KEY (screen_id) REFERENCES screens(id) ON DELETE SET NULL;

-- NOTIFICATIONS REFERENCES
ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_user_id_fkey,
ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- SUPPORT_TICKETS REFERENCES
-- Note: created_by and assigned_to columns don't exist in current database
-- These will be added if/when the schema is updated

-- TICKET_MESSAGES REFERENCES (actual table name in database)
-- Note: ticket_messages table structure may vary - only updating if constraints exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ticket_messages') THEN
        -- Add CASCADE for ticket_messages if foreign keys exist
        IF EXISTS (SELECT 1 FROM information_schema.table_constraints
                   WHERE constraint_name = 'ticket_messages_ticket_id_fkey') THEN
            ALTER TABLE ticket_messages
            DROP CONSTRAINT ticket_messages_ticket_id_fkey,
            ADD CONSTRAINT ticket_messages_ticket_id_fkey
              FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE;
        END IF;
    END IF;
END $$;

-- SALES_COMMISSIONS REFERENCES
ALTER TABLE sales_commissions
DROP CONSTRAINT IF EXISTS sales_commissions_sales_user_id_fkey,
ADD CONSTRAINT sales_commissions_sales_user_id_fkey
  FOREIGN KEY (sales_user_id) REFERENCES users(id) ON DELETE CASCADE;

-- SHOPS OWNER/REGISTERED/DESIGNER/APPROVED REFERENCES (SET NULL to preserve shop data)
ALTER TABLE shops
DROP CONSTRAINT IF EXISTS shops_owner_id_fkey,
ADD CONSTRAINT shops_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE shops
DROP CONSTRAINT IF EXISTS shops_registered_by_fkey,
ADD CONSTRAINT shops_registered_by_fkey
  FOREIGN KEY (registered_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE shops
DROP CONSTRAINT IF EXISTS shops_designer_id_fkey,
ADD CONSTRAINT shops_designer_id_fkey
  FOREIGN KEY (designer_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE shops
DROP CONSTRAINT IF EXISTS shops_approved_by_fkey,
ADD CONSTRAINT shops_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
