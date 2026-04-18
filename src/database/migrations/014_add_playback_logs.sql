CREATE TABLE IF NOT EXISTS playback_logs (
    id SERIAL PRIMARY KEY,
    shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
    screen_id INTEGER REFERENCES screens(id) ON DELETE SET NULL,
    content_id INTEGER REFERENCES content(id) ON DELETE SET NULL,
    content_name VARCHAR(255),
    played_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_playback_logs_shop ON playback_logs(shop_id);
CREATE INDEX idx_playback_logs_content ON playback_logs(content_id);
CREATE INDEX idx_playback_logs_played_at ON playback_logs(played_at DESC);
