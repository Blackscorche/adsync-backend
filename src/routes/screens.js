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
  try {
    const { shopId, name, location, deviceId } = req.body;

    // Check access
    if (req.user.role === 'owner' && req.user.shopId !== shopId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if device ID already exists
    if (deviceId) {
      const existing = await pool.query(
        'SELECT id FROM screens WHERE device_id = $1',
        [deviceId]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'Device ID already registered' });
      }
    }

    const result = await pool.query(
      'INSERT INTO screens (shop_id, name, location, device_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [shopId, name, location, deviceId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating screen:', error);
    res.status(500).json({ error: 'Server error' });
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