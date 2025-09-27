-- IVAA AdSync Database Schema
-- Complete database setup for production
-- Based on live database schema as of 2025-09-26

-- Drop existing tables if they exist (for clean setup)
DROP TABLE IF EXISTS ticket_attachments CASCADE;
DROP TABLE IF EXISTS ticket_comments CASCADE;
DROP TABLE IF EXISTS support_tickets CASCADE;
DROP TABLE IF EXISTS screen_playlists CASCADE;
DROP TABLE IF EXISTS playlist_items CASCADE;
DROP TABLE IF EXISTS playlists CASCADE;
DROP TABLE IF EXISTS screen_requests CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS sales_commissions CASCADE;
DROP TABLE IF EXISTS billing CASCADE;
DROP TABLE IF EXISTS credit_transactions CASCADE;
DROP TABLE IF EXISTS content CASCADE;
DROP TABLE IF EXISTS screens CASCADE;
DROP TABLE IF EXISTS screen_types CASCADE;
DROP TABLE IF EXISTS screen_sizes CASCADE;
DROP TABLE IF EXISTS shops CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;
DROP TABLE IF EXISTS migrations CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS deduct_credit;
DROP FUNCTION IF EXISTS update_updated_at_column;
DROP FUNCTION IF EXISTS auto_expire_screen_requests;

-- Create users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    shop_id INTEGER
);

-- Create shops table
CREATE TABLE shops (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id INTEGER REFERENCES users(id),
    approval_status VARCHAR(20) DEFAULT 'pending',
    registered_by INTEGER REFERENCES users(id),
    designer_id INTEGER REFERENCES users(id),
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    address TEXT,
    city VARCHAR(100),
    postcode VARCHAR(20),
    phone VARCHAR(50),
    shop_type VARCHAR(50) DEFAULT 'retail',
    subscription_status VARCHAR(20) DEFAULT 'pending',
    free_content_reset_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    photo_url VARCHAR(500),
    commission_rate NUMERIC DEFAULT 10.00,
    credit_balance NUMERIC DEFAULT 0.00,
    payment_status VARCHAR(50) DEFAULT 'active',
    free_upload_used BOOLEAN DEFAULT false
);

-- Add foreign key constraint for users.shop_id after shops table is created
ALTER TABLE users ADD CONSTRAINT users_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES shops(id);

-- Create screen_sizes table
CREATE TABLE screen_sizes (
    id SERIAL PRIMARY KEY,
    size_inches INTEGER UNIQUE NOT NULL,
    monthly_fee NUMERIC NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create screen_types table
CREATE TABLE screen_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    size_inches INTEGER NOT NULL,
    monthly_price NUMERIC NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create content table
CREATE TABLE content (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id),
    uploaded_by INTEGER REFERENCES users(id),
    original_filename VARCHAR(255),
    file_url VARCHAR(500),
    file_type VARCHAR(20),
    designed_by INTEGER REFERENCES users(id),
    designed_at TIMESTAMP,
    designed_file_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    rejection_reason TEXT,
    published_by INTEGER REFERENCES users(id),
    published_at TIMESTAMP,
    is_extra_upload BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    was_free_upload BOOLEAN DEFAULT false,
    charge_amount NUMERIC DEFAULT 0.00
);

-- Create screens table
CREATE TABLE screens (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id),
    name VARCHAR(255) NOT NULL,
    device_id VARCHAR(255) UNIQUE,
    location VARCHAR(100),
    size_inches INTEGER REFERENCES screen_sizes(size_inches),
    monthly_fee NUMERIC,
    status VARCHAR(20) DEFAULT 'offline',
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    size VARCHAR(20) DEFAULT '32_inch',
    monthly_cost NUMERIC DEFAULT 15.00,
    screen_type_id INTEGER REFERENCES screen_types(id),
    current_content_id INTEGER REFERENCES content(id)
);

-- Create playlists table
CREATE TABLE playlists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    shop_id INTEGER REFERENCES shops(id),
    created_by INTEGER REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'draft',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create playlist_items table
