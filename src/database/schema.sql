-- IVAA AdSync Database Schema
-- Complete database setup for production

-- Drop existing tables if they exist (for clean setup)
DROP TABLE IF EXISTS playlist_items CASCADE;
DROP TABLE IF EXISTS playlists CASCADE;
DROP TABLE IF EXISTS support_tickets CASCADE;
DROP TABLE IF EXISTS sales_commissions CASCADE;
DROP TABLE IF EXISTS billing CASCADE;
DROP TABLE IF EXISTS credit_transactions CASCADE;
DROP TABLE IF EXISTS content CASCADE;
DROP TABLE IF EXISTS screens CASCADE;
DROP TABLE IF EXISTS screen_types CASCADE;
DROP TABLE IF EXISTS shops CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;
DROP TABLE IF EXISTS schema_migrations CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS deduct_credit;

-- Create users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'design', 'owner', 'sales')),
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create shops table
CREATE TABLE shops (
    id SERIAL PRIMARY KEY,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    designer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    postcode VARCHAR(20),
    shop_type VARCHAR(50) DEFAULT 'retail',
    photo_url TEXT,
    subscription_status VARCHAR(50) DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'suspended', 'cancelled')),
    approval_status VARCHAR(50) DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    approved_at TIMESTAMP,
    registered_by_name VARCHAR(255),
    credit_balance DECIMAL(10,2) DEFAULT 0.00,
    payment_status VARCHAR(50) DEFAULT 'active',
    free_upload_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create screen_types table
CREATE TABLE screen_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    size_inches INTEGER NOT NULL,
    monthly_price DECIMAL(10, 2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create screens table
CREATE TABLE screens (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    screen_type_id INTEGER REFERENCES screen_types(id),
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    size VARCHAR(20) DEFAULT '32_inch',
    monthly_cost DECIMAL(10,2) DEFAULT 15.00,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create content table
CREATE TABLE content (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    designed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL,
    designed_file_url TEXT,
    file_type VARCHAR(50) NOT NULL,
    file_size INTEGER,
    duration INTEGER,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_design', 'designed', 'approved', 'rejected', 'published')),
    rejection_reason TEXT,
    was_free_upload BOOLEAN DEFAULT FALSE,
    charge_amount DECIMAL(10,2) DEFAULT 0.00,
    designed_at TIMESTAMP,
    reviewed_at TIMESTAMP,
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create playlists table
CREATE TABLE playlists (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    status VARCHAR(50) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create playlist_items table
CREATE TABLE playlist_items (
    id SERIAL PRIMARY KEY,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    content_id INTEGER REFERENCES content(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    duration INTEGER DEFAULT 10,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create support_tickets table
CREATE TABLE support_tickets (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    attachment_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create credit_transactions table
CREATE TABLE credit_transactions (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    reference_id INTEGER,
    balance_before DECIMAL(10,2),
    balance_after DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create billing table
CREATE TABLE billing (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    bill_date DATE NOT NULL,
    due_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    description TEXT,
    paid_at TIMESTAMP,
    payment_method VARCHAR(50),
    stripe_payment_intent_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create sales_commissions table
CREATE TABLE sales_commissions (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    percentage DECIMAL(5,2) NOT NULL,
    base_amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    commission_date DATE DEFAULT CURRENT_DATE,
    status VARCHAR(50) DEFAULT 'pending',
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create system_settings table
CREATE TABLE system_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(255) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create schema_migrations table for tracking
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create deduct_credit function
CREATE OR REPLACE FUNCTION deduct_credit(
    p_shop_id INTEGER,
    p_amount DECIMAL,
    p_type VARCHAR,
    p_description TEXT,
    p_reference_id INTEGER DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_current_balance DECIMAL;
    v_new_balance DECIMAL;
BEGIN
    SELECT credit_balance INTO v_current_balance
    FROM shops WHERE id = p_shop_id FOR UPDATE;

    IF v_current_balance < p_amount THEN
        RETURN FALSE;
    END IF;

    v_new_balance := v_current_balance - p_amount;

    UPDATE shops SET credit_balance = v_new_balance WHERE id = p_shop_id;

    INSERT INTO credit_transactions (
        shop_id, amount, type, description, reference_id,
        balance_before, balance_after
    ) VALUES (
        p_shop_id, -p_amount, p_type, p_description, p_reference_id,
        v_current_balance, v_new_balance
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Insert default screen types
INSERT INTO screen_types (name, size_inches, monthly_price) VALUES
    ('32 inch', 32, 15.00),
    ('43 inch', 43, 20.00),
    ('55 inch', 55, 25.00),
    ('65 inch', 65, 35.00),
    ('75 inch', 75, 45.00);

-- Insert default system settings
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
    ('app_name', 'IVAA AdSync', 'Application name'),
    ('app_version', '1.0.0', 'Application version'),
    ('maintenance_mode', 'false', 'Maintenance mode status'),
    ('commission_percentage', '10', 'Sales commission percentage'),
    ('content_upload_price', '3.00', 'Price for content uploads after free monthly upload'),
    ('content_monthly_price', '1.00', 'Monthly price per content item');

-- Insert default users
INSERT INTO users (email, password, full_name, role) VALUES
    ('admin@ivaamedia.uk', '$2a$10$mBU0f5/hKOl.tM9jLfmjOuHuLnW7hL3z8e9Sb8YQLTcH7WNKhK9RO', 'System Admin', 'admin'),
    ('design@ivaamedia.uk', '$2a$10$mBU0f5/hKOl.tM9jLfmjOuHuLnW7hL3z8e9Sb8YQLTcH7WNKhK9RO', 'Design Team', 'design'),
    ('sales@ivaamedia.uk', '$2a$10$mBU0f5/hKOl.tM9jLfmjOuHuLnW7hL3z8e9Sb8YQLTcH7WNKhK9RO', 'Sales Team', 'sales');

-- Add indexes for performance
CREATE INDEX idx_shops_owner_id ON shops(owner_id);
CREATE INDEX idx_shops_designer_id ON shops(designer_id);
CREATE INDEX idx_screens_shop_id ON screens(shop_id);
CREATE INDEX idx_content_shop_id ON content(shop_id);
CREATE INDEX idx_content_screen_id ON content(screen_id);
CREATE INDEX idx_content_status ON content(status);
CREATE INDEX idx_playlists_shop_id ON playlists(shop_id);
CREATE INDEX idx_playlist_items_playlist_id ON playlist_items(playlist_id);
CREATE INDEX idx_credit_transactions_shop_id ON credit_transactions(shop_id);
CREATE INDEX idx_billing_shop_id ON billing(shop_id);
CREATE INDEX idx_sales_commissions_shop_id ON sales_commissions(shop_id);

-- Record schema version
INSERT INTO schema_migrations (version, name) VALUES (999, 'complete_schema');