const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const router = express.Router();

router.get('/test', (req, res) => {
  res.json({
    message: 'Mobile routes are working!',
    timestamp: new Date().toISOString()
  });
});

router.post('/login', async (req, res) => {
  try {
    const { shop_id, device_id } = req.body;
    console.log('--- MOBILE LOGIN REQUEST ---');
    console.log('Body:', req.body);
    console.log('Shop ID:', shop_id, '(Type:', typeof shop_id, ')');
    console.log('Device ID:', device_id, '(Type:', typeof device_id, ')');
    console.log('----------------------------');

    if (!shop_id || !device_id) {
      return res.status(400).json({
        error: 'Shop ID and Device ID are required'
      });
    }
    const sId = shop_id.toString().trim();
    const dId = device_id.toString().trim();

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
        sh.address as shop_address,
        sh.phone as shop_phone
      FROM screens s
      JOIN shops sh ON sh.id = s.shop_id
      WHERE s.shop_id = $1::integer AND s.device_id = $2
    `, [parseInt(sId), dId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Screen not found. Please check your Shop ID and Device ID'
      });
    }

    const screen = result.rows[0];

    if (screen.shop_status !== 'approved') {
      return res.status(403).json({
        error: 'Shop is not approved yet'
      });
    }

    const token = jwt.sign(
      {
        screenId: screen.id,
        deviceId: device_id,
        shopId: shop_id,
        type: 'mobile'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    await pool.query(`
      UPDATE screens
      SET
        status = 'active',
        last_heartbeat = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [screen.id]);

    const response = {
      success: true,
      token,
      screen: {
        id: screen.id,
        name: screen.name,
        location: screen.location
      },
      shop: {
        id: screen.shop_id,
        name: screen.shop_name,
        address: screen.shop_address,
        phone: screen.shop_phone
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Mobile login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/heartbeat', async (req, res) => {

  try {
    const { shop_id, device_id, status, current_content } = req.body;

    if (!shop_id || !device_id) {
      return res.status(400).json({
        error: 'Shop ID and Device ID are required'
      });
    }

    const result = await pool.query(`
      UPDATE screens
      SET
        status = $3,
        last_heartbeat = CURRENT_TIMESTAMP
      WHERE shop_id = $1 AND device_id = $2
      RETURNING id
    `, [shop_id, device_id, status || 'online']);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    if (current_content) {
      console.log(`Screen ${device_id} playing: ${current_content.name} (ID: ${current_content.id})`);
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error processing mobile heartbeat:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/playlist', async (req, res) => {

  try {
    const { shop_id, device_id } = req.query;

    if (!shop_id || !device_id) {
      return res.status(400).json({
        error: 'Shop ID and Device ID are required'
      });
    }

    const sId = shop_id.toString().trim();
    const dId = device_id.toString().trim();

    const result = await pool.query(`
      SELECT
        s.id as screen_id,
        s.name as screen_name,
        p.id as playlist_id,
        p.name as playlist_name,
        p.status as playlist_status
      FROM screens s
      LEFT JOIN screen_playlists sp ON sp.screen_id = s.id
      LEFT JOIN playlists p ON p.id = sp.playlist_id
      WHERE s.shop_id = $1::integer AND s.device_id = $2
      ORDER BY sp.assigned_at DESC
      LIMIT 1
    `, [parseInt(sId), dId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    const screen = result.rows[0];

    if (!screen.playlist_id) {
      return res.json({
        id: null,
        name: null,
        items: [],
        message: 'No playlist assigned to this screen'
      });
    }

    const itemsResult = await pool.query(`
      SELECT
        pi.id,
        pi.position,
        pi.duration,
        c.id as content_id,
        c.original_filename as title,
        c.file_url,
        c.file_type,
        c.original_filename as name
      FROM playlist_items pi
      JOIN content c ON pi.content_id = c.id
      WHERE pi.playlist_id = $1
        AND (c.start_date IS NULL OR c.start_date <= CURRENT_DATE)
        AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
      ORDER BY pi.position
    `, [screen.playlist_id]);


    res.json({
      id: screen.playlist_id,
      name: screen.playlist_name,
      items: itemsResult.rows.map(item => ({
        id: item.content_id.toString(),
        title: item.title,
        name: item.name,
        type: item.file_type?.includes('video') ? 'video' : 'image',
        url: item.file_url,
        duration: item.duration
      }))
    });
  } catch (error) {
    console.error('Error fetching mobile playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/playback', async (req, res) => {
  try {
    const { shop_id, device_id, content_id, content_name } = req.body;

    if (!shop_id || !device_id || !content_id) {
      return res.status(400).json({
        error: 'Shop ID, Device ID, and Content ID are required'
      });
    }

    const screenResult = await pool.query(
      'SELECT id FROM screens WHERE shop_id = $1 AND device_id = $2',
      [shop_id, device_id]
    );
    const screenId = screenResult.rows[0]?.id || null;

    await pool.query(
      'INSERT INTO playback_logs (shop_id, screen_id, content_id, content_name) VALUES ($1, $2, $3, $4)',
      [shop_id, screenId, content_id, content_name || null]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error logging playback:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;