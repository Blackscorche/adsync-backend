require('dotenv').config();
const pool = require('./src/config/database');

async function createScreen() {
  try {
    const result = await pool.query(
      "INSERT INTO screens (shop_id, name, device_id, status) VALUES (1, 'Main Display', 'test-device-123', 'online') RETURNING *"
    );
    console.log('Successfully created screen:');
    console.log(result.rows[0]);
  } catch (error) {
    console.error('Error creating screen:', error);
  } finally {
    pool.end();
  }
}

createScreen();
