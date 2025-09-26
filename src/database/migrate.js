#!/usr/bin/env node

/**
 * SQL File-based Migration System
 *
 * Reads and executes SQL migration files from the migrations/ directory
 * Tracks applied migrations in schema_migrations table
 *
 * Usage:
 *   npm run db:migrate     - Apply pending migrations
 *   npm run db:migrate rollback - Rollback last migration (if implemented)
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('digitalocean.com') ||
       process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const migrationsDir = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    client.release();
  }
}

async function getAppliedMigrations() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    return result.rows.map(row => row.version);
  } finally {
    client.release();
  }
}

async function getMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    console.log('📁 No migrations directory found');
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  return files.map(filename => {
    const match = filename.match(/^(\d+)_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid migration filename: ${filename}. Must be in format: 001_description.sql`);
    }

    return {
      version: parseInt(match[1]),
      name: match[2],
      filename: filename,
      path: path.join(migrationsDir, filename)
    };
  });
}

async function applyMigration(migration) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log(`▶️  Applying v${migration.version}: ${migration.name}...`);

    // Read and execute the SQL file
    const sql = fs.readFileSync(migration.path, 'utf8');
    await client.query(sql);

    // Record the migration
    await client.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [migration.version, migration.name]
    );

    await client.query('COMMIT');
    console.log(`   ✅ Applied successfully`);

  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${migration.version} failed: ${error.message}`);
  } finally {
    client.release();
  }
}

async function runMigrations() {
  try {
    console.log('🚀 Database Migration\n');
    console.log('================================\n');

    await ensureMigrationsTable();

    const appliedMigrations = await getAppliedMigrations();
    const migrationFiles = await getMigrationFiles();

    const pendingMigrations = migrationFiles.filter(
      migration => !appliedMigrations.includes(migration.version)
    );

    if (pendingMigrations.length === 0) {
      console.log('✅ No pending migrations found');
      return;
    }

    console.log(`📌 ${appliedMigrations.length} migrations already applied`);
    console.log(`📦 ${pendingMigrations.length} migrations to apply\n`);

    for (const migration of pendingMigrations) {
      await applyMigration(migration);
    }

    console.log('\n🎉 All migrations completed successfully!');

  } catch (error) {
    console.error(`\n❌ Migration failed: ${error.message}`);
    throw error;
  } finally {
    await pool.end();
  }
}

async function showStatus() {
  try {
    await ensureMigrationsTable();

    const appliedMigrations = await getAppliedMigrations();
    const migrationFiles = await getMigrationFiles();

    console.log('📊 Migration Status\n');
    console.log('================================\n');

    if (migrationFiles.length === 0) {
      console.log('📁 No migration files found');
      return;
    }

    migrationFiles.forEach(migration => {
      const status = appliedMigrations.includes(migration.version) ? '✅' : '⏳';
      console.log(`${status} v${migration.version}: ${migration.name}`);
    });

    const pendingCount = migrationFiles.length - appliedMigrations.length;
    console.log(`\n📈 Applied: ${appliedMigrations.length}`);
    console.log(`📦 Pending: ${pendingCount}`);

  } catch (error) {
    console.error(`❌ Status check failed: ${error.message}`);
    throw error;
  } finally {
    await pool.end();
  }
}

// Handle command line arguments
const command = process.argv[2];

switch (command) {
  case 'status':
    showStatus();
    break;
  case 'rollback':
    console.log('⚠️  Rollback feature not implemented yet');
    console.log('   For now, please create a new migration to undo changes');
    process.exit(1);
    break;
  default:
    runMigrations()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
}