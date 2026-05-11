const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  query_timeout: 10000,
  statement_timeout: 10000,
  keepAlive: true, // Help keep connections active
});

let hasLoggedConnection = false;

pool.on('connect', () => {
  if (!hasLoggedConnection) {
    console.log('✅ Database connected successfully');
    hasLoggedConnection = true;
  }
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error (Handled):', err.message);
  // Do NOT exit the process, let the pool handle reconnection
});

module.exports = pool;