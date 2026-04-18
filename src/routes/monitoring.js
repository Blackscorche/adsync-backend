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
        sh.name as shop_name,
        sh.address as shop_address
      FROM screens s
      JOIN shops sh ON s.shop_id = sh.id
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
      lastSeen: screen.last_heartbeat
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

// Ads played report (Admin only)
router.get('/reports/ads-played', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { from, to, shop_id } = req.query;
    const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const toDate = to || new Date().toISOString().split('T')[0];

    const params = [fromDate, toDate];
    let shopFilter = '';
    if (shop_id) {
      shopFilter = 'AND pl.shop_id = $3';
      params.push(shop_id);
    }

    const topContent = await pool.query(`
      SELECT
        pl.content_id,
        pl.content_name,
        c.original_filename,
        sh.name as shop_name,
        COUNT(*) as play_count,
        MAX(pl.played_at) as last_played
      FROM playback_logs pl
      LEFT JOIN content c ON pl.content_id = c.id
      LEFT JOIN shops sh ON pl.shop_id = sh.id
      WHERE pl.played_at::date BETWEEN $1 AND $2 ${shopFilter}
      GROUP BY pl.content_id, pl.content_name, c.original_filename, sh.name
      ORDER BY play_count DESC
      LIMIT 50
    `, params);

    const dailyTotals = await pool.query(`
      SELECT
        played_at::date as date,
        COUNT(*) as total_plays
      FROM playback_logs
      WHERE played_at::date BETWEEN $1 AND $2
      GROUP BY played_at::date
      ORDER BY date ASC
    `, [fromDate, toDate]);

    const summary = await pool.query(`
      SELECT
        COUNT(*) as total_plays,
        COUNT(DISTINCT content_id) as unique_content,
        COUNT(DISTINCT shop_id) as active_shops,
        COUNT(DISTINCT screen_id) as active_screens
      FROM playback_logs
      WHERE played_at::date BETWEEN $1 AND $2
    `, [fromDate, toDate]);

    res.json({
      summary: summary.rows[0],
      top_content: topContent.rows,
      daily_totals: dailyTotals.rows,
      from: fromDate,
      to: toDate
    });
  } catch (error) {
    console.error('Error fetching ads played report:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Shop subscriptions report (Admin only)
router.get('/reports/subscriptions', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const shops = await pool.query(`
      SELECT
        s.id,
        s.name,
        s.shop_type,
        s.payment_status,
        s.credit_balance,
        s.created_at,
        COUNT(DISTINCT sc.id) as screen_count,
        COALESCE(SUM(sc.monthly_cost), 0) as monthly_revenue,
        MAX(b.paid_at) as last_payment_date,
        COUNT(DISTINCT CASE WHEN b.status = 'pending' THEN b.id END) as unpaid_bills
      FROM shops s
      LEFT JOIN screens sc ON sc.shop_id = s.id
      LEFT JOIN billing b ON b.shop_id = s.id
      WHERE s.approval_status = 'approved'
      GROUP BY s.id, s.name, s.shop_type, s.payment_status, s.credit_balance, s.created_at
      ORDER BY monthly_revenue DESC
    `);

    const summary = await pool.query(`
      SELECT
        COUNT(*) as total_shops,
        COUNT(CASE WHEN payment_status = 'active' THEN 1 END) as active_shops,
        COUNT(CASE WHEN payment_status != 'active' THEN 1 END) as inactive_shops,
        COALESCE(SUM(credit_balance), 0) as total_credit_held
      FROM shops
      WHERE approval_status = 'approved'
    `);

    const monthlyRevenue = await pool.query(`
      SELECT
        DATE_TRUNC('month', bill_date) as month,
        COUNT(*) as bill_count,
        SUM(total_amount) as total_billed,
        SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) as total_collected
      FROM billing
      GROUP BY DATE_TRUNC('month', bill_date)
      ORDER BY month DESC
      LIMIT 12
    `);

    res.json({
      summary: summary.rows[0],
      shops: shops.rows,
      monthly_revenue: monthlyRevenue.rows
    });
  } catch (error) {
    console.error('Error fetching subscriptions report:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;