const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get designer's assigned shops
router.get('/my-shops', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        s.*,
        u.email as owner_email,
        u.full_name as owner_name,
        COUNT(DISTINCT sc.id) as screen_count,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'pending') as pending_content,
        COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'in_design') as in_design_content
       FROM shops s
       LEFT JOIN users u ON s.owner_id = u.id
       LEFT JOIN screens sc ON s.id = sc.shop_id
       LEFT JOIN content c ON s.id = c.shop_id
       WHERE s.designer_id = $1 AND s.approval_status = 'approved'
       GROUP BY s.id, u.email, u.full_name
       ORDER BY s.name`,
      [req.user.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching designer shops:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get content for a specific shop (for designers to add to playlists)
router.get('/shop/:shopId/content', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const { shopId } = req.params;

    // Validate shopId
    if (!shopId || shopId === 'undefined' || isNaN(parseInt(shopId))) {
      return res.status(400).json({ error: 'Invalid shop ID' });
    }

    // Verify designer is assigned to this shop
    const shopCheck = await pool.query(
      'SELECT id FROM shops WHERE id = $1 AND designer_id = $2',
      [parseInt(shopId), req.user.userId]
    );

    if (shopCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this shop' });
    }

    // Get approved/published content for the shop
    const result = await pool.query(
      `SELECT
        c.*,
        c.original_filename as title,
        u.full_name as uploaded_by_name
       FROM content c
       LEFT JOIN users u ON c.uploaded_by = u.id
       WHERE c.shop_id = $1
       AND c.status IN ('approved', 'published')
       ORDER BY c.created_at DESC`,
      [parseInt(shopId)]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching shop content:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/assigned-shops', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        s.id,
        s.name,
        s.address,
        s.phone,
        s.shop_type,
        s.photo_url,
        s.postcode,
        s.city,
        s.created_at,
        u.email,
        u.full_name as owner_name,
        COUNT(DISTINCT sc.id) as screen_count,
        COUNT(DISTINCT c.id) as content_count,
        COUNT(DISTINCT p.id) as playlist_count
       FROM shops s
       LEFT JOIN users u ON s.owner_id = u.id
       LEFT JOIN screens sc ON s.id = sc.shop_id
       LEFT JOIN content c ON s.id = c.shop_id
       LEFT JOIN playlists p ON s.id = p.shop_id
       WHERE s.designer_id = $1 AND s.approval_status = 'approved'
       GROUP BY s.id, u.email, u.full_name
       ORDER BY s.name`,
      [req.user.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching assigned shops:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all content for designer's shops (including published)
router.get('/pending-content', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        c.*,
        c.original_filename as title,
        s.name as shop_name,
        u.full_name as uploaded_by_name,
        r.full_name as reviewed_by_name,
        p.full_name as published_by_name
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       LEFT JOIN users u ON c.uploaded_by = u.id
       LEFT JOIN users r ON c.reviewed_by = r.id
       LEFT JOIN users p ON c.published_by = p.id
       WHERE s.designer_id = $1
         AND c.status IN ('pending', 'in_design', 'rejected', 'designed', 'approved', 'published')
       ORDER BY
         CASE
           WHEN c.status = 'rejected' THEN 0
           WHEN c.status = 'pending' THEN 1
           WHEN c.status = 'in_design' THEN 2
           WHEN c.status = 'designed' THEN 3
           WHEN c.status = 'approved' THEN 4
           WHEN c.status = 'published' THEN 5
           ELSE 6
         END,
         c.created_at DESC`,
      [req.user.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching pending content:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update content status to in_design
router.put('/content/:id/start-design', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const contentId = req.params.id;

    // Verify designer has access to this content's shop
    const accessCheck = await pool.query(
      `SELECT c.id
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       WHERE c.id = $1 AND s.designer_id = $2`,
      [contentId, req.user.userId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this content' });
    }

    const result = await pool.query(
      `UPDATE content
       SET status = 'in_design',
           designed_by = $1
       WHERE id = $2
       RETURNING *`,
      [req.user.userId, contentId]
    );

    res.json({
      message: 'Content marked as in design',
      content: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating content status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Submit designed content for review
router.put('/content/:id/submit-design', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const contentId = req.params.id;
    const { designed_file_url } = req.body;

    // Verify designer has access
    const accessCheck = await pool.query(
      `SELECT c.id
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       WHERE c.id = $1 AND s.designer_id = $2`,
      [contentId, req.user.userId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this content' });
    }

    const result = await pool.query(
      `UPDATE content
       SET status = 'designed',
           designed_by = $1,
           designed_at = CURRENT_TIMESTAMP,
           designed_file_url = $2
       WHERE id = $3
       RETURNING *`,
      [req.user.userId, designed_file_url, contentId]
    );

    // Notify admin for review
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, data)
       SELECT id, 'content_designed', 'Content Ready for Review',
              'New content has been designed and needs review',
              $1::jsonb
       FROM users WHERE role = 'admin'`,
      [JSON.stringify({ content_id: contentId })]
    );

    res.json({
      message: 'Design submitted for review',
      content: result.rows[0]
    });
  } catch (error) {
    console.error('Error submitting design:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Publish approved content (design team only)
router.post('/content/:id/publish', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const contentId = req.params.id;

    // Verify content is approved and designer has access
    const accessCheck = await pool.query(
      `SELECT c.id, c.shop_id, s.name as shop_name
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       WHERE c.id = $1
         AND s.designer_id = $2
         AND c.status = 'approved'`,
      [contentId, req.user.userId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Content not approved or access denied' });
    }

    const result = await pool.query(
      `UPDATE content
       SET status = 'published',
           published_by = $1,
           published_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [req.user.userId, contentId]
    );

    // Notify shop owner
    const shopData = accessCheck.rows[0];
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, data)
       SELECT owner_id, 'content_published', 'Content Published',
              'Your content has been published to screens',
              $1::jsonb
       FROM shops WHERE id = $2`,
      [JSON.stringify({ content_id: contentId }), shopData.shop_id]
    );

    res.json({
      message: 'Content published successfully',
      content: result.rows[0]
    });
  } catch (error) {
    console.error('Error publishing content:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get designer dashboard stats
router.get('/dashboard', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const designerId = req.user.userId;

    // Get assigned shops count
    const shopsResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM shops
       WHERE designer_id = $1 AND approval_status = 'approved'`,
      [designerId]
    );

    // Get content stats
    const contentStats = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE c.status = 'pending') as pending,
        COUNT(*) FILTER (WHERE c.status = 'in_design') as in_design,
        COUNT(*) FILTER (WHERE c.status = 'designed') as awaiting_review,
        COUNT(*) FILTER (WHERE c.status = 'published' AND c.published_at > CURRENT_DATE - INTERVAL '7 days') as published_this_week
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       WHERE s.designer_id = $1`,
      [designerId]
    );

    res.json({
      assigned_shops: parseInt(shopsResult.rows[0].count),
      content_stats: contentStats.rows[0]
    });
  } catch (error) {
    console.error('Error fetching designer dashboard:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;