const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
const contentDir = path.join(uploadsDir, 'content');
const thumbnailsDir = path.join(uploadsDir, 'thumbnails');

[contentDir, thumbnailsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, contentDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mov|pdf/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = allowedTypes.test(file.mimetype);
    const extName = allowedTypes.test(ext);

    if (mimeType && extName) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, videos, and PDFs are allowed.'));
    }
  }
});

// Get all content for a shop (owner) or all content (admin/design)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query;
    let params = [];

    if (req.user.role === 'admin' || req.user.role === 'design') {
      query = `
        SELECT 
          c.*,
          s.name as shop_name,
          u.full_name as uploaded_by_name,
          r.full_name as reviewed_by_name
        FROM content c
        LEFT JOIN shops s ON c.shop_id = s.id
        LEFT JOIN users u ON c.uploaded_by = u.id
        LEFT JOIN users r ON c.reviewed_by = r.id
        ORDER BY c.created_at DESC
      `;
    } else if (req.user.role === 'owner') {
      // Get shop_id for the owner
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE owner_id = $1',
        [req.user.userId]
      );
      
      if (shopResult.rows.length === 0) {
        return res.status(404).json({ error: 'Shop not found for this owner' });
      }

      const shopId = shopResult.rows[0].id;
      query = `
        SELECT 
          c.*,
          u.full_name as uploaded_by_name,
          r.full_name as reviewed_by_name
        FROM content c
        LEFT JOIN users u ON c.uploaded_by = u.id
        LEFT JOIN users r ON c.reviewed_by = r.id
        WHERE c.shop_id = $1
        ORDER BY c.created_at DESC
      `;
      params = [shopId];
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching content:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload content (owner only)
router.post('/upload', authenticateToken, requireRole(['owner']), upload.single('file'), async (req, res) => {
  const client = await pool.connect();

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    await client.query('BEGIN');

    // Get shop details including credit balance and payment status
    const shopResult = await client.query(
      `SELECT id, credit_balance, payment_status, free_upload_used
       FROM shops
       WHERE owner_id = $1
       FOR UPDATE`,
      [req.user.userId]
    );

    if (shopResult.rows.length === 0) {
      fs.unlinkSync(req.file.path);
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shop not found for this owner' });
    }

    const shop = shopResult.rows[0];

    // Check if shop is active
    if (shop.payment_status !== 'active') {
      fs.unlinkSync(req.file.path);
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Shop is inactive. Please pay outstanding bills to continue.',
        payment_status: shop.payment_status
      });
    }

    const UPLOAD_COST = 3.00;
    let chargeAmount = 0;
    let wasFreeUpload = false;

    // Check if this month's free upload has been used
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const monthlyUploadResult = await client.query(
      `SELECT COUNT(*) as count
       FROM content
       WHERE shop_id = $1
       AND created_at >= $2::date
       AND created_at < ($2::date + interval '1 month')
       AND was_free_upload = true`,
      [shop.id, currentMonth + '-01']
    );

    const hasUsedFreeUpload = parseInt(monthlyUploadResult.rows[0].count) > 0;

    if (!hasUsedFreeUpload) {
      // This is the free monthly upload
      wasFreeUpload = true;
      chargeAmount = 0;
    } else {
      // This is a paid upload - check credit balance
      if (shop.credit_balance < UPLOAD_COST) {
        fs.unlinkSync(req.file.path);
        await client.query('ROLLBACK');
        return res.status(402).json({
          error: 'Insufficient credit balance. Please top up to continue.',
          required_amount: UPLOAD_COST,
          current_balance: parseFloat(shop.credit_balance),
          message: 'You need at least £3.00 credit to upload additional content'
        });
      }

      // Deduct credit using the stored function
      const deductResult = await client.query(
        'SELECT deduct_credit($1, $2, $3, $4) as success',
        [shop.id, UPLOAD_COST, 'upload_charge', 'Content upload']
      );

      if (!deductResult.rows[0].success) {
        fs.unlinkSync(req.file.path);
        await client.query('ROLLBACK');
        return res.status(402).json({
          error: 'Failed to deduct credit. Please try again.',
          current_balance: parseFloat(shop.credit_balance)
        });
      }

      chargeAmount = UPLOAD_COST;
    }

    // Determine file type
    const ext = path.extname(req.file.originalname).toLowerCase();
    let fileType = 'image';
    if (['.mp4', '.avi', '.mov'].includes(ext)) {
      fileType = 'video';
    } else if (ext === '.pdf') {
      fileType = 'pdf';
    }

    // Create file URL
    const fileUrl = `/uploads/content/${req.file.filename}`;
    const thumbnailUrl = `/uploads/thumbnails/${req.file.filename}`;

    // Insert content record with charge information
    const result = await client.query(
      `INSERT INTO content
       (shop_id, uploaded_by, original_filename, file_url, file_type, status,
        was_free_upload, charge_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        shop.id,
        req.user.userId,
        req.file.originalname,
        fileUrl,
        fileType,
        'pending',
        wasFreeUpload,
        chargeAmount
      ]
    );

    // Get updated balance
    const updatedShopResult = await client.query(
      'SELECT credit_balance FROM shops WHERE id = $1',
      [shop.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: wasFreeUpload
        ? 'Content uploaded successfully (free monthly upload)'
        : `Content uploaded successfully (£${chargeAmount.toFixed(2)} charged)`,
      content: result.rows[0],
      credit_balance: parseFloat(updatedShopResult.rows[0].credit_balance),
      charge: chargeAmount,
      was_free: wasFreeUpload
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error uploading content:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Designer picks up content for editing
router.patch('/:id/start-design', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const { id } = req.params;

    // First check if designer has access to this content's shop
    const accessCheck = await pool.query(
      `SELECT c.*, s.designer_id
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       WHERE c.id = $1`,
      [id]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const content = accessCheck.rows[0];

    // Verify designer is assigned to this shop
    if (content.designer_id !== req.user.userId) {
      return res.status(403).json({ error: 'You are not assigned to this shop' });
    }

    // Verify content is in pending or rejected status (can re-work rejected content)
    if (content.status !== 'pending' && content.status !== 'rejected') {
      return res.status(400).json({ error: 'Content must be in pending or rejected status' });
    }

    const result = await pool.query(
      `UPDATE content
       SET status = 'in_design',
           designed_by = $1,
           designed_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [req.user.userId, id]
    );

    res.json({
      message: 'Content marked as in design',
      content: result.rows[0]
    });
  } catch (error) {
    console.error('Error starting design:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Designer uploads edited version
router.post('/:id/upload-design', authenticateToken, requireRole(['design']), upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Check if designer has access to this content's shop
    const accessCheck = await pool.query(
      `SELECT c.*, s.designer_id
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       WHERE c.id = $1`,
      [id]
    );

    if (accessCheck.rows.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Content not found' });
    }

    const content = accessCheck.rows[0];

    // Verify designer is assigned to this shop
    if (content.designer_id !== req.user.userId) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'You are not assigned to this shop' });
    }

    // Verify content is in in_design status
    if (content.status !== 'in_design') {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Content must be in design phase. Please click "Start Design" first.' });
    }

    const fileUrl = `/uploads/content/${req.file.filename}`;

    const result = await pool.query(
      `UPDATE content
       SET status = 'designed',
           designed_file_url = $1,
           designed_by = $2,
           designed_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [fileUrl, req.user.userId, id]
    );

    res.json({
      message: 'Designed content uploaded for admin review',
      content: result.rows[0]
    });
  } catch (error) {
    console.error('Error uploading design:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin reviews designed content
router.patch('/:id/review', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be approved or rejected.' });
    }

    if (status === 'rejected' && !rejection_reason) {
      return res.status(400).json({ error: 'Rejection reason is required when rejecting content.' });
    }

    const result = await pool.query(
      `UPDATE content
       SET status = $1,
           rejection_reason = $2,
           reviewed_by = $3,
           reviewed_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND status = 'designed'
       RETURNING *`,
      [status, rejection_reason || null, req.user.userId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found or not ready for review' });
    }

    // TODO: Implement notification system
    // if (status === 'approved') {
    //   // Create notification when notifications table is ready
    //   await pool.query(
    //     `INSERT INTO notifications (user_id, type, title, message)
    //      SELECT owner_id, 'content_approved', 'Content Approved', 
    //             'Your uploaded content has been approved and is now live.'
    //      FROM shops WHERE id = $1`,
    //     [result.rows[0].shop_id]
    //   );
    // }

    res.json({
      message: `Content ${status} successfully`,
      content: result.rows[0]
    });
  } catch (error) {
    console.error('Error reviewing content:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Designer publishes approved content
router.patch('/:id/publish', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if designer has access to this content's shop
    const accessCheck = await pool.query(
      `SELECT c.*, s.designer_id, s.name as shop_name
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       WHERE c.id = $1`,
      [id]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const content = accessCheck.rows[0];

    // Verify designer is assigned to this shop
    if (content.designer_id !== req.user.userId) {
      return res.status(403).json({ error: 'You are not assigned to this shop' });
    }

    // Verify content is approved
    if (content.status !== 'approved') {
      return res.status(400).json({ error: 'Content must be approved before publishing' });
    }

    const result = await pool.query(
      `UPDATE content
       SET status = 'published',
           published_by = $1,
           published_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [req.user.userId, id]
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

// Delete content
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get content details first
    const contentResult = await pool.query(
      'SELECT * FROM content WHERE id = $1',
      [id]
    );

    if (contentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const content = contentResult.rows[0];

    // Check permissions
    if (req.user.role === 'owner') {
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE owner_id = $1',
        [req.user.userId]
      );

      if (shopResult.rows.length === 0 || shopResult.rows[0].id !== content.shop_id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete file from filesystem (remove /api prefix from path)
    const relativePath = content.file_url.replace('/api', '');
    const filePath = path.join(__dirname, '../..', relativePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from database
    await pool.query('DELETE FROM content WHERE id = $1', [id]);

    res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    console.error('Error deleting content:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get upload statistics for a shop
router.get('/stats', authenticateToken, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    let shopId;

    if (req.user.role === 'owner') {
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE owner_id = $1',
        [req.user.userId]
      );
      
      if (shopResult.rows.length === 0) {
        return res.status(404).json({ error: 'Shop not found' });
      }
      shopId = shopResult.rows[0].id;
    } else {
      shopId = req.query.shop_id;
    }

    const currentMonth = new Date().toISOString().slice(0, 7);
    
    const stats = await pool.query(
      `SELECT
        COUNT(CASE WHEN c.created_at >= $2::date
                    AND c.created_at < ($2::date + interval '1 month')
                    AND c.is_extra_upload = false
                    THEN 1 END) as monthly_uploads,
        COUNT(CASE WHEN c.status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN c.status = 'approved' THEN 1 END) as approved_count,
        COUNT(CASE WHEN c.status = 'rejected' THEN 1 END) as rejected_count,
        0 as extra_uploads_remaining
       FROM shops s
       LEFT JOIN content c ON s.id = c.shop_id
       WHERE s.id = $1
       GROUP BY s.id`,
      [shopId, currentMonth + '-01']
    );

    res.json(stats.rows[0] || {
      free_uploads_limit: 1,
      monthly_uploads: 0,
      pending_count: 0,
      approved_count: 0,
      rejected_count: 0,
      extra_uploads_remaining: 0
    });
  } catch (error) {
    console.error('Error fetching upload stats:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;