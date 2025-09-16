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
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Get shop_id for the owner
    const shopResult = await pool.query(
      'SELECT id FROM shops WHERE owner_id = $1',
      [req.user.userId]
    );

    if (shopResult.rows.length === 0) {
      // Delete uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Shop not found for this owner' });
    }

    const shop = shopResult.rows[0];
    const FREE_UPLOADS_LIMIT = 1; // Each shop gets 1 free upload per month

    // Check upload limits - count uploads for current month
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const uploadCountResult = await pool.query(
      `SELECT COUNT(*) as count FROM content
       WHERE shop_id = $1
       AND created_at >= $2::date
       AND created_at < ($2::date + interval '1 month')
       AND is_extra_upload = false`,
      [shop.id, currentMonth + '-01']
    );

    const monthlyUploads = parseInt(uploadCountResult.rows[0].count);
    const isExtraUpload = monthlyUploads >= FREE_UPLOADS_LIMIT;

    if (isExtraUpload) {
      // For now, just block extra uploads since we don't have the extra_uploads table yet
      fs.unlinkSync(req.file.path);
      return res.status(403).json({
        error: 'Monthly upload limit reached. Please purchase additional uploads.',
        monthlyUploads,
        limit: FREE_UPLOADS_LIMIT
      });
    }

    // Determine file type
    const ext = path.extname(req.file.originalname).toLowerCase();
    let fileType = 'image';
    if (['.mp4', '.avi', '.mov'].includes(ext)) {
      fileType = 'video';
    } else if (ext === '.pdf') {
      fileType = 'pdf';
    }

    // Create file URL (without /api prefix, like shop photos)
    const fileUrl = `/uploads/content/${req.file.filename}`;
    const thumbnailUrl = `/uploads/thumbnails/${req.file.filename}`; // TODO: Generate actual thumbnail

    // Insert content record
    const result = await pool.query(
      `INSERT INTO content
       (shop_id, uploaded_by, original_filename, file_url, file_type, status, is_extra_upload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        shop.id,
        req.user.userId,
        req.file.originalname,
        fileUrl,
        fileType,
        'pending',
        isExtraUpload
      ]
    );

    res.status(201).json({
      message: 'Content uploaded successfully and pending approval',
      content: result.rows[0],
      isExtraUpload
    });
  } catch (error) {
    console.error('Error uploading content:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Designer picks up content for editing
router.patch('/:id/start-design', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE content
       SET status = 'in_design',
           designed_by = $1,
           designed_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [req.user.userId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found or already in design' });
    }

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

    const fileUrl = `/uploads/content/${req.file.filename}`;

    const result = await pool.query(
      `UPDATE content
       SET status = 'designed',
           designed_file_url = $1,
           designed_by = $2,
           designed_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND status = 'in_design'
       RETURNING *`,
      [fileUrl, req.user.userId, id]
    );

    if (result.rows.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Content not found or not in design phase' });
    }

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

    const result = await pool.query(
      `UPDATE content
       SET status = 'published',
           published_by = $1,
           published_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND status = 'approved'
       RETURNING *`,
      [req.user.userId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found or not approved for publishing' });
    }

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