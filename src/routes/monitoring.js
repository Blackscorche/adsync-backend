const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get all screens monitoring data (Admin only)
router.get('/screens', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.id,
        s.name as screen_name,
        s.device_id,
        s.location,
        s.status,
        s.last_heartbeat,
        s.current_content_id,
        sh.name as shop_name,
        sh.address as shop_address,
        c.original_filename as current_content
      FROM screens s
      JOIN shops sh ON s.shop_id = sh.id
      LEFT JOIN content c ON s.current_content_id = c.id
      ORDER BY sh.name, s.name
    `);

    const screens = result.rows.map(screen => ({
      id: screen.id,
      shopName: screen.shop_name,
      screenName: screen.screen_name,
      deviceId: screen.device_id,
      location: screen.location,
      status: screen.status === 'active' && screen.last_heartbeat ?
        (new Date() - new Date(screen.last_heartbeat) < 5 * 60 * 1000 ? 'online' : 'offline') :
        'offline',
      lastSeen: screen.last_heartbeat,
      currentContent: screen.current_content || 'No content'
    }));

    res.json(screens);
  } catch (error) {
    console.error('Get monitoring data error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get monitoring statistics (Admin only)
router.get('/stats', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const screensResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' AND last_heartbeat > NOW() - INTERVAL '5 minutes' THEN 1 END) as online,
        COUNT(CASE WHEN status != 'active' OR last_heartbeat IS NULL OR last_heartbeat <= NOW() - INTERVAL '5 minutes' THEN 1 END) as offline
      FROM screens
    `);

    const shopsResult = await pool.query(`
      SELECT COUNT(DISTINCT shop_id) as total_shops FROM screens
    `);

    res.json({
      total_screens: parseInt(screensResult.rows[0].total),
      online: parseInt(screensResult.rows[0].online),
      offline: parseInt(screensResult.rows[0].offline),
      total_shops: parseInt(shopsResult.rows[0].total_shops)
    });
  } catch (error) {
    console.error('Get monitoring stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;