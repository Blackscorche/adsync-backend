require('dotenv').config();
const pool = require('./src/config/database');

async function fixUrls() {
  try {
    console.log('Fixing URLs in database...');
    
    // Fix content table (covers 3000, 5000 and local IP)
    const targets = ['http://localhost:3000', 'http://localhost:5000', 'http://10.58.76.236:5000'];
    const replacement = 'https://b94b-102-91-78-4.ngrok-free.app';

    for (const target of targets) {
      await pool.query(
        "UPDATE content SET file_url = REPLACE(file_url, $1, $2) WHERE file_url LIKE $3",
        [target, replacement, target + '%']
      );
      await pool.query(
        "UPDATE content SET designed_file_url = REPLACE(designed_file_url, $1, $2) WHERE designed_file_url LIKE $3",
        [target, replacement, target + '%']
      );
      await pool.query(
        "UPDATE shops SET photo_url = REPLACE(photo_url, $1, $2) WHERE photo_url LIKE $3",
        [target, replacement, target + '%']
      );
    }
    console.log(`Updated all URLs to ${replacement}`);

    console.log('Done!');
  } catch (error) {
    console.error('Error fixing URLs:', error);
  } finally {
    pool.end();
  }
}

fixUrls();
