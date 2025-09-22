const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const emailService = require('../services/email');

const router = express.Router();

// Get all shops (for admin dashboard)
router.get('/shops', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        s.id,
        s.name,
        s.shop_type,
        s.address,
        s.postcode,
        s.city,
        s.phone,
        s.approval_status,
        s.subscription_status,
        s.rejection_reason,
        s.photo_url,
        s.owner_id,
        s.designer_id,
        s.registered_by,
        s.approved_by,
        s.created_at,
        s.approved_at,
        u.email as owner_email,
        u.full_name as owner_name,
        r.full_name as registered_by_name,
        d.full_name as designer_name
       FROM shops s
       LEFT JOIN users u ON s.owner_id = u.id
       LEFT JOIN users r ON s.registered_by = r.id
       LEFT JOIN users d ON s.designer_id = d.id
       ORDER BY s.created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching shops:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all screens (for admin dashboard)
router.get('/screens', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        sc.*,
        s.name as shop_name,
        s.address as shop_address,
        CASE
          WHEN sc.last_heartbeat > NOW() - INTERVAL '5 minutes' THEN 'online'
          ELSE 'offline'
        END as status
       FROM screens sc
       LEFT JOIN shops s ON sc.shop_id = s.id
       ORDER BY sc.created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching screens:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users (for admin dashboard)
router.get('/users', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        id,
        email,
        full_name,
        role,
        phone,
        is_active,
        created_at
       FROM users
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get content statistics (for admin dashboard)
router.get('/content/stats', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'published') as published,
        COUNT(*) FILTER (WHERE status = 'in_design') as in_design,
        COUNT(*) FILTER (WHERE status = 'designed') as designed,
        COUNT(*) as total
       FROM content`
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching content stats:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get pending shops for approval
router.get('/shops/pending', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        s.*,
        u.email as owner_email,
        u.full_name as owner_name,
        r.full_name as registered_by_name
       FROM shops s
       LEFT JOIN users u ON s.owner_id = u.id
       LEFT JOIN users r ON s.registered_by = r.id
       WHERE s.approval_status = 'pending'
       ORDER BY s.created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching pending shops:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Approve or reject shop
router.post('/shops/:id/approve', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const shopId = req.params.id;
    const { status, rejection_reason, designer_id } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (status === 'approved' && !designer_id) {
      return res.status(400).json({ error: 'Designer assignment required for approval' });
    }

    if (status === 'rejected' && !rejection_reason) {
      return res.status(400).json({ error: 'Rejection reason required' });
    }

    await pool.query('BEGIN');

    try {
      // Update shop status
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
          status === 'approved' ? designer_id : null,
          req.user.userId,
          status === 'approved' ? 'active' : 'pending',
          shopId
        ]
      );

      if (shopResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(404).json({ error: 'Shop not found' });
      }

      const shop = shopResult.rows[0];

      if (status === 'approved') {
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

        // Notify owner
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, data)
           VALUES ($1, 'shop_approved', 'Shop Approved!',
                  'Your shop has been approved and is now active. You can start uploading content.',
                  $2::jsonb)`,
          [shop.owner_id, JSON.stringify({ shop_id: shopId })]
        );

        // Notify assigned designer
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, data)
           VALUES ($1, 'shop_assigned', 'New Shop Assigned',
                  $2, $3::jsonb)`,
          [designer_id, `You have been assigned to manage ${shop.name}`,
           JSON.stringify({ shop_id: shopId, shop_name: shop.name })]
        );

        // Send approval email
        await emailService.sendShopApprovalEmail(shopId);

      } else {
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, data)
           VALUES ($1, 'shop_rejected', 'Shop Registration Rejected',
                  $2, $3::jsonb)`,
          [shop.registered_by,
           `${shop.name} has been rejected: ${rejection_reason}`,
           JSON.stringify({ shop_id: shopId, shop_name: shop.name, reason: rejection_reason })]
        );

        // Send rejection email
        await emailService.sendShopRejectionEmail(shopId, rejection_reason);
      }

      await pool.query('COMMIT');

      res.json({
        message: `Shop ${status} successfully`,
        shopId: shopId
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error approving shop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all designers for assignment
router.get('/designers', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        u.id,
        u.full_name,
        u.email,
        COUNT(DISTINCT s.id) as assigned_shops,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'pending') as pending_content
       FROM users u
       LEFT JOIN shops s ON u.id = s.designer_id
       LEFT JOIN content c ON s.id = c.shop_id
       WHERE u.role = 'design' AND u.is_active = true
       GROUP BY u.id, u.full_name, u.email
       ORDER BY assigned_shops ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching designers:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register new user (sales or designer)
router.post('/register-user', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { email, password, full_name, role, phone } = req.body;

    if (!['sales', 'design'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be sales or design.' });
    }

    // Check if email exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, email, full_name, role`,
      [email, passwordHash, full_name, role, phone]
    );

    res.status(201).json({
      message: `${role} team member created successfully`,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Screen Types Management (Dynamic)
router.get('/screen-types', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM screen_types ORDER BY size_inches'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching screen types:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/screen-types', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { name, size_inches, monthly_price } = req.body;

    const result = await pool.query(
      `INSERT INTO screen_types (name, size_inches, monthly_price)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, size_inches, monthly_price]
    );

    res.json({
      message: 'Screen type added',
      screenType: result.rows[0]
    });
  } catch (error) {
    console.error('Error adding screen type:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/screen-types/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, size_inches, monthly_price, is_active } = req.body;

    const result = await pool.query(
      `UPDATE screen_types
       SET name = COALESCE($1, name),
           size_inches = COALESCE($2, size_inches),
           monthly_price = COALESCE($3, monthly_price),
           is_active = COALESCE($4, is_active),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [name, size_inches, monthly_price, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Screen type not found' });
    }

    res.json({
      message: 'Screen type updated',
      screenType: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating screen type:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/screen-types/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if any screens are using this type
    const screensUsingType = await pool.query(
      'SELECT COUNT(*) as count FROM screens WHERE screen_type_id = $1',
      [id]
    );

    if (parseInt(screensUsingType.rows[0].count) > 0) {
      return res.status(400).json({
        error: 'Cannot delete screen type that is in use by screens',
        screens_count: parseInt(screensUsingType.rows[0].count)
      });
    }

    const result = await pool.query(
      'DELETE FROM screen_types WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Screen type not found' });
    }

    res.json({
      message: 'Screen type deleted',
      screenType: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting screen type:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Pricing and System Settings Management
router.get('/pricing-settings', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const settings = await pool.query(`
      SELECT * FROM system_settings
      WHERE setting_key IN (
        'commission_percentage',
        'content_upload_price',
        'content_monthly_price'
      )
      ORDER BY setting_key
    `);

    const screenTypes = await pool.query(
      'SELECT * FROM screen_types WHERE is_active = true ORDER BY size_inches'
    );

    res.json({
      settings: settings.rows,
      screenTypes: screenTypes.rows
    });
  } catch (error) {
    console.error('Error fetching pricing settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update pricing setting
router.put('/pricing-settings/:key', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    // Validate the key
    const allowedKeys = [
      'commission_percentage',
      'content_upload_price',
      'content_monthly_price'
    ];

    if (!allowedKeys.includes(key)) {
      return res.status(400).json({ error: 'Invalid setting key' });
    }

    // Validate the value is a positive number
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      return res.status(400).json({ error: 'Value must be a positive number' });
    }

    const result = await pool.query(
      `UPDATE system_settings
       SET setting_value = $1
       WHERE setting_key = $2
       RETURNING *`,
      [value, key]
    );

    if (result.rows.length === 0) {
      // Insert if doesn't exist
      const insertResult = await pool.query(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ($1, $2)
         RETURNING *`,
        [key, value]
      );
      res.json({
        message: 'Setting created',
        setting: insertResult.rows[0]
      });
    } else {
      res.json({
        message: 'Setting updated',
        setting: result.rows[0]
      });
    }
  } catch (error) {
    console.error('Error updating pricing setting:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users with filtering
router.get('/users/all', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { role } = req.query;

    let query = `
      SELECT
        id, email, full_name, role, phone, is_active, created_at
      FROM users
    `;

    const params = [];
    if (role) {
      query += ' WHERE role = $1';
      params.push(role);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user
router.put('/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, role, is_active, password } = req.body;

    // Check if email is being changed and if it already exists
    if (email) {
      const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, id]
      );

      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }

    let updateQuery = `
      UPDATE users
      SET full_name = COALESCE($1, full_name),
          email = COALESCE($2, email),
          phone = COALESCE($3, phone),
          role = COALESCE($4, role),
          is_active = COALESCE($5, is_active)
    `;

    const params = [full_name, email, phone, role, is_active];

    // If password is provided, hash and update it
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updateQuery += ', password_hash = $' + (params.length + 1);
      params.push(passwordHash);
    }

    updateQuery += ' WHERE id = $' + (params.length + 1) + ' RETURNING id, email, full_name, role, phone, is_active';
    params.push(id);

    const result = await pool.query(updateQuery, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'User updated successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user
router.delete('/users/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    // Don't allow deleting the current admin
    if (id === req.user.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await client.query('BEGIN');

    // Check if user owns any shops
    const shopsResult = await client.query(
      'SELECT COUNT(*) as count FROM shops WHERE owner_id = $1',
      [id]
    );

    if (parseInt(shopsResult.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'User owns shops and cannot be deleted.',
        shops_count: parseInt(shopsResult.rows[0].count)
      });
    }

    // Note: Other relationships (designer_id, registered_by, etc.) will be SET NULL automatically

    // Delete user (foreign key constraints will handle related data)
    const result = await client.query(
      'DELETE FROM users WHERE id = $1 RETURNING email',
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    await client.query('COMMIT');

    res.json({
      message: 'User deleted successfully',
      email: result.rows[0].email
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;