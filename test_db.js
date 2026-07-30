const pool = require('./src/config/database');

async function testConnection() {
  try {
    console.log('Testing database connection...');
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Connection successful:', res.rows[0]);
    
    console.log('Checking users table...');
    const users = await pool.query('SELECT count(*) FROM users');
    console.log('✅ Users count:', users.rows[0].count);
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  }
}

testConnection();
