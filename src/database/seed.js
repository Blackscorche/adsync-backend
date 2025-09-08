const bcrypt = require('bcryptjs');
const pool = require('../config/database');

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seed...');

    // Hash passwords
    const adminPassword = await bcrypt.hash('admin123', 10);
    const ownerPassword = await bcrypt.hash('owner123', 10);
    const salesPassword = await bcrypt.hash('sales123', 10);

    // Create admin user
    const adminResult = await pool.query(
      `INSERT INTO users (email, password, first_name, last_name, phone, role, is_verified, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, email, role`,
      ['admin@ivaamedia.com', adminPassword, 'Admin', 'User', '+855123456789', 'admin', true]
    );
    console.log('✅ Admin user created:', adminResult.rows[0].email);

    // Create owner users
    const owner1Result = await pool.query(
      `INSERT INTO users (email, password, first_name, last_name, phone, role, is_verified, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, email, role`,
      ['owner1@example.com', ownerPassword, 'John', 'Doe', '+855123456790', 'owner', true]
    );
    console.log('✅ Owner user created:', owner1Result.rows[0].email);

    const owner2Result = await pool.query(
      `INSERT INTO users (email, password, first_name, last_name, phone, role, is_verified, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, email, role`,
      ['owner2@example.com', ownerPassword, 'Jane', 'Smith', '+855123456791', 'owner', true]
    );
    console.log('✅ Owner user created:', owner2Result.rows[0].email);

    // Create sales user
    const salesResult = await pool.query(
      `INSERT INTO users (email, password, first_name, last_name, phone, role, is_verified, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, email, role`,
      ['sales@ivaamedia.com', salesPassword, 'Sales', 'Rep', '+855123456792', 'sales', true]
    );
    console.log('✅ Sales user created:', salesResult.rows[0].email);

    // Create shops for owners
    const shop1Result = await pool.query(
      `INSERT INTO shops (owner_id, name, address, city, country, subscription_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, name`,
      [owner1Result.rows[0].id, 'Coffee Paradise', '123 Main Street', 'Phnom Penh', 'KH', 'trial']
    );
    console.log('✅ Shop created:', shop1Result.rows[0].name);

    const shop2Result = await pool.query(
      `INSERT INTO shops (owner_id, name, address, city, country, subscription_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, name`,
      [owner2Result.rows[0].id, 'Fashion Boutique', '456 River Road', 'Siem Reap', 'KH', 'active']
    );
    console.log('✅ Shop created:', shop2Result.rows[0].name);

    // Create screens for shops
    await pool.query(
      `INSERT INTO screens (shop_id, name, device_id, location, status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [shop1Result.rows[0].id, 'Window Display', 'DEVICE001', 'Window', 'offline']
    );
    console.log('✅ Screen created for Coffee Paradise');

    await pool.query(
      `INSERT INTO screens (shop_id, name, device_id, location, status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [shop1Result.rows[0].id, 'Counter Display', 'DEVICE002', 'Till', 'offline']
    );
    console.log('✅ Screen created for Coffee Paradise');

    await pool.query(
      `INSERT INTO screens (shop_id, name, device_id, location, status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [shop2Result.rows[0].id, 'Entrance Display', 'DEVICE003', 'Window', 'offline']
    );
    console.log('✅ Screen created for Fashion Boutique');

    console.log('\n🎉 Database seeded successfully!');
    console.log('\n📝 Test Credentials:');
    console.log('------------------------');
    console.log('Admin: admin@ivaamedia.com / admin123');
    console.log('Owner 1: owner1@example.com / owner123');
    console.log('Owner 2: owner2@example.com / owner123');
    console.log('Sales: sales@ivaamedia.com / sales123');
    console.log('------------------------');
    console.log('Admin Registration Key: IVAA-ADMIN-2024');
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