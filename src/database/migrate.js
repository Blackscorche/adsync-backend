#!/usr/bin/env node

/**
 * Database Migration System
 *
 * Add your migrations to the migrations array below.
 * Each migration runs only once and is tracked in the database.
 *
 * Usage:
 *   npm run db:migrate     - Run pending migrations
 *   npm run db:reset       - Drop all tables and start fresh (DANGER!)
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Define all migrations here
const migrations = [
  {
    version: 1,
    name: 'initial_tables',
    up: async (client) => {
      // Create users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          full_name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'design', 'owner')),
          phone VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create shops table
      await client.query(`
        CREATE TABLE IF NOT EXISTS shops (
          id SERIAL PRIMARY KEY,
          owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          designer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          phone VARCHAR(20),
          address TEXT,
          city VARCHAR(100),
          postcode VARCHAR(20),
          commission_rate DECIMAL(5,2) DEFAULT 20.00,
          commission_balance DECIMAL(10,2) DEFAULT 0.00,
          logo TEXT,
          banner TEXT,
          business_proof TEXT,
          shop_photo TEXT,
          status VARCHAR(50) DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create screens table
      await client.query(`
        CREATE TABLE IF NOT EXISTS screens (
          id SERIAL PRIMARY KEY,
          shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          location VARCHAR(255),
          device_id VARCHAR(100) UNIQUE,
          current_content_id INTEGER,
          last_sync TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create content table
      await client.query(`
        CREATE TABLE IF NOT EXISTS content (
          id SERIAL PRIMARY KEY,
          shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
          uploaded_by INTEGER REFERENCES users(id),
          original_filename VARCHAR(255),
          file_url TEXT NOT NULL,
          file_type VARCHAR(50),
          status VARCHAR(50) DEFAULT 'pending',
          is_extra_upload BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    },
    down: async (client) => {
      await client.query('DROP TABLE IF EXISTS content CASCADE');
      await client.query('DROP TABLE IF EXISTS screens CASCADE');
      await client.query('DROP TABLE IF EXISTS shops CASCADE');
      await client.query('DROP TABLE IF EXISTS users CASCADE');
    }
  },

  {
    version: 2,
    name: 'add_payment_system',
    up: async (client) => {
      // Add credit columns to shops
      await client.query(`
        ALTER TABLE shops
        ADD COLUMN IF NOT EXISTS credit_balance DECIMAL(10,2) DEFAULT 0.00,
        ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS free_upload_used BOOLEAN DEFAULT FALSE
      `);

      // Create credit_transactions table
      await client.query(`
        CREATE TABLE IF NOT EXISTS credit_transactions (
          id SERIAL PRIMARY KEY,
          shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
          amount DECIMAL(10,2) NOT NULL,
          type VARCHAR(50) NOT NULL,
          description TEXT,
          reference_id INTEGER,
          balance_before DECIMAL(10,2),
          balance_after DECIMAL(10,2),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create billing table
      await client.query(`
        CREATE TABLE IF NOT EXISTS billing (
          id SERIAL PRIMARY KEY,
          shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
          bill_date DATE NOT NULL,
          due_date DATE NOT NULL,
          amount DECIMAL(10,2) NOT NULL,
          status VARCHAR(50) DEFAULT 'pending',
          description TEXT,
          paid_at TIMESTAMP,
          payment_method VARCHAR(50),
          stripe_payment_intent_id VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Add payment tracking to content
      await client.query(`
        ALTER TABLE content
        ADD COLUMN IF NOT EXISTS was_free_upload BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS charge_amount DECIMAL(10,2) DEFAULT 0.00
      `);

      // Add size and cost to screens
      await client.query(`
        ALTER TABLE screens
        ADD COLUMN IF NOT EXISTS size VARCHAR(20) DEFAULT '32_inch',
        ADD COLUMN IF NOT EXISTS monthly_cost DECIMAL(10,2) DEFAULT 15.00,
        ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active'
      `);

      // Create deduct_credit function
      await client.query(`
        CREATE OR REPLACE FUNCTION deduct_credit(
          p_shop_id INTEGER,
          p_amount DECIMAL,
          p_type VARCHAR,
          p_description TEXT,
          p_reference_id INTEGER DEFAULT NULL
        ) RETURNS BOOLEAN AS $$
        DECLARE
          v_current_balance DECIMAL;
          v_new_balance DECIMAL;
        BEGIN
          SELECT credit_balance INTO v_current_balance
          FROM shops WHERE id = p_shop_id FOR UPDATE;

          IF v_current_balance < p_amount THEN
            RETURN FALSE;
          END IF;

          v_new_balance := v_current_balance - p_amount;

          UPDATE shops SET credit_balance = v_new_balance WHERE id = p_shop_id;

          INSERT INTO credit_transactions (
            shop_id, amount, type, description, reference_id,
            balance_before, balance_after
          ) VALUES (
            p_shop_id, p_amount, p_type, p_description, p_reference_id,
            v_current_balance, v_new_balance
          );

          RETURN TRUE;
        END;
        $$ LANGUAGE plpgsql;
      `);

      // No courtesy credit for shops - they must pay upfront
      // await client.query(`
      //   UPDATE shops SET credit_balance = 10.00 WHERE credit_balance = 0
      // `);
    },
    down: async (client) => {
      await client.query('DROP FUNCTION IF EXISTS deduct_credit');
      await client.query('DROP TABLE IF EXISTS billing CASCADE');
      await client.query('DROP TABLE IF EXISTS credit_transactions CASCADE');
      await client.query('ALTER TABLE shops DROP COLUMN IF EXISTS credit_balance');
      await client.query('ALTER TABLE shops DROP COLUMN IF EXISTS payment_status');
      await client.query('ALTER TABLE shops DROP COLUMN IF EXISTS free_upload_used');
      await client.query('ALTER TABLE content DROP COLUMN IF EXISTS was_free_upload');
      await client.query('ALTER TABLE content DROP COLUMN IF EXISTS charge_amount');
      await client.query('ALTER TABLE screens DROP COLUMN IF EXISTS size');
      await client.query('ALTER TABLE screens DROP COLUMN IF EXISTS monthly_cost');
      await client.query('ALTER TABLE screens DROP COLUMN IF EXISTS status');
    }
  },

  {
    version: 3,
    name: 'add_content_workflow',
    up: async (client) => {
      // Add workflow columns to content
      await client.query(`
        ALTER TABLE content
        ADD COLUMN IF NOT EXISTS designed_by INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS designed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS designed_file_url TEXT,
        ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
        ADD COLUMN IF NOT EXISTS published_by INTEGER REFERENCES users(id),
        ADD COLUMN IF NOT EXISTS published_at TIMESTAMP
      `);

      // Update status constraint
      await client.query(`
        ALTER TABLE content DROP CONSTRAINT IF EXISTS content_status_check;
        ALTER TABLE content ADD CONSTRAINT content_status_check
        CHECK (status IN ('pending', 'in_design', 'designed', 'approved', 'rejected', 'published'))
      `);
    },
    down: async (client) => {
      await client.query('ALTER TABLE content DROP COLUMN IF EXISTS designed_by');
      await client.query('ALTER TABLE content DROP COLUMN IF EXISTS designed_at');
      await client.query('ALTER TABLE content DROP COLUMN IF EXISTS designed_file_url');
      await client.query('ALTER TABLE content DROP COLUMN IF EXISTS reviewed_by');
      await client.query('ALTER TABLE content DROP COLUMN IF EXISTS reviewed_at');
      await client.query('ALTER TABLE content DROP COLUMN IF EXISTS rejection_reason');
      await client.query('ALTER TABLE content DROP COLUMN IF EXISTS published_by');
      await client.query('ALTER TABLE content DROP COLUMN IF EXISTS published_at');
    }
  },

  {
    version: 4,
    name: 'add_playlists_and_support',
    up: async (client) => {
      // Create playlists table
      await client.query(`
        CREATE TABLE IF NOT EXISTS playlists (
          id SERIAL PRIMARY KEY,
          shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create playlist_items table
      await client.query(`
        CREATE TABLE IF NOT EXISTS playlist_items (
          id SERIAL PRIMARY KEY,
          playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
          content_id INTEGER REFERENCES content(id) ON DELETE CASCADE,
          order_index INTEGER NOT NULL,
          duration_seconds INTEGER DEFAULT 10,
          UNIQUE(playlist_id, order_index)
        )
      `);

      // Create screen_playlists table
      await client.query(`
        CREATE TABLE IF NOT EXISTS screen_playlists (
          screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE,
          playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
          PRIMARY KEY (screen_id, playlist_id)
        )
      `);

      // Create notifications table
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          type VARCHAR(50) DEFAULT 'info',
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create support_tickets table
      await client.query(`
        CREATE TABLE IF NOT EXISTS support_tickets (
          id SERIAL PRIMARY KEY,
          shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
          subject VARCHAR(255) NOT NULL,
          description TEXT NOT NULL,
          status VARCHAR(50) DEFAULT 'open',
          priority VARCHAR(20) DEFAULT 'normal',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create ticket_messages table
      await client.query(`
        CREATE TABLE IF NOT EXISTS ticket_messages (
          id SERIAL PRIMARY KEY,
          ticket_id INTEGER REFERENCES support_tickets(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id),
          message TEXT NOT NULL,
          attachment TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    },
    down: async (client) => {
      await client.query('DROP TABLE IF EXISTS ticket_messages CASCADE');
      await client.query('DROP TABLE IF EXISTS support_tickets CASCADE');
      await client.query('DROP TABLE IF EXISTS notifications CASCADE');
      await client.query('DROP TABLE IF EXISTS screen_playlists CASCADE');
      await client.query('DROP TABLE IF EXISTS playlist_items CASCADE');
      await client.query('DROP TABLE IF EXISTS playlists CASCADE');
    }
  },

  {
    version: 5,
    name: 'add_indexes',
    up: async (client) => {
      // Performance indexes
      await client.query('CREATE INDEX IF NOT EXISTS idx_shops_owner ON shops(owner_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_shops_designer ON shops(designer_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_shops_payment_status ON shops(payment_status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_content_shop ON content(shop_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_content_status ON content(status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_screens_shop ON screens(shop_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_credit_tx_shop ON credit_transactions(shop_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_billing_shop ON billing(shop_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_billing_status ON billing(status)');
    },
    down: async (client) => {
      await client.query('DROP INDEX IF EXISTS idx_shops_owner');
      await client.query('DROP INDEX IF EXISTS idx_shops_designer');
      await client.query('DROP INDEX IF EXISTS idx_shops_payment_status');
      await client.query('DROP INDEX IF EXISTS idx_content_shop');
      await client.query('DROP INDEX IF EXISTS idx_content_status');
      await client.query('DROP INDEX IF EXISTS idx_screens_shop');
      await client.query('DROP INDEX IF EXISTS idx_credit_tx_shop');
      await client.query('DROP INDEX IF EXISTS idx_billing_shop');
      await client.query('DROP INDEX IF EXISTS idx_billing_status');
    }
  },

  {
    version: 6,
    name: 'fix_playlist_system',
    up: async (client) => {
      // Fix playlist table - add missing created_by column
      await client.query(`
        ALTER TABLE playlists
        ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)
      `);

      // Check if order_index column exists before renaming
      const orderIndexExists = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'playlist_items' AND column_name = 'order_index'
      `);

      if (orderIndexExists.rows.length > 0) {
        await client.query(`
          ALTER TABLE playlist_items
          RENAME COLUMN order_index TO position
        `);
      }

      // Check if duration_seconds column exists before renaming
      const durationSecondsExists = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'playlist_items' AND column_name = 'duration_seconds'
      `);

      if (durationSecondsExists.rows.length > 0) {
        await client.query(`
          ALTER TABLE playlist_items
          RENAME COLUMN duration_seconds TO duration
        `);
      }

      // Add published status to playlists
      await client.query(`
        ALTER TABLE playlists
        ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'draft'
      `);

      // Update existing playlists to have correct status
      await client.query(`
        UPDATE playlists SET status = 'published' WHERE is_active = true
      `);
    },
    down: async (client) => {
      await client.query('ALTER TABLE playlists DROP COLUMN IF EXISTS created_by');
      await client.query('ALTER TABLE playlists DROP COLUMN IF EXISTS status');

      // Check before renaming back
      const positionExists = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'playlist_items' AND column_name = 'position'
      `);

      if (positionExists.rows.length > 0) {
        await client.query('ALTER TABLE playlist_items RENAME COLUMN position TO order_index');
      }

      const durationExists = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'playlist_items' AND column_name = 'duration'
      `);

      if (durationExists.rows.length > 0) {
        await client.query('ALTER TABLE playlist_items RENAME COLUMN duration TO duration_seconds');
      }
    }
  }

  // ADD NEW MIGRATIONS HERE
];

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log('🚀 Database Migration\n');
    console.log('================================\n');

    // Create migrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get current version
    const result = await client.query('SELECT MAX(version) as current FROM migrations');
    const currentVersion = result.rows[0].current || 0;
    console.log(`📌 Current version: ${currentVersion}`);

    // Find pending migrations
    const pending = migrations.filter(m => m.version > currentVersion);

    if (pending.length === 0) {
      console.log('✅ Database is up to date!\n');
      return;
    }

    console.log(`📦 ${pending.length} migrations to apply\n`);

    // Apply each migration
    for (const migration of pending) {
      console.log(`▶️  Applying v${migration.version}: ${migration.name}...`);

      await client.query('BEGIN');
      try {
        await migration.up(client);
        await client.query(
          'INSERT INTO migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        await client.query('COMMIT');
        console.log(`   ✅ Applied successfully\n`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.version} failed: ${error.message}`);
      }
    }

    // Final status
    const newVersion = await client.query('SELECT MAX(version) as current FROM migrations');
    console.log('================================');
    console.log(`✅ All migrations applied!`);
    console.log(`📌 New version: ${newVersion.rows[0].current}\n`);

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

async function rollback() {
  const client = await pool.connect();

  try {
    console.log('⏪ Rolling back last migration...\n');

    const result = await client.query(
      'SELECT version, name FROM migrations ORDER BY version DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      console.log('No migrations to rollback\n');
      return;
    }

    const lastMigration = result.rows[0];
    const migration = migrations.find(m => m.version === lastMigration.version);

    if (!migration) {
      throw new Error(`Migration ${lastMigration.version} not found in code`);
    }

    console.log(`Rolling back v${migration.version}: ${migration.name}...`);

    await client.query('BEGIN');
    await migration.down(client);
    await client.query('DELETE FROM migrations WHERE version = $1', [migration.version]);
    await client.query('COMMIT');

    console.log('✅ Rollback successful\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Rollback failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

async function reset() {
  const client = await pool.connect();

  try {
    console.log('⚠️  RESETTING DATABASE - This will delete ALL data!\n');
    console.log('Press Ctrl+C to cancel...\n');

    // Give user time to cancel
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('Dropping all tables...');

    // Get all tables
    const tables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    // Drop each table
    for (const table of tables.rows) {
      await client.query(`DROP TABLE IF EXISTS ${table.tablename} CASCADE`);
      console.log(`   Dropped ${table.tablename}`);
    }

    console.log('\n✅ Database reset complete\n');
    console.log('Run "npm run db:migrate" to set up fresh database\n');

  } catch (error) {
    console.error('❌ Reset failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Main execution
const command = process.argv[2];

switch (command) {
  case 'rollback':
    rollback();
    break;
  case 'reset':
    reset();
    break;
  default:
    runMigrations();
}