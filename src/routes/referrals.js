const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Owner: Get referral reward amount
router.get('/reward-amount', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'referral_reward_amount'"
    );
    const amount = result.rows[0]?.setting_value || '25';
    res.json({ reward_amount: parseFloat(amount) });
  } catch (error) {
    console.error('Error fetching reward amount:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Owner: Submit a referral
router.post('/', authenticateToken, requireRole(['owner']), async (req, res) => {
  try {
    const { friendName, friendPhone } = req.body;

    if (!friendName || !friendPhone) {
      return res.status(400).json({ error: 'Friend name and phone are required' });
    }

    const userResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [req.user.userId]);
    const referrerName = userResult.rows[0]?.full_name || 'Unknown';

    const rewardResult = await pool.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'referral_reward_amount'"
    );
    const rewardAmount = parseFloat(rewardResult.rows[0]?.setting_value || '25');

    const result = await pool.query(
      'INSERT INTO referrals (referrer_id, referrer_name, friend_name, friend_phone, reward_amount) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.userId, referrerName, friendName, friendPhone, rewardAmount]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error submitting referral:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Owner: Get my referrals
router.get('/my', authenticateToken, requireRole(['owner']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM referrals WHERE referrer_id = $1 ORDER BY created_at DESC',
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching referrals:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get all referrals
router.get('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM referrals ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching referrals:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Update referral status
router.put('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'contacted', 'converted', 'rewarded', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await pool.query(
      'UPDATE referrals SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Referral not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating referral:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Update reward amount setting
router.put('/settings/reward-amount', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { amount } = req.body;

    if (amount === undefined || amount < 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    await pool.query(
      "UPDATE system_settings SET setting_value = $1 WHERE setting_key = 'referral_reward_amount'",
      [amount.toString()]
    );

    res.json({ message: 'Reward amount updated', reward_amount: amount });
  } catch (error) {
    console.error('Error updating reward amount:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
