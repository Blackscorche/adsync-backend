-- Ivaa AdSync Database Schema
-- Complete but clean - All essential features included

-- 1. Users (Admin, Shop Owners, Sales Team)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'owner', 'sales')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Shops
CREATE TABLE shops (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id INTEGER REFERENCES users(id),
    address TEXT,
    phone VARCHAR(50),
    subscription_status VARCHAR(20) DEFAULT 'active' 
        CHECK (subscription_status IN ('active', 'suspended', 'trial')),
    free_uploads_used INTEGER DEFAULT 0,
    free_uploads_limit INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Screens (Multiple screens per shop)
CREATE TABLE screens (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL, -- e.g., "Window 43", "Till 32"
    device_id VARCHAR(255) UNIQUE,
    location VARCHAR(100), -- Window, Till, Aisle
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
    last_heartbeat TIMESTAMP,
    current_content_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Content (Media uploads from shops)
CREATE TABLE content (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id),
    filename VARCHAR(255) NOT NULL,
    file_url VARCHAR(500),
    file_type VARCHAR(20) CHECK (file_type IN ('image', 'video', 'pdf')),
    file_size INTEGER,
    thumbnail_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'pending' 
        CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    is_extra_upload BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Playlists (Content collections)
CREATE TABLE playlists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Playlist Items (Content in playlists)
CREATE TABLE playlist_items (
    id SERIAL PRIMARY KEY,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    content_id INTEGER REFERENCES content(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    duration INTEGER DEFAULT 10 -- seconds
);

-- 7. Screen Playlists (Which playlist is assigned to which screen)
CREATE TABLE screen_playlists (
    id SERIAL PRIMARY KEY,
    screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Subscriptions (Billing)
CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    plan VARCHAR(50) DEFAULT 'monthly',
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'active' 
        CHECK (status IN ('active', 'past_due', 'cancelled')),
    current_period_end DATE,
    next_payment_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Invoices
CREATE TABLE invoices (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    stripe_invoice_id VARCHAR(255),
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' 
        CHECK (status IN ('pending', 'paid', 'overdue')),
    due_date DATE,
    paid_at TIMESTAMP,
    pdf_url VARCHAR(500),
    reminder_count INTEGER DEFAULT 0,
    last_reminder_sent TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. Extra Upload Payments
CREATE TABLE extra_uploads (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    uploads_purchased INTEGER NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    stripe_payment_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. Playback Logs (For monitoring what's playing)
CREATE TABLE playback_logs (
    id SERIAL PRIMARY KEY,
    screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE,
    content_id INTEGER REFERENCES content(id) ON DELETE CASCADE,
    played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Sales Assignments (Optional - for sales team)
CREATE TABLE sales_assignments (
    id SERIAL PRIMARY KEY,
    sales_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    commission_rate DECIMAL(5,2) DEFAULT 10.00,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_shops_owner ON shops(owner_id);
CREATE INDEX idx_screens_shop ON screens(shop_id);
CREATE INDEX idx_screens_status ON screens(status);
CREATE INDEX idx_content_shop ON content(shop_id);
CREATE INDEX idx_content_status ON content(status);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_shop ON invoices(shop_id);

-- Default admin account (password will be set properly in seed file)
INSERT INTO users (email, password_hash, full_name, role) VALUES 
('admin@ivaa.com', 'temp_hash', 'System Admin', 'admin');