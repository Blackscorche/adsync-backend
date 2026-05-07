require('dotenv').config();
const pool = require('./src/config/database');

async function checkShops() {
  try {
    const res = await pool.query('SELECT id, name, approval_status, subscription_status FROM shops');
    console.log(res.rows);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    pool.end();
  }
}

checkShops();
