const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get all screens for a shop
router.get('/shop/:shopId', authenticateToken, async (req, res) => {
  try {
    const shopId = req.params.shopId;

    // Check access
    if (req.user.role === 'owner' && req.user.shopId !== parseInt(shopId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(`
      SELECT 
        s.*,
        p.name as playlist_name,
        c.filename as current_content_name
      FROM screens s
      LEFT JOIN screen_playlists sp ON sp.screen_id = s.id
      LEFT JOIN playlists p ON p.id = sp.playlist_id
      LEFT JOIN content c ON c.id = s.current_content_id
      WHERE s.shop_id = $1
      ORDER BY s.name
    `, [shopId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching screens:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single screen details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const screenId = req.params.id;

    const result = await pool.query(`
      SELECT 
        s.*,
        sh.name as shop_name,
        sh.owner_id
      FROM screens s
      JOIN shops sh ON sh.id = s.shop_id
      WHERE s.id = $1
    `, [screenId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    const screen = result.rows[0];

    // Check access
    if (req.user.role === 'owner' && screen.owner_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(screen);
  } catch (error) {
    console.error('Error fetching screen:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new screen
router.post('/', authenticateToken, async (req, res) => {
  const client = await pool.connect();

  try {
    const { shopId, name, location, deviceId, size = '32_inch' } = req.body;

    // Check access
    if (req.user.role === 'owner' && req.user.shopId !== shopId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await client.query('BEGIN');

    // Check shop payment status and credit balance
    const shopResult = await client.query(
      'SELECT payment_status, credit_balance FROM shops WHERE id = $1 FOR UPDATE',
      [shopId]
    );

    if (shopResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = shopResult.rows[0];

    if (shop.payment_status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Shop is inactive. Please pay outstanding bills to add screens.',
        payment_status: shop.payment_status
      });
    }

    // Check if device ID already exists
    if (deviceId) {
      const existing = await client.query(
        'SELECT id FROM screens WHERE device_id = $1',
        [deviceId]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Device ID already registered' });
      }
    }

    // Determine monthly cost based on size
    const monthlyCosts = {
      '32_inch': 15.00,
      '43_inch': 20.00,
      '55_inch': 25.00
    };
    const monthlyCost = monthlyCosts[size] || 15.00;

    // Check if shop has enough credit for the screen
    if (parseFloat(shop.credit_balance) < monthlyCost) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: `Insufficient credit. Screen costs £${monthlyCost.toFixed(2)}/month. Please top up.`,
        required_amount: monthlyCost,
        current_balance: parseFloat(shop.credit_balance)
      });
    }

    // Deduct the first month's cost immediately
    const deductResult = await client.query(
      'SELECT deduct_credit($1, $2, $3, $4) as success',
      [shopId, monthlyCost, 'screen_subscription', `New ${size} screen - ${name}`]
    );

    if (!deductResult.rows[0].success) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'Failed to deduct credit. Please try again.',
        required_amount: monthlyCost,
        current_balance: parseFloat(shop.credit_balance)
      });
    }

    // Create the screen
    const result = await client.query(
      `INSERT INTO screens (shop_id, name, location, device_id, size, monthly_cost, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING *`,
      [shopId, name, location, deviceId, size, monthlyCost]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ...result.rows[0],
      message: `Screen added and £${monthlyCost.toFixed(2)} charged. Monthly subscription: £${monthlyCost.toFixed(2)}`
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating screen:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Update screen
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const screenId = req.params.id;
    const { name, location } = req.body;

    // Check ownership
    const screenCheck = await pool.query(`
      SELECT s.*, sh.owner_id 
      FROM screens s 
      JOIN shops sh ON sh.id = s.shop_id 
      WHERE s.id = $1
    `, [screenId]);

    if (screenCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    const screen = screenCheck.rows[0];
    if (req.user.role === 'owner' && screen.owner_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      'UPDATE screens SET name = $1, location = $2 WHERE id = $3 RETURNING *',
      [name, location, screenId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating screen:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete screen
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const screenId = req.params.id;

    // Check ownership
    const screenCheck = await pool.query(`
      SELECT s.*, sh.owner_id 
      FROM screens s 
      JOIN shops sh ON sh.id = s.shop_id 
      WHERE s.id = $1
    `, [screenId]);

    if (screenCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    const screen = screenCheck.rows[0];
    if (req.user.role === 'owner' && screen.owner_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await pool.query('DELETE FROM screens WHERE id = $1', [screenId]);

    res.json({ message: 'Screen deleted successfully' });
  } catch (error) {
    console.error('Error deleting screen:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Heartbeat endpoint for Android/iOS apps
router.post('/:deviceId/heartbeat', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { currentContentId, appVersion, deviceInfo } = req.body;

    // Update screen status
    const result = await pool.query(`
      UPDATE screens 
      SET 
        status = 'online',
        last_heartbeat = CURRENT_TIMESTAMP,
        current_content_id = $2
      WHERE device_id = $1
      RETURNING id, shop_id
    `, [deviceId, currentContentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Device not registered' });
    }

    // Get latest playlist for this screen
    const playlistResult = await pool.query(`
      SELECT 
        p.id,
        p.name,
        json_agg(
          json_build_object(
            'id', c.id,
            'url', c.file_url,
            'type', c.file_type,
            'duration', pi.duration
          ) ORDER BY pi.position
        ) as items
      FROM screen_playlists sp
      JOIN playlists p ON p.id = sp.playlist_id
      JOIN playlist_items pi ON pi.playlist_id = p.id
      JOIN content c ON c.id = pi.content_id
      WHERE sp.screen_id = $1 AND p.is_active = true
      GROUP BY p.id, p.name
      LIMIT 1
    `, [result.rows[0].id]);

    res.json({
      status: 'ok',
      playlist: playlistResult.rows[0] || null
    });
  } catch (error) {
    console.error('Error processing heartbeat:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;