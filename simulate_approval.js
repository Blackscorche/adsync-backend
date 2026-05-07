require('dotenv').config();
const pool = require('./src/config/database');

async function approveShop(shopId, designerId, adminId) {
  try {
    await pool.query('BEGIN');

    const status = 'approved';
    const rejection_reason = null;
    const designer_id = designerId;

    const shopResult = await pool.query(
      `UPDATE shops
       SET approval_status = $1,
           rejection_reason = $2,
           designer_id = $3,
           approved_by = $4,
           approved_at = CURRENT_TIMESTAMP,
           subscription_status = $5
       WHERE id = $6
       RETURNING owner_id, name, registered_by`,
      [
        status,
        rejection_reason,
        designer_id,
        adminId,
        'active',
        shopId
      ]
    );

    if (shopResult.rows.length === 0) {
      throw new Error('Shop not found');
    }

    const shop = shopResult.rows[0];

    // Activate owner account
    await pool.query(
      'UPDATE users SET is_active = true WHERE id = $1',
      [shop.owner_id]
    );

    const commissionSettings = await pool.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'commission_percentage'"
    );
    const commissionRate = parseFloat(commissionSettings.rows[0]?.setting_value || 10) / 100;

    await pool.query(
      `INSERT INTO sales_commissions (sales_user_id, shop_id, commission_type, amount, percentage, status, month)
       VALUES ($1, $2, 'registration', 0, $3, 'pending', DATE_TRUNC('month', CURRENT_DATE))`,
      [shop.registered_by, shopId, commissionRate * 100]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, data)
       VALUES ($1, 'shop_approved', 'Shop Approved!',
              'Your shop has been approved and is now active. You can start uploading content.',
              $2::jsonb)`,
      [shop.owner_id, JSON.stringify({ shop_id: shopId })]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, data)
       VALUES ($1, 'shop_assigned', 'New Shop Assigned',
              $2, $3::jsonb)`,
      [designer_id, `You have been assigned to manage ${shop.name}`,
       JSON.stringify({ shop_id: shopId, shop_name: shop.name })]
    );

    await pool.query('COMMIT');
    console.log('Approval success!');
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Approval failed with error:', error);
  } finally {
    pool.end();
  }
}

// test with shop 1 and dummy designer 1 and admin 1
approveShop(1, 1, 1);
