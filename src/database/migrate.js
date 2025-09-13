const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const bcrypt = require('bcryptjs');

async function runMigration() {
  console.log('🚀 Starting Ivaa AdSync v2.0 Migration...\n');

  try {
    // Step 1: Check connection
    console.log('📡 Checking database connection...');
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected\n');

    // Step 2: Backup warning
    console.log('⚠️  WARNING: This migration will DELETE ALL EXISTING DATA!');
    console.log('⚠️  Make sure you have backed up your database first!');
    console.log('⚠️  Run: pg_dump -U postgres -d ivaa_adsync > backup.sql\n');

    // Wait for user confirmation
    if (process.argv[2] !== '--force') {
      console.log('To proceed, run: npm run migrate -- --force');
      process.exit(0);
    }

    // Step 3: Run migration
    console.log('🔄 Running migration...');
    const migrationSQL = fs.readFileSync(
      path.join(__dirname, 'schema.sql'),
      'utf8'
    );

    // Execute migration
    await pool.query(migrationSQL);
    console.log('✅ Database schema created\n');

    // Step 4: Create initial users with proper passwords
    console.log('👤 Creating initial users...');

    const users = [
      { email: 'admin@ivaa.com', password: 'admin123', name: 'System Admin', role: 'admin' },
      { email: 'sales@ivaa.com', password: 'sales123', name: 'Sales Team', role: 'sales' },
      { email: 'design@ivaa.com', password: 'design123', name: 'Design Team', role: 'design' },
    ];

    for (const user of users) {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email)
         DO UPDATE SET password_hash = $2, full_name = $3, role = $4`,
        [user.email, hashedPassword, user.name, user.role]
      );
      console.log(`✅ Created ${user.role}: ${user.email} / ${user.password}`);
    }

    // Step 5: Verify migration
    console.log('\n📊 Migration Summary:');

    const tableCount = await pool.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    console.log(`✅ Tables created: ${tableCount.rows[0].count}`);

    const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
    console.log(`✅ Users created: ${userCount.rows[0].count}`);

    const settingsCount = await pool.query('SELECT COUNT(*) as count FROM system_settings');
    console.log(`✅ System settings: ${settingsCount.rows[0].count}`);

    const screenSizes = await pool.query('SELECT * FROM screen_sizes ORDER BY size_inches');
    console.log(`✅ Screen sizes configured:`);
    screenSizes.rows.forEach(size => {
      console.log(`   - ${size.size_inches}" screen: £${size.monthly_fee}/month`);
    });

    console.log('\n🎉 Migration completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('1. Update backend routes for new roles');
    console.log('2. Create sales dashboard frontend');
    console.log('3. Update content workflow');
    console.log('4. Test all user roles');

    console.log('\n🔑 Test Credentials:');
    console.log('------------------------');
    users.forEach(user => {
      console.log(`${user.role}: ${user.email} / ${user.password}`);
    });
    console.log('------------------------\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
runMigration();