-- Add pre-paid credit system to prevent abuse
-- This ensures shops pay BEFORE uploading content or adding screens

-- Add credit balance to shops table
ALTER TABLE shops ADD COLUMN IF NOT EXISTS credit_balance DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS free_upload_used BOOLEAN DEFAULT FALSE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'active';
-- payment_status: active, inactive (7+ days overdue), terminated (30+ days overdue)

-- Track credit transactions
CREATE TABLE IF NOT EXISTS credit_transactions (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id),
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'top_up', 'upload_charge', 'screen_charge', 'refund'
    description TEXT,
    reference_id INTEGER, -- Can reference content_id or screen_id
    balance_before DECIMAL(10,2),
    balance_after DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add payment tracking to content
ALTER TABLE content ADD COLUMN IF NOT EXISTS charge_amount DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE content ADD COLUMN IF NOT EXISTS was_free_upload BOOLEAN DEFAULT FALSE;

-- Update bills table for new payment flow
ALTER TABLE bills ADD COLUMN IF NOT EXISTS days_overdue INTEGER DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS last_reminder_sent TIMESTAMP;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_shops_credit_balance ON shops(credit_balance);
CREATE INDEX IF NOT EXISTS idx_shops_payment_status ON shops(payment_status);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_shop ON credit_transactions(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_overdue ON bills(status, payment_due_date) WHERE status = 'pending';

-- Function to check and deduct credit
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
    -- Get current balance with lock
    SELECT credit_balance INTO v_current_balance
    FROM shops
    WHERE id = p_shop_id
    FOR UPDATE;

    -- Check sufficient balance
    IF v_current_balance < p_amount THEN
        RETURN FALSE;
    END IF;

    -- Update balance
    v_new_balance := v_current_balance - p_amount;
    UPDATE shops SET credit_balance = v_new_balance WHERE id = p_shop_id;

    -- Record transaction
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

-- Grant initial credit to existing active shops (courtesy credit)
UPDATE shops
SET credit_balance = 10.00
WHERE approval_status = 'approved'
AND credit_balance = 0;