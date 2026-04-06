CREATE TABLE IF NOT EXISTS playlist_schedules (
    id SERIAL PRIMARY KEY,
    screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    schedule_name VARCHAR(50) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(screen_id, schedule_name)
);

CREATE INDEX IF NOT EXISTS idx_playlist_schedules_screen ON playlist_schedules(screen_id);
