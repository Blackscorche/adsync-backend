const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get available screen types
router.get('/types', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, size_inches, monthly_price, shop_ids
      FROM screen_types
      WHERE is_active = true
      ORDER BY size_inches
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching screen types:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get available screen types based on shop id
router.get('/types/shop/:shopId', authenticateToken, async (req, res) => {
  const {shopId} = req.params

  if (!shopId) {
      return res.status(400).json({ error: 'Shop ID is required' });
  }

  const id = parseInt(shopId);

  if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid Shop ID provided' });
  }

  try {
    const result = await pool.query(`
      SELECT id, name, size_inches, monthly_price, shop_ids
      FROM screen_types
      WHERE 
        $1 = ANY(shop_ids)
        AND is_active = true
      ORDER BY size_inches
    `,[id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching screen types:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Player App Authentication - Shop ID + Screen ID
router.post('/player/authenticate', async (req, res) => {
  try {
    const { shop_id, screen_id } = req.body;

    if (!shop_id || !screen_id) {
      return res.status(400).json({
        error: 'Shop ID and Screen ID are required'
      });
    }

    // Verify that screen belongs to the shop
    const result = await pool.query(`
      SELECT
        s.id,
        s.name,
        s.location,
        s.device_id,
        s.shop_id,
        s.status,
        sh.name as shop_name,
        sh.approval_status as shop_status,
        sh.payment_status
      FROM screens s
      JOIN shops sh ON sh.id = s.shop_id
      WHERE s.id = $1 AND s.shop_id = $2
    `, [screen_id, shop_id]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Invalid Shop ID or Screen ID'
      });
    }

    const screen = result.rows[0];

    // Check if shop is active
    if (screen.shop_status !== 'approved' || screen.payment_status !== 'active') {
      return res.status(403).json({
        error: 'Shop is not active. Please contact support.',
        shop_status: screen.shop_status,
        payment_status: screen.payment_status
      });
    }

    // Generate JWT token for the player app
    const token = jwt.sign(
      {
        shop_id: screen.shop_id,
        screen_id: screen.id,
        type: 'player'
      },
      process.env.JWT_SECRET,
      { expiresIn: '30d' } // Long expiry for player apps
    );

    // Update last connected timestamp
    await pool.query(
      'UPDATE screens SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = $1',
      [screen.id]
    );

    res.json({
      success: true,
      token,
      screen: {
        id: screen.id,
        name: screen.name,
        location: screen.location,
        shop_id: screen.shop_id,
        shop_name: screen.shop_name
      }
    });

  } catch (error) {
    console.error('Player authentication error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

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
        CASE
          WHEN s.status = 'active' AND s.last_heartbeat > NOW() - INTERVAL '5 minutes' THEN 'online'
          ELSE 'offline'
        END as computed_status,
        p.name as playlist_name,
        sp.playlist_id
      FROM screens s
      LEFT JOIN screen_playlists sp ON sp.screen_id = s.id
      LEFT JOIN playlists p ON p.id = sp.playlist_id
      WHERE s.shop_id = $1
      ORDER BY s.name
    `, [shopId]);

    // Map computed_status to status for backward compatibility
    const screens = result.rows.map(screen => ({
      ...screen,
      status: screen.computed_status || screen.status
    }));

    res.json(screens);
  } catch (error) {
    console.error('Error fetching screens:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

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
    const { shopId, name, location, deviceId, screenTypeId } = req.body;

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

    // Get screen type and pricing
    if (!screenTypeId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Screen type is required' });
    }

    const screenTypeResult = await client.query(
      'SELECT * FROM screen_types WHERE id = $1 AND is_active = true',
      [screenTypeId]
    );

    if (screenTypeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid screen type' });
    }

    const screenType = screenTypeResult.rows[0];
    const monthlyCost = parseFloat(screenType.monthly_price);

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
      [shopId, monthlyCost, 'screen_subscription', `New ${screenType.name} screen - ${name}`]
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
      `INSERT INTO screens (shop_id, name, location, device_id, screen_type_id, monthly_cost, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING *`,
      [shopId, name, location, deviceId, screenTypeId, monthlyCost]
    );

    // Get commission percentage from settings
    const commissionSettings = await client.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'commission_percentage'"
    );
    const commissionPercentage = parseFloat(commissionSettings.rows[0]?.setting_value || 10) / 100;

    // Calculate sales commission for this payment
    const shopDetails = await client.query(
      'SELECT registered_by FROM shops WHERE id = $1',
      [shopId]
    );

    if (shopDetails.rows[0]?.registered_by) {
      const commissionAmount = monthlyCost * commissionPercentage;

      await client.query(`
        INSERT INTO sales_commissions (
          sales_user_id, shop_id, commission_type, amount,
          percentage, status, month, description
        )
        VALUES ($1, $2, 'screen', $3, $4, 'approved', DATE_TRUNC('month', CURRENT_DATE), $5)
      `, [
        shopDetails.rows[0].registered_by,
        shopId,
        commissionAmount,
        commissionPercentage * 100,
        `${commissionPercentage * 100}% of new ${screenType.name} screen (£${monthlyCost.toFixed(2)})`
      ]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      ...result.rows[0],
      message: `Screen added and £${monthlyCost.toFixed(2)} charged. Monthly subscription: £${monthlyCost.toFixed(2)}`,
      screenType: screenType.name
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

// Get playlist for player app (using JWT auth)
router.get('/player/playlist', async (req, res) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      if (decoded.type !== 'player') {
        return res.status(403).json({ error: 'Invalid token type' });
      }

      const { screen_id } = decoded;

      // Get latest playlist for this screen
      const playlistResult = await pool.query(`
        SELECT
          p.id,
          p.name,
          p.updated_at,
          json_agg(
            json_build_object(
              'id', c.id,
              'url', c.file_url,
              'type', c.file_type,
              'filename', c.original_filename,
              'duration', pi.duration,
              'position', pi.position
            ) ORDER BY pi.position
          ) as items
        FROM screen_playlists sp
        JOIN playlists p ON p.id = sp.playlist_id
        JOIN playlist_items pi ON pi.playlist_id = p.id
        JOIN content c ON c.id = pi.content_id
        WHERE sp.screen_id = $1 AND p.is_active = true
        GROUP BY p.id, p.name, p.updated_at
        LIMIT 1
      `, [screen_id]);

      if (playlistResult.rows.length === 0) {
        return res.json({
          playlist: null,
          message: 'No playlist assigned to this screen'
        });
      }

      // Update heartbeat
      await pool.query(
        'UPDATE screens SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = $1',
        [screen_id]
      );

      res.json({
        playlist: playlistResult.rows[0]
      });

    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

  } catch (error) {
    console.error('Error fetching player playlist:', error);
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
        status = 'active',
        last_heartbeat = CURRENT_TIMESTAMP
      WHERE device_id = $1
      RETURNING id, shop_id
    `, [deviceId]);

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