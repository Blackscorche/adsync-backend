const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000, // 15 seconds for Neon databases to wake up
  query_timeout: 10000, // 10 second query timeout
  statement_timeout: 10000,
});

let hasLoggedConnection = false;

pool.on('connect', () => {
  if (!hasLoggedConnection) {
    console.log('✅ Database connected successfully');
    hasLoggedConnection = true;
  }
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
  process.exit(-1);
});

module.exports = pool;