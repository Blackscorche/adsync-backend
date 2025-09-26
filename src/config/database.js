const { Pool } = require('pg');
require('dotenv').config();

// Determine SSL configuration
const isDigitalOcean = process.env.DATABASE_URL?.includes('digitalocean.com');
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (isDigitalOcean || isProduction) ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Log SSL configuration for debugging
console.log('Database SSL config:', {
  isDigitalOcean,
  isProduction,
  sslEnabled: (isDigitalOcean || isProduction) ? 'true (rejectUnauthorized: false)' : 'false'
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