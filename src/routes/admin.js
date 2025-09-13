const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const emailService = require('../services/email');

const router = express.Router();

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
             subscription_status = $5,
             free_content_reset_date = $6
         WHERE id = $7
         RETURNING owner_id, name, registered_by`,
        [
          status,
          rejection_reason,
          status === 'approved' ? designer_id : null,
          req.user.userId,
          status === 'approved' ? 'active' : 'pending',
          status === 'approved' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
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

        // Create commission record for sales team
        const commissionSettings = await pool.query(
          "SELECT setting_value FROM system_settings WHERE setting_key = 'commission_percentage'"
        );
        const commissionRate = parseFloat(commissionSettings.rows[0]?.setting_value || 10) / 100;

        await pool.query(
          `INSERT INTO sales_commissions (sales_user_id, shop_id, commission_type, amount, percentage, status, month)
           VALUES ($1, $2, 'registration', $3, $4, 'approved', DATE_TRUNC('month', CURRENT_DATE))`,
          [shop.registered_by, shopId, 50 * commissionRate, commissionRate * 100]
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
        // Delete owner account if rejected
        await pool.query('DELETE FROM users WHERE id = $1', [shop.owner_id]);

        // Notify sales team
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

// Update screen pricing
router.get('/screen-sizes', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM screen_sizes ORDER BY size_inches'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching screen sizes:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/screen-sizes', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { size_inches, monthly_fee } = req.body;

    const result = await pool.query(
      `INSERT INTO screen_sizes (size_inches, monthly_fee)
       VALUES ($1, $2)
       ON CONFLICT (size_inches)
       DO UPDATE SET monthly_fee = $2
       RETURNING *`,
      [size_inches, monthly_fee]
    );

    res.json({
      message: 'Screen size pricing updated',
      screenSize: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating screen size:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get system settings
router.get('/settings', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM system_settings');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update system setting
router.put('/settings/:key', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const result = await pool.query(
      `UPDATE system_settings
       SET setting_value = $1
       WHERE setting_key = $2
       RETURNING *`,
      [value, key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    res.json({
      message: 'Setting updated',
      setting: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;