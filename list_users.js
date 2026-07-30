require('dotenv').config();
const pool = require('./src/config/database');

async function listUsers() {
  try {
    const result = await pool.query('SELECT email, role, is_active FROM users');
    console.log(result.rows);
  } catch (error) {
    console.error(error);
  } finally {
    pool.end();
  }
}

listUsers();
