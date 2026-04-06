CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER REFERENCES users(id),
    referrer_name VARCHAR(255) NOT NULL,
    friend_name VARCHAR(255) NOT NULL,
    friend_phone VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    reward_amount NUMERIC,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

INSERT INTO system_settings (setting_key, setting_value, description)
VALUES ('referral_reward_amount', '25', 'Referral reward amount in GBP')
ON CONFLICT (setting_key) DO NOTHING;
