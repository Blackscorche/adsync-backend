require('dotenv').config();
const pool = require('./src/config/database');

async function alterTable() {
  try {
    await pool.query(`
      ALTER TABLE shops 
      ADD COLUMN IF NOT EXISTS promotion_type VARCHAR(100),
      ADD COLUMN IF NOT EXISTS wifi_connection VARCHAR(50),
      ADD COLUMN IF NOT EXISTS wifi_distance VARCHAR(50),
      ADD COLUMN IF NOT EXISTS cable_support VARCHAR(50),
      ADD COLUMN IF NOT EXISTS cable_length VARCHAR(50),
      ADD COLUMN IF NOT EXISTS display_fixed_at VARCHAR(100),
      ADD COLUMN IF NOT EXISTS windows_photo_url VARCHAR(500)
    `);
    console.log('Successfully altered shops table');
  } catch (error) {
    console.error('Error altering table:', error);
  } finally {
    pool.end();
  }
}

alterTable();
