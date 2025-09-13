-- Ivaa AdSync Database Migration v2.0
-- Complete system overhaul with 4-role system
-- This will DROP ALL EXISTING DATA and create fresh tables

-- ============================================
-- STEP 1: BACKUP REMINDER
-- ============================================
-- IMPORTANT: Run this command first to backup your data:
-- pg_dump -U postgres -d ivaa_adsync > backup_before_migration.sql

-- ============================================
-- STEP 2: CLEAN SLATE - DROP EVERYTHING
-- ============================================
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- ============================================
-- CORE TABLES
-- ============================================

-- 1. Users with 4 roles
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'owner', 'design', 'sales')),
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Shops with approval workflow
CREATE TABLE shops (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,

    -- Approval workflow
    approval_status VARCHAR(20) DEFAULT 'pending'
        CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    registered_by INTEGER REFERENCES users(id), -- Sales team
    designer_id INTEGER REFERENCES users(id), -- Assigned designer
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    rejection_reason TEXT,

    -- Basic info
    address TEXT,
    city VARCHAR(100),
    postcode VARCHAR(20),
    phone VARCHAR(50),
    shop_type VARCHAR(50) DEFAULT 'retail',

    -- Billing
    subscription_status VARCHAR(20) DEFAULT 'pending',
    free_content_reset_date DATE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Screen pricing configuration
CREATE TABLE screen_sizes (
    id SERIAL PRIMARY KEY,
    size_inches INTEGER UNIQUE NOT NULL,
    monthly_fee DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default sizes
INSERT INTO screen_sizes (size_inches, monthly_fee) VALUES
    (32, 10.00),
    (43, 15.00),
    (55, 20.00);

-- 4. Screens with pricing
CREATE TABLE screens (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    device_id VARCHAR(255) UNIQUE,
    location VARCHAR(100),
    size_inches INTEGER REFERENCES screen_sizes(size_inches),
    monthly_fee DECIMAL(10,2),
    status VARCHAR(20) DEFAULT 'offline',
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Content with complete workflow
CREATE TABLE content (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,

    -- Upload by owner
    uploaded_by INTEGER REFERENCES users(id),
    original_filename VARCHAR(255),
    file_url VARCHAR(500),
    file_type VARCHAR(20),

    -- Design by designer
    designed_by INTEGER REFERENCES users(id),
    designed_at TIMESTAMP,
    designed_file_url VARCHAR(500),

    -- Review by admin
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_design', 'designed', 'approved', 'rejected', 'published')),
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    rejection_reason TEXT,

    -- Publish by designer
    published_by INTEGER REFERENCES users(id),
    published_at TIMESTAMP,

    -- Billing
    is_extra_upload BOOLEAN DEFAULT false,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Playlists (Designer only)
CREATE TABLE playlists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id), -- Must be designer/admin
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Playlist items
CREATE TABLE playlist_items (
    id SERIAL PRIMARY KEY,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    content_id INTEGER REFERENCES content(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    duration INTEGER DEFAULT 10
);

-- 8. Screen playlist assignment
CREATE TABLE screen_playlists (
    id SERIAL PRIMARY KEY,
    screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(screen_id)
);

-- 9. Notifications
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. Sales commissions
CREATE TABLE sales_commissions (
    id SERIAL PRIMARY KEY,
    sales_user_id INTEGER REFERENCES users(id),
    shop_id INTEGER REFERENCES shops(id),
    commission_type VARCHAR(20),
    amount DECIMAL(10,2),
    status VARCHAR(20) DEFAULT 'pending',
    month DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. Invoices (simplified)
CREATE TABLE invoices (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    screen_fees DECIMAL(10,2) DEFAULT 0,
    extra_content_fees DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    due_date DATE,
    paid_at TIMESTAMP,
    billing_period_start DATE,
    billing_period_end DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. System settings
CREATE TABLE system_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT
);

INSERT INTO system_settings (setting_key, setting_value, description) VALUES
    ('currency_symbol', '£', 'Currency symbol'),
    ('free_uploads_per_month', '1', 'Free content uploads per shop per month'),
    ('extra_upload_price', '3.00', 'Price for each extra upload'),
    ('commission_percentage', '10', 'Sales team commission percentage');

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_shops_owner ON shops(owner_id);
CREATE INDEX idx_shops_designer ON shops(designer_id);
CREATE INDEX idx_shops_approval ON shops(approval_status);
CREATE INDEX idx_screens_shop ON screens(shop_id);
CREATE INDEX idx_content_shop ON content(shop_id);
CREATE INDEX idx_content_status ON content(status);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_invoices_shop ON invoices(shop_id);

-- ============================================
-- INITIAL DATA
-- ============================================
-- Default admin (password: admin123)
INSERT INTO users (email, password_hash, full_name, role) VALUES
    ('admin@ivaa.com', '$2a$10$YourHashHere', 'System Admin', 'admin');

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
SELECT 'Migration completed successfully!' as status,
       COUNT(*) as tables_created
FROM information_schema.tables
WHERE table_schema = 'public';