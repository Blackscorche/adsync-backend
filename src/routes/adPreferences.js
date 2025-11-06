const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

/**
 * Get available ad categories
 * GET /api/ad-preferences/categories
 */
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'available_ad_categories'"
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ad categories not configured' });
    }

    const categories = JSON.parse(result.rows[0].setting_value);
    res.json({ categories });
  } catch (error) {
    console.error('Error fetching ad categories:', error);
    res.status(500).json({ error: 'Failed to fetch ad categories' });
  }
});

/**
 * Get shop ad preferences
 * GET /api/ad-preferences/:shopId
 */
router.get('/:shopId', authenticateToken, async (req, res) => {
  try {
    const { shopId } = req.params;

    // Verify access: shop owners can only view their own preferences, admins can view any
    if (req.user.role === 'owner' && req.user.shopId !== parseInt(shopId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT id, name, allow_outside_ads, blocked_ad_categories
       FROM shops
       WHERE id = $1`,
      [shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = result.rows[0];
    res.json({
      shopId: shop.id,
      shopName: shop.name,
      allowOutsideAds: shop.allow_outside_ads,
      blockedAdCategories: shop.blocked_ad_categories || []
    });
  } catch (error) {
    console.error('Error fetching ad preferences:', error);
    res.status(500).json({ error: 'Failed to fetch ad preferences' });
  }
});

/**
 * Update shop ad preferences
 * PUT /api/ad-preferences/:shopId
 */
router.put('/:shopId', authenticateToken, async (req, res) => {
  try {
    const { shopId } = req.params;
    const { allowOutsideAds, blockedAdCategories } = req.body;

    // Verify access: shop owners can only update their own preferences, admins can update any
    if (req.user.role === 'owner' && req.user.shopId !== parseInt(shopId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Validate input
    if (typeof allowOutsideAds !== 'boolean') {
      return res.status(400).json({ error: 'allowOutsideAds must be a boolean' });
    }

    if (!Array.isArray(blockedAdCategories)) {
      return res.status(400).json({ error: 'blockedAdCategories must be an array' });
    }

    // Update preferences
    const result = await pool.query(
      `UPDATE shops
       SET allow_outside_ads = $1,
           blocked_ad_categories = $2
       WHERE id = $3
       RETURNING id, name, allow_outside_ads, blocked_ad_categories`,
      [allowOutsideAds, blockedAdCategories, shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = result.rows[0];
    res.json({
      message: 'Ad preferences updated successfully',
      shopId: shop.id,
      shopName: shop.name,
      allowOutsideAds: shop.allow_outside_ads,
      blockedAdCategories: shop.blocked_ad_categories || []
    });
  } catch (error) {
    console.error('Error updating ad preferences:', error);
    res.status(500).json({ error: 'Failed to update ad preferences' });
  }
});

module.exports = router;
