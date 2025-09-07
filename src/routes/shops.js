const express = require('express');
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get all shops (Admin only)
router.get('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        s.id, 
        s.name, 
        s.address, 
        s.phone,
        s.subscription_status,
        s.created_at,
        u.full_name as owner_name,
        u.email as owner_email,
        COUNT(DISTINCT sc.id) as screen_count
      FROM shops s
      LEFT JOIN users u ON s.owner_id = u.id
      LEFT JOIN screens sc ON sc.shop_id = s.id
      GROUP BY s.id, u.full_name, u.email
      ORDER BY s.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching shops:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single shop details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const shopId = req.params.id;
    
    // Check access (admin can see all, owner can see own)
    if (req.user.role === 'owner' && req.user.shopId !== parseInt(shopId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const shopResult = await db.query(`
      SELECT 
        s.*,
        u.full_name as owner_name,
        u.email as owner_email
      FROM shops s
      LEFT JOIN users u ON s.owner_id = u.id
      WHERE s.id = $1
    `, [shopId]);

    if (shopResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Get screens for this shop
    const screensResult = await db.query(
      'SELECT * FROM screens WHERE shop_id = $1 ORDER BY name',
      [shopId]
    );

    res.json({
      ...shopResult.rows[0],
      screens: screensResult.rows
    });
  } catch (error) {
    console.error('Error fetching shop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new shop (Admin only)
router.post('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { name, ownerEmail, ownerName, ownerPassword, address, phone } = req.body;

    await db.query('BEGIN');

    // Check if owner email exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [ownerEmail]
    );

    let ownerId;
    
    if (existingUser.rows.length > 0) {
      ownerId = existingUser.rows[0].id;
    } else {
      // Create new owner user
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(ownerPassword, 10);
      
      const userResult = await db.query(
        'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [ownerEmail, passwordHash, ownerName, 'owner']
      );
      ownerId = userResult.rows[0].id;
    }

    // Create shop
    const shopResult = await db.query(
      'INSERT INTO shops (name, owner_id, address, phone) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, ownerId, address, phone]
    );

    await db.query('COMMIT');

    res.status(201).json(shopResult.rows[0]);
  } catch (error) {
    await db.query('ROLLBACK');
    console.error('Error creating shop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update shop
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const shopId = req.params.id;
    const { name, address, phone } = req.body;

    // Check access
    if (req.user.role === 'owner' && req.user.shopId !== parseInt(shopId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await db.query(
      'UPDATE shops SET name = $1, address = $2, phone = $3 WHERE id = $4 RETURNING *',
      [name, address, phone, shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating shop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update subscription status (Admin only)
router.patch('/:id/subscription', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const shopId = req.params.id;
    const { status } = req.body;

    const result = await db.query(
      'UPDATE shops SET subscription_status = $1 WHERE id = $2 RETURNING *',
      [status, shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete shop (Admin only)
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const shopId = req.params.id;

    const result = await db.query(
      'DELETE FROM shops WHERE id = $1 RETURNING id',
      [shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    res.json({ message: 'Shop deleted successfully' });
  } catch (error) {
    console.error('Error deleting shop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;