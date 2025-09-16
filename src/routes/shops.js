const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get all shops (Admin and Design team)
router.get('/', authenticateToken, requireRole(['admin', 'design']), async (req, res) => {
  try {
    const { shop_type, city } = req.query;
    
    let query = `
      SELECT
        s.id,
        s.name,
        s.address,
        s.postcode,
        s.shop_type,
        s.phone,
        s.photo_url,
        s.subscription_status,
        s.created_at,
        u.full_name as owner_name,
        u.email as owner_email,
        COUNT(DISTINCT sc.id) as screen_count
      FROM shops s
      LEFT JOIN users u ON s.owner_id = u.id
      LEFT JOIN screens sc ON sc.shop_id = s.id
    `;
    
    const conditions = [];
    const params = [];
    
    if (shop_type) {
      params.push(shop_type);
      conditions.push(`s.shop_type = $${params.length}`);
    }
    
    if (city) {
      params.push(`%${city}%`);
      conditions.push(`s.address ILIKE $${params.length}`);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' GROUP BY s.id, u.full_name, u.email ORDER BY s.created_at DESC';
    
    const result = await pool.query(query, params);

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

    const shopResult = await pool.query(`
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
    const screensResult = await pool.query(
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
    const { 
      name, 
      ownerEmail, 
      ownerName, 
      ownerPassword, 
      address, 
      postcode,
      shop_type = 'retail',
      phone,
      contract_start_date,
      contract_end_date,
    } = req.body;

    await pool.query('BEGIN');

    // Check if owner email exists
    const existingUser = await pool.query(
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
      
      const userResult = await pool.query(
        'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [ownerEmail, passwordHash, ownerName, 'owner']
      );
      ownerId = userResult.rows[0].id;
    }

    // Create shop with new fields
    const shopResult = await pool.query(
      `INSERT INTO shops (
        name, 
        owner_id, 
        address, 
        postcode,
        shop_type,
        phone,
        contract_start_date,
        contract_end_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        name, 
        ownerId, 
        address, 
        postcode,
        shop_type,
        phone,
        contract_start_date || null,
        contract_end_date || null
      ]
    );

    await pool.query('COMMIT');

    res.status(201).json(shopResult.rows[0]);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error creating shop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update shop
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const shopId = req.params.id;
    const {
      name,
      address,
      postcode,
      shop_type,
      phone,
      contract_start_date,
      contract_end_date,
      designer_id
    } = req.body;

    // Check access
    if (req.user.role === 'owner' && req.user.shopId !== parseInt(shopId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 0;
    
    if (name !== undefined) {
      paramCount++;
      updates.push(`name = $${paramCount}`);
      values.push(name);
    }
    if (address !== undefined) {
      paramCount++;
      updates.push(`address = $${paramCount}`);
      values.push(address);
    }
    if (postcode !== undefined) {
      paramCount++;
      updates.push(`postcode = $${paramCount}`);
      values.push(postcode);
    }
    if (shop_type !== undefined) {
      paramCount++;
      updates.push(`shop_type = $${paramCount}`);
      values.push(shop_type);
    }
    if (phone !== undefined) {
      paramCount++;
      updates.push(`phone = $${paramCount}`);
      values.push(phone);
    }
    if (contract_start_date !== undefined) {
      paramCount++;
      updates.push(`contract_start_date = $${paramCount}`);
      values.push(contract_start_date);
    }
    if (contract_end_date !== undefined) {
      paramCount++;
      updates.push(`contract_end_date = $${paramCount}`);
      values.push(contract_end_date);
    }
    if (designer_id !== undefined) {
      paramCount++;
      updates.push(`designer_id = $${paramCount}`);
      values.push(designer_id);
    }

    paramCount++;
    values.push(shopId);
    
    const result = await pool.query(
      `UPDATE shops SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
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

    const result = await pool.query(
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

    const result = await pool.query(
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