require('dotenv').config();
const pool = require('./src/config/database');

async function updateScreen() {
  try {
    const result = await pool.query(
      "UPDATE screens SET device_id = '1234' WHERE id = 1 RETURNING *"
    );
    console.log('Successfully updated screen:');
    console.log(result.rows[0]);
  } catch (error) {
    console.error('Error updating screen:', error);
  } finally {
    pool.end();
  }
}

updateScreen();
