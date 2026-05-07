#!/usr/bin/env node

/**
 * Database Setup Script
 *
 * Applies the complete database schema from schema.sql
 *
 * Usage:
 *   npm run db:setup     - Apply complete schema
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('digitalocean.com') ||
       process.env.DATABASE_URL?.includes('supabase.com') ||
       process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function setupDatabase() {
  const client = await pool.connect();

  try {
    console.log('🚀 Setting up database...\n');

    // Read the complete schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute the complete schema
    console.log('📋 Applying database schema...');
    await client.query(schema);

    console.log('✅ Database setup completed successfully!\n');

    // Show summary
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('📊 Created tables:');
    tablesResult.rows.forEach(row => {
      console.log(`   ✓ ${row.table_name}`);
    });

    const usersResult = await client.query('SELECT COUNT(*) as count FROM users');
    console.log(`\n👥 Users: ${usersResult.rows[0].count}`);

    const settingsResult = await client.query('SELECT COUNT(*) as count FROM system_settings');
    console.log(`⚙️  System settings: ${settingsResult.rows[0].count}`);

    const screenTypesResult = await client.query('SELECT COUNT(*) as count FROM screen_types');
    console.log(`📺 Screen types: ${screenTypesResult.rows[0].count}`);

  } catch (error) {
    console.error('❌ Database setup failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run setup
setupDatabase()
  .then(() => {
    console.log('\n🎉 Database is ready to use!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Setup failed:', error.message);
    process.exit(1);
  });