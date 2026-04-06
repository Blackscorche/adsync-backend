CREATE TABLE IF NOT EXISTS customer_inquiries (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'new',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_inquiries_status ON customer_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_customer_inquiries_created ON customer_inquiries(created_at DESC);
