const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function migrate() {
  try {
    console.log('🚀 Starting database migration...\n');

    // Check if database is empty (fresh install)
    const tableCheck = await pool.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);
    
    const tableCount = parseInt(tableCheck.rows[0].count);
    const isEmptyDatabase = tableCount === 0;

    if (isEmptyDatabase) {
      console.log('📝 Empty database detected. Running initial schema...\n');
      
      // Read and execute the schema file
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      await pool.query(schema);
      
      console.log('✅ Base tables created successfully!');
      console.log('📝 Tables created:');
      console.log('  - users');
      console.log('  - shops');
      console.log('  - screens');
      console.log('  - content');
      console.log('  - playlists');
      console.log('  - playlist_items');
      console.log('  - screen_playlists');
      console.log('  - subscriptions');
      console.log('  - invoices');
      console.log('  - extra_uploads\n');
    } else {
      console.log('📊 Existing database detected.');
      console.log(`   Found ${tableCount} tables.\n`);
    }

    // Now run any pending migrations
    console.log('🔄 Checking for migrations...\n');
    
    // Create migrations tracking table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get list of migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    
    // Create migrations directory if it doesn't exist
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
      console.log('📁 Created migrations directory\n');
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found.\n');
    } else {
      // Check which migrations have already been run
      const executedResult = await pool.query('SELECT filename FROM migrations');
      const executed = new Set(executedResult.rows.map(row => row.filename));

      // Run pending migrations
      let migrationCount = 0;
      for (const file of files) {
        if (!executed.has(file)) {
          console.log(`📝 Running migration: ${file}`);
          
          const filePath = path.join(migrationsDir, file);
          const sql = fs.readFileSync(filePath, 'utf8');
          
          try {
            await pool.query('BEGIN');
            await pool.query(sql);
            await pool.query(
              'INSERT INTO migrations (filename) VALUES ($1)',
              [file]
            );
            await pool.query('COMMIT');
            console.log(`   ✅ Migration completed: ${file}\n`);
            migrationCount++;
          } catch (error) {
            await pool.query('ROLLBACK');
            console.error(`   ❌ Migration failed: ${file}`);
            console.error(`   Error: ${error.message}\n`);
            throw error;
          }
        }
      }

      if (migrationCount === 0) {
        console.log('✅ All migrations are up to date.\n');
      } else {
        console.log(`✅ Successfully ran ${migrationCount} migration(s).\n`);
      }
    }

    console.log('🎉 Database migration completed successfully!');
    console.log('\n💡 Next steps:');
    if (isEmptyDatabase) {
      console.log('   - Run "npm run seed" to add test data');
    }
    console.log('   - Run "npm run dev" to start the server\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n🔧 Make sure PostgreSQL is running and the database exists.');
      console.error('   You may need to create the database first:');
      console.error('   psql -U postgres -c "CREATE DATABASE ivaa_adsync;"');
    } else if (error.code === '42P07') {
      console.error('\n⚠️  Some tables already exist.');
      console.error('   This might happen if the database is partially set up.');
      console.error('   Options:');
      console.error('   1. Drop all tables and run migration again');
      console.error('   2. Manually fix the database state');
    }
    
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration if called directly
if (require.main === module) {
  migrate();
}

module.exports = migrate;