require('dotenv').config();
const pool = require('./src/config/database');

async function setupTestData() {
  try {
    console.log('Setting up test data for Shop 1...');

    // 1. Create content for Shop 1 (borrowing the file from ID 1)
    const contentUrl = 'https://b94b-102-91-78-4.ngrok-free.app/uploads/content/ba7b61a8-02f0-4b42-ad81-f11d69325753.jpeg';
    const contentResult = await pool.query(
      "INSERT INTO content (shop_id, original_filename, file_url, file_type, status) VALUES (1, 'Test Design', $1, 'image', 'published') RETURNING id",
      [contentUrl]
    );
    const contentId = contentResult.rows[0].id;
    console.log(`Created content record: ${contentId}`);

    // 2. Create a playlist for Shop 1
    const playlistResult = await pool.query(
      "INSERT INTO playlists (shop_id, name, status) VALUES (1, 'Main Store Loop', 'active') RETURNING id"
    );
    const playlistId = playlistResult.rows[0].id;
    console.log(`Created playlist: ${playlistId}`);

    // 3. Add content to playlist
    await pool.query(
      "INSERT INTO playlist_items (playlist_id, content_id, position, duration) VALUES ($1, $2, 1, 10)",
      [playlistId, contentId]
    );
    console.log('Added content to playlist items');

    // 4. Assign playlist to screen 1
    await pool.query(
      "INSERT INTO screen_playlists (screen_id, playlist_id) VALUES (1, $1)",
      [playlistId]
    );
    console.log('Assigned playlist to screen 1');

    console.log('\n--- TEST DATA READY ---');
    console.log('Shop ID: 1');
    console.log('Device ID: 1234');
    console.log('Playlist: Main Store Loop (1 item)');

  } catch (error) {
    console.error('Error setting up test data:', error);
  } finally {
    pool.end();
  }
}

setupTestData();
