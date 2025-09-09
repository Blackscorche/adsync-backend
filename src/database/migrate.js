const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function migrate() {
  try {
    console.log('🚀 Starting database migration...');

    // Read the schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute the schema
    await pool.query(schema);

    console.log('✅ Database migration completed successfully!');
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
    console.log('  - analytics_events');
    console.log('  - notifications');
    console.log('  - device_logs');
    
    console.log('\n💡 Next step: Run "npm run seed" to add test data');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n🔧 Make sure PostgreSQL is running and the database exists.');
      console.error('   You may need to create the database first:');
      console.error('   psql -U postgres -c "CREATE DATABASE ivaa_adsync;"');
    } else if (error.code === '42P07') {
      console.error('\n⚠️  Tables already exist. If you want to reset the database:');
      console.error('   1. Drop all tables or the entire database');
      console.error('   2. Run migration again');
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