CREATE TABLE playlist_items (
    id SERIAL PRIMARY KEY,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    content_id INTEGER REFERENCES content(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    duration INTEGER DEFAULT 10
);

-- Create screen_playlists table
CREATE TABLE screen_playlists (
    id SERIAL PRIMARY KEY,
    screen_id INTEGER UNIQUE REFERENCES screens(id),
    playlist_id INTEGER REFERENCES playlists(id),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create credit_transactions table
CREATE TABLE credit_transactions (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    type VARCHAR(50) NOT NULL,
    description TEXT,
    reference_id INTEGER,
    balance_before NUMERIC,
    balance_after NUMERIC,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create billing table
CREATE TABLE billing (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    bill_date DATE NOT NULL,
    due_date DATE NOT NULL,
    amount NUMERIC NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    description TEXT,
    paid_at TIMESTAMP,
    payment_method VARCHAR(50),
    stripe_payment_intent_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    invoice_number VARCHAR(50),
    billing_month DATE,
    total_amount NUMERIC
);

-- Create invoices table
CREATE TABLE invoices (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    screen_fees NUMERIC DEFAULT 0,
    extra_content_fees NUMERIC DEFAULT 0,
    total_amount NUMERIC NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    due_date DATE,
    paid_at TIMESTAMP,
    billing_period_start DATE,
    billing_period_end DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create sales_commissions table
CREATE TABLE sales_commissions (
    id SERIAL PRIMARY KEY,
    sales_user_id INTEGER REFERENCES users(id),
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    commission_type VARCHAR(20),
    amount NUMERIC,
    status VARCHAR(20) DEFAULT 'pending',
    month DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    percentage NUMERIC DEFAULT 10.00,
    description TEXT
);

-- Create screen_requests table
CREATE TABLE screen_requests (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL REFERENCES shops(id),
    requested_by INTEGER NOT NULL REFERENCES users(id),
    screen_name VARCHAR(255) NOT NULL,
    location VARCHAR(100),
    screen_type_id INTEGER NOT NULL REFERENCES screen_types(id),
    monthly_cost NUMERIC NOT NULL,
    payment_amount NUMERIC NOT NULL,
    transaction_id INTEGER REFERENCES credit_transactions(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    device_id VARCHAR(100),
    rejection_reason TEXT,
    expires_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '2 days'),
    screen_id INTEGER REFERENCES screens(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create notifications table
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create support_tickets table
CREATE TABLE support_tickets (
    id SERIAL PRIMARY KEY,
    ticket_number VARCHAR(50) UNIQUE NOT NULL,
    shop_id INTEGER REFERENCES shops(id),
    created_by INTEGER REFERENCES users(id),
    assigned_to INTEGER REFERENCES users(id),
    category VARCHAR(50) NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium',
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'open',
    -- Screen request fields
    screen_size VARCHAR(20),
    screen_quantity INTEGER,
    installation_address TEXT,
    preferred_installation_date DATE,
    -- Content request fields
    content_type VARCHAR(50),
    play_duration INTEGER,
    target_screens TEXT[],
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create ticket_comments table
CREATE TABLE ticket_comments (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER REFERENCES support_tickets(id),
    user_id INTEGER REFERENCES users(id),
    comment TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create ticket_attachments table
CREATE TABLE ticket_attachments (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER REFERENCES support_tickets(id),
    comment_id INTEGER REFERENCES ticket_comments(id),
    filename VARCHAR(255) NOT NULL,
    file_url VARCHAR(500) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create system_settings table
CREATE TABLE system_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    description TEXT
);

-- Create migrations table for tracking
CREATE TABLE migrations (
    version INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create schema_migrations table for migration system compatibility
CREATE TABLE schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create deduct_credit function
CREATE OR REPLACE FUNCTION deduct_credit(
    p_shop_id INTEGER,
    p_amount NUMERIC,
    p_type VARCHAR,
    p_description TEXT,
    p_reference_id INTEGER DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_current_balance NUMERIC;
    v_new_balance NUMERIC;
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

-- Create update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create auto_expire_screen_requests function
CREATE OR REPLACE FUNCTION auto_expire_screen_requests()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE screen_requests
    SET status = 'expired'
    WHERE status = 'pending'
    AND expires_at < CURRENT_TIMESTAMP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Insert default screen types
INSERT INTO screen_types (name, size_inches, monthly_price) VALUES
    ('32 inch', 32, 15.00),
    ('43 inch', 43, 20.00),
    ('55 inch', 55, 25.00),
    ('65 inch', 65, 35.00),
    ('75 inch', 75, 45.00)
ON CONFLICT (name) DO NOTHING;

-- Insert default screen sizes
INSERT INTO screen_sizes (size_inches, monthly_fee) VALUES
    (32, 15.00),
    (43, 20.00),
    (55, 25.00),
    (65, 35.00),
    (75, 45.00)
ON CONFLICT (size_inches) DO NOTHING;

-- Insert default system settings
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
    ('app_name', 'IVAA AdSync', 'Application name'),
    ('app_version', '1.0.0', 'Application version'),
    ('maintenance_mode', 'false', 'Maintenance mode status'),
    ('commission_percentage', '10', 'Sales commission percentage'),
    ('content_upload_price', '3.00', 'Price for content uploads after free monthly upload'),
    ('content_monthly_price', '1.00', 'Monthly price per content item')
ON CONFLICT (setting_key) DO NOTHING;

-- Insert default users (passwords are hashed for 'password123')
INSERT INTO users (email, password_hash, full_name, role) VALUES
    ('admin@ivaamedia.uk', '$2a$10$mBU0f5/hKOl.tM9jLfmjOuHuLnW7hL3z8e9Sb8YQLTcH7WNKhK9RO', 'System Admin', 'admin'),
    ('design@ivaamedia.uk', '$2a$10$mBU0f5/hKOl.tM9jLfmjOuHuLnW7hL3z8e9Sb8YQLTcH7WNKhK9RO', 'Design Team', 'design'),
    ('sales@ivaamedia.uk', '$2a$10$mBU0f5/hKOl.tM9jLfmjOuHuLnW7hL3z8e9Sb8YQLTcH7WNKhK9RO', 'Sales Team', 'sales')
ON CONFLICT (email) DO NOTHING;

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_shops_owner ON shops(owner_id);
CREATE INDEX idx_shops_designer ON shops(designer_id);
CREATE INDEX idx_shops_approval ON shops(approval_status);
CREATE INDEX idx_shops_payment_status ON shops(payment_status);
CREATE INDEX idx_screens_shop ON screens(shop_id);
CREATE INDEX idx_content_shop ON content(shop_id);
CREATE INDEX idx_content_status ON content(status);
CREATE INDEX idx_credit_tx_shop ON credit_transactions(shop_id);
CREATE INDEX idx_credit_tx_created ON credit_transactions(created_at DESC);
CREATE INDEX idx_billing_shop ON billing(shop_id);
CREATE INDEX idx_billing_status ON billing(status);
CREATE INDEX idx_billing_shop_status ON billing(shop_id, status);
CREATE INDEX idx_invoices_shop ON invoices(shop_id);
CREATE INDEX idx_screen_requests_shop_id ON screen_requests(shop_id);
CREATE INDEX idx_screen_requests_status ON screen_requests(status);
CREATE INDEX idx_screen_requests_expires_at ON screen_requests(expires_at);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- Record schema version
INSERT INTO migrations (version, name) VALUES (999, 'complete_schema_live_match');