const bcrypt = require('bcryptjs');
const pool = require('../config/database');

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seed...');

    // Create initial users with proper passwords
    const users = [
      { email: 'admin@ivaa.com', password: 'admin123', name: 'System Admin', role: 'admin' },
      { email: 'sales@ivaa.com', password: 'sales123', name: 'Sales Team', role: 'sales' },
      { email: 'design@ivaa.com', password: 'design123', name: 'Design Team', role: 'design' },
    ];

    console.log('\n👤 Creating users...');
    for (const user of users) {
      const hashedPassword = await bcrypt.hash(user.password, 10);

      const result = await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role, is_active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email)
         DO UPDATE SET password_hash = $2, full_name = $3, role = $4
         RETURNING id, email, role`,
        [user.email, hashedPassword, user.name, user.role, true]
      );

      console.log(`✅ Created ${user.role}: ${user.email}`);
    }

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