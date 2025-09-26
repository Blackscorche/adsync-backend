const bcrypt = require('bcryptjs');
const pool = require('../config/database');

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seed...');

    // Create initial users with proper passwords
    const users = [
      { email: 'admin@ivaamedia.uk', password: 'IvaaAaron', name: 'System Admin', role: 'admin' },
      { email: 'design@ivaamedia.uk', password: 'design123', name: 'Design Team', role: 'design' },
      { email: 'sales@ivaamedia.uk', password: 'sales123', name: 'Sales Team', role: 'sales' },
    ];

    console.log('\n👤 Creating users...');
    for (const user of users) {
      const hashedPassword = await bcrypt.hash(user.password, 10);

      const result = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email)
         DO UPDATE SET password_hash = $2, full_name = $3, role = $4
         RETURNING id, email, role`,
        [user.email, hashedPassword, user.name, user.role]
      );

      console.log(`✅ Created ${user.role}: ${user.email}`);
    }

    // Create system_settings table and default settings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key VARCHAR(255) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default system settings
    const defaultSettings = [
      { key: 'commission_percentage', value: '10', description: 'Sales commission percentage' },
      { key: 'content_upload_price', value: '3.00', description: 'Price for content uploads after free monthly upload' },
      { key: 'content_monthly_price', value: '1.00', description: 'Monthly price per content item' },
    ];

    console.log('\n⚙️ Creating system settings...');
    for (const setting of defaultSettings) {
      await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (setting_key)
         DO UPDATE SET setting_value = $2, description = $3`,
        [setting.key, setting.value, setting.description]
      );
      console.log(`✅ Setting: ${setting.key} = ${setting.value}`);
    }

    // Create sales_commissions table if it doesn't exist (for migration compatibility)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_commissions (
        id SERIAL PRIMARY KEY,
        shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        commission_rate DECIMAL(5,2) NOT NULL,
        commission_amount DECIMAL(10,2) NOT NULL,
        period_month DATE NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Ensured sales_commissions table exists');

    console.log('\n🎉 Database seeded successfully!');
    console.log('\n📝 Test Credentials:');
    console.log('------------------------');
    users.forEach(user => {
      console.log(`${user.role}: ${user.email} / ${user.password}`);
    });
    console.log('------------------------\n');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

// Run seed if called directly
if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('Seed completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}

module.exports = seedDatabase;