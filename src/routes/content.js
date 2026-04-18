const express = require('express')
const path = require('path')
const pool = require('../config/database')
const { authenticateToken, requireRole } = require('../middleware/auth')
const {
  contentUpload,
  deleteFile,
  getFileUrl,
  getKeyFromUrl,
} = require('../services/digitalOceanSpaces')
const emailService = require('../services/email')

const router = express.Router()

// Get all content for a shop (owner) or all content (admin/design)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query
    let params = []

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
      `
    } else if (req.user.role === 'owner') {
      // Get shop_id for the owner
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE owner_id = $1',
        [req.user.userId]
      )

      if (shopResult.rows.length === 0) {
        return res.status(404).json({ error: 'Shop not found for this owner' })
      }

      const shopId = shopResult.rows[0].id
      query = `
        SELECT
          c.*,
          u.full_name as uploaded_by_name,
          r.full_name as reviewed_by_name,
          d.full_name as designed_by_name,
          sd.full_name as shop_designer_name
        FROM content c
        LEFT JOIN users u ON c.uploaded_by = u.id
        LEFT JOIN users r ON c.reviewed_by = r.id
        LEFT JOIN users d ON c.designed_by = d.id
        LEFT JOIN shops s ON c.shop_id = s.id
        LEFT JOIN users sd ON s.designer_id = sd.id
        WHERE c.shop_id = $1
        ORDER BY c.created_at DESC
      `
      params = [shopId]
    } else {
      return res.status(403).json({ error: 'Access denied' })
    }

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (error) {
    console.error('Error fetching content:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Handle OPTIONS preflight for upload endpoint
router.options('/upload', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  )
  res.status(200).end()
})

router.post(
  '/upload',
  authenticateToken,
  requireRole(['owner']),
  contentUpload.single('file'),
  async (req, res) => {
    let client
    try {
      client = await pool.connect()

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' })
      }

      await client.query('BEGIN')

      // Get shop details including credit balance and payment status
      // FOR UPDATE locks the row to prevent race conditions with concurrent uploads
      const shopResult = await client.query(
        `SELECT id, credit_balance, payment_status, free_upload_used
       FROM shops
       WHERE owner_id = $1
       FOR UPDATE`,
        [req.user.userId]
      )

      if (shopResult.rows.length === 0) {
        // Delete file from Spaces if shop not found
        await deleteFile(req.file.key)
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Shop not found for this owner' })
      }

      const shop = shopResult.rows[0]

      // Check if shop is active
      if (shop.payment_status !== 'active') {
        // Delete file from Spaces if shop inactive
        await deleteFile(req.file.key)
        await client.query('ROLLBACK')
        return res.status(403).json({
          error: 'Shop is inactive. Please pay outstanding bills to continue.',
          payment_status: shop.payment_status,
        })
      }

      // Get content upload price from settings
      const uploadPriceSettings = await client.query(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'content_upload_price'"
      )
      const UPLOAD_COST = parseFloat(
        uploadPriceSettings.rows[0]?.setting_value || 3.0
      )
      let chargeAmount = 0
      let wasFreeUpload = false

      const monthlyUploadResult = await client.query(
        `SELECT COUNT(*) as count
       FROM content
       WHERE shop_id = $1
       AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
       AND created_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
       AND was_free_upload = true`,
        [shop.id]
      )

      const hasUsedFreeUpload = parseInt(monthlyUploadResult.rows[0].count) > 0

      if (!hasUsedFreeUpload) {
        wasFreeUpload = true
        chargeAmount = 0
      } else {
        if (shop.credit_balance < UPLOAD_COST) {
          await deleteFile(req.file.key)
          await client.query('ROLLBACK')
          return res.status(402).json({
            error: 'Insufficient credit balance. Please top up to continue.',
            required_amount: UPLOAD_COST,
            current_balance: parseFloat(shop.credit_balance),
            message: `You need at least £${UPLOAD_COST.toFixed(2)} credit to upload additional content`,
          })
        }

        const deductResult = await client.query(
          'SELECT deduct_credit($1, $2, $3, $4) as success',
          [shop.id, UPLOAD_COST, 'upload_charge', 'Content upload']
        )

        if (!deductResult.rows[0].success) {
          await deleteFile(req.file.key)
          await client.query('ROLLBACK')
          return res.status(402).json({
            error: 'Failed to deduct credit. Please try again.',
            current_balance: parseFloat(shop.credit_balance),
          })
        }

        chargeAmount = UPLOAD_COST

        // Get commission percentage from settings
        const commissionSettings = await client.query(
          "SELECT setting_value FROM system_settings WHERE setting_key = 'commission_percentage'"
        )
        const commissionPercentage =
          parseFloat(commissionSettings.rows[0]?.setting_value || 10) / 100

        // Calculate sales commission for paid uploads
        const shopDetails = await client.query(
          'SELECT registered_by FROM shops WHERE id = $1',
          [shop.id]
        )

        if (shopDetails.rows[0]?.registered_by) {
          const commissionAmount = UPLOAD_COST * commissionPercentage

          await client.query(
            `
          INSERT INTO sales_commissions (
            sales_user_id, shop_id, commission_type, amount,
            percentage, status, month, description
          )
          VALUES ($1, $2, 'content', $3, $4, 'approved', DATE_TRUNC('month', CURRENT_DATE), $5)
        `,
            [
              shopDetails.rows[0].registered_by,
              shop.id,
              commissionAmount,
              commissionPercentage * 100,
              `${commissionPercentage * 100}% of content upload (£${UPLOAD_COST.toFixed(2)})`,
            ]
          )
        }
      }

      // Determine file type
      const ext = path.extname(req.file.originalname).toLowerCase()
      let fileType = 'image'
      if (['.mp4', '.avi', '.mov'].includes(ext)) {
        fileType = 'video'
      } else if (ext === '.pdf') {
        fileType = 'pdf'
      }

      // Create file URL using CDN
      const fileUrl = getFileUrl(req.file.key)

      const playlistScope = req.body.playlistScope || 'none'
      const playlistScopeValue = req.body.playlistScopeValue || null
      const startDate = req.body.startDate || null
      const endDate = req.body.endDate || null

      const result = await client.query(
        `INSERT INTO content
       (shop_id, uploaded_by, original_filename, file_url, file_type, status,
        was_free_upload, charge_amount, playlist_scope, playlist_scope_value,
        start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
        [
          shop.id,
          req.user.userId,
          req.file.originalname,
          fileUrl,
          fileType,
          'pending',
          wasFreeUpload,
          chargeAmount,
          playlistScope,
          playlistScopeValue,
          startDate,
          endDate,
        ]
      )

      // Get updated balance
      const updatedShopResult = await client.query(
        'SELECT credit_balance FROM shops WHERE id = $1',
        [shop.id]
      )

      await client.query('COMMIT')

      emailService.sendNewContentNotification(result.rows[0].id).catch(() => {})

      const response = {
        message: wasFreeUpload
          ? 'Content uploaded successfully (free monthly upload)'
          : `Content uploaded successfully (£${chargeAmount.toFixed(2)} charged)`,
        content: result.rows[0],
        credit_balance: parseFloat(updatedShopResult.rows[0].credit_balance),
        charge: chargeAmount,
        was_free: wasFreeUpload,
      }

      res.status(201).json(response)
    } catch (error) {
      console.error('Upload error:', error.message)
      if (client) {
        await client.query('ROLLBACK')
      }
      if (req.file && req.file.key) {
        await deleteFile(req.file.key)
      }
      res.status(500).json({ error: 'Server error: ' + error.message })
    } finally {
      if (client) {
        client.release()
      }
    }
  }
)

// Designer uploads his own design
router.post(
  '/upload/designer/:id',
  authenticateToken,
  requireRole(['design']),
  contentUpload.single('file'),
  async (req, res) => {
    let client
    try {
      client = await pool.connect()

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' })
      }

      await client.query('BEGIN')

      // Get shop details including credit balance and payment status
      // FOR UPDATE locks the row to prevent race conditions with concurrent uploads
      const shopResult = await client.query(
        `SELECT id, credit_balance, payment_status, free_upload_used
       FROM shops
       WHERE id = $1
       FOR UPDATE`,
        [parseInt(req.body.shopId, 10)]
      )

      if (shopResult.rows.length === 0) {
        // Delete file from Spaces if shop not found
        await deleteFile(req.file.key)
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Shop not found for this owner' })
      }

      const shop = shopResult.rows[0]

      console.log(shop)

      // Check if shop is active
      if (shop.payment_status !== 'active') {
        // Delete file from Spaces if shop inactive
        await deleteFile(req.file.key)
        await client.query('ROLLBACK')
        return res.status(403).json({
          error: 'Shop is inactive. Please pay outstanding bills to continue.',
          payment_status: shop.payment_status,
        })
      }

      // Get content upload price from settings
      const uploadPriceSettings = await client.query(
        "SELECT setting_value FROM system_settings WHERE setting_key = 'content_upload_price'"
      )
      const UPLOAD_COST = parseFloat(
        uploadPriceSettings.rows[0]?.setting_value || 3.0
      )
      let chargeAmount = 0
      let wasFreeUpload = false

      const monthlyUploadResult = await client.query(
        `SELECT COUNT(*) as count
       FROM content
       WHERE shop_id = $1
       AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
       AND created_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
       AND was_free_upload = true`,
        [shop.id]
      )

      const hasUsedFreeUpload = parseInt(monthlyUploadResult.rows[0].count) > 0

      if (!hasUsedFreeUpload) {
        wasFreeUpload = true
        chargeAmount = 0
      } else {
        if (shop.credit_balance < UPLOAD_COST) {
          await deleteFile(req.file.key)
          await client.query('ROLLBACK')
          return res.status(402).json({
            error: 'Insufficient credit balance. Please top up to continue.',
            required_amount: UPLOAD_COST,
            current_balance: parseFloat(shop.credit_balance),
            message: `You need at least £${UPLOAD_COST.toFixed(2)} credit to upload additional content`,
          })
        }

        const deductResult = await client.query(
          'SELECT deduct_credit($1, $2, $3, $4) as success',
          [shop.id, UPLOAD_COST, 'upload_charge', 'Content upload']
        )

        if (!deductResult.rows[0].success) {
          await deleteFile(req.file.key)
          await client.query('ROLLBACK')
          return res.status(402).json({
            error: 'Failed to deduct credit. Please try again.',
            current_balance: parseFloat(shop.credit_balance),
          })
        }

        chargeAmount = UPLOAD_COST

        // Get commission percentage from settings
        const commissionSettings = await client.query(
          "SELECT setting_value FROM system_settings WHERE setting_key = 'commission_percentage'"
        )
        const commissionPercentage =
          parseFloat(commissionSettings.rows[0]?.setting_value || 10) / 100

        // Calculate sales commission for paid uploads
        const shopDetails = await client.query(
          'SELECT registered_by FROM shops WHERE id = $1',
          [shop.id]
        )

        if (shopDetails.rows[0]?.registered_by) {
          const commissionAmount = UPLOAD_COST * commissionPercentage

          await client.query(
            `
          INSERT INTO sales_commissions (
            sales_user_id, shop_id, commission_type, amount,
            percentage, status, month, description
          )
          VALUES ($1, $2, 'content', $3, $4, 'approved', DATE_TRUNC('month', CURRENT_DATE), $5)
        `,
            [
              shopDetails.rows[0].registered_by,
              shop.id,
              commissionAmount,
              commissionPercentage * 100,
              `${commissionPercentage * 100}% of content upload (£${UPLOAD_COST.toFixed(2)})`,
            ]
          )
        }
      }

      // Determine file type
      const ext = path.extname(req.file.originalname).toLowerCase()
      let fileType = 'image'
      if (['.mp4', '.avi', '.mov'].includes(ext)) {
        fileType = 'video'
      } else if (ext === '.pdf') {
        fileType = 'pdf'
      }

      // Create file URL using CDN
      const fileUrl = getFileUrl(req.file.key)

      const playlistScope = req.body.playlistScope || 'none'
      const playlistScopeValue = req.body.playlistScopeValue || null

      const result = await client.query(
        `INSERT INTO content
       (shop_id, uploaded_by, original_filename, file_url, file_type, status,
        was_free_upload, charge_amount, playlist_scope, playlist_scope_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
        [
          shop.id,
          req.user.userId,
          req.file.originalname,
          fileUrl,
          fileType,
          'pending',
          wasFreeUpload,
          chargeAmount,
          playlistScope,
          playlistScopeValue,
        ]
      )

      // Get updated balance
      const updatedShopResult = await client.query(
        'SELECT credit_balance FROM shops WHERE id = $1',
        [shop.id]
      )

      await client.query('COMMIT')

      const response = {
        message: wasFreeUpload
          ? 'Content uploaded successfully (free monthly upload)'
          : `Content uploaded successfully (£${chargeAmount.toFixed(2)} charged)`,
        content: result.rows[0],
        credit_balance: parseFloat(updatedShopResult.rows[0].credit_balance),
        charge: chargeAmount,
        was_free: wasFreeUpload,
      }

      res.status(201).json(response)
    } catch (error) {
      console.error('Upload error:', error.message)
      if (client) {
        await client.query('ROLLBACK')
      }
      if (req.file && req.file.key) {
        await deleteFile(req.file.key)
      }
      res.status(500).json({ error: 'Server error: ' + error.message })
    } finally {
      if (client) {
        client.release()
      }
    }
  }
)

// Designer picks up content for editing
router.patch(
  '/:id/start-design',
  authenticateToken,
  requireRole(['design']),
  async (req, res) => {
    try {
      const { id } = req.params

      // First check if designer has access to this content's shop
      const accessCheck = await pool.query(
        `SELECT c.*, s.designer_id
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       WHERE c.id = $1`,
        [id]
      )

      if (accessCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Content not found' })
      }

      const content = accessCheck.rows[0]

      // Verify designer is assigned to this shop
      if (content.designer_id !== req.user.userId) {
        return res
          .status(403)
          .json({ error: 'You are not assigned to this shop' })
      }

      // Verify content is in pending or rejected status (can re-work rejected content)
      if (content.status !== 'pending' && content.status !== 'rejected') {
        return res.status(400).json({
          error: 'Content must be in pending or rejected status',
        })
      }

      const result = await pool.query(
        `UPDATE content
       SET status = 'in_design',
           designed_by = $1,
           designed_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
        [req.user.userId, id]
      )

      res.json({
        message: 'Content marked as in design',
        content: result.rows[0],
      })
    } catch (error) {
      console.error('Error starting design:', error)
      res.status(500).json({ error: 'Server error' })
    }
  }
)

// Designer uploads edited version
router.post(
  '/:id/upload-design',
  authenticateToken,
  requireRole(['design']),
  contentUpload.single('file'),
  async (req, res) => {
    try {
      const { id } = req.params

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' })
      }

      // Check if designer has access to this content's shop
      const accessCheck = await pool.query(
        `SELECT c.*, s.designer_id
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       WHERE c.id = $1`,
        [id]
      )

      if (accessCheck.rows.length === 0) {
        await deleteFile(req.file.key)
        return res.status(404).json({ error: 'Content not found' })
      }

      const content = accessCheck.rows[0]

      // Verify designer is assigned to this shop
      if (content.designer_id !== req.user.userId) {
        await deleteFile(req.file.key)
        return res
          .status(403)
          .json({ error: 'You are not assigned to this shop' })
      }

      // Verify content is in in_design status
      if (content.status !== 'in_design') {
        await deleteFile(req.file.key)
        return res.status(400).json({
          error:
            'Content must be in design phase. Please click "Start Design" first.',
        })
      }

      const fileUrl = getFileUrl(req.file.key)

      const result = await pool.query(
        `UPDATE content
       SET status = 'designed',
           designed_file_url = $1,
           designed_by = $2,
           designed_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
        [fileUrl, req.user.userId, id]
      )

      res.json({
        message: 'Designed content uploaded for admin review',
        content: result.rows[0],
      })
    } catch (error) {
      console.error('Error uploading design:', error)
      if (req.file && req.file.key) {
        await deleteFile(req.file.key)
      }
      res.status(500).json({ error: 'Server error' })
    }
  }
)

// Admin reviews designed content
router.patch(
  '/:id/review',
  authenticateToken,
  requireRole(['admin']),
  async (req, res) => {
    try {
      const { id } = req.params
      const { status, rejection_reason } = req.body

      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({
          error: 'Invalid status. Must be approved or rejected.',
        })
      }

      if (status === 'rejected' && !rejection_reason) {
        return res.status(400).json({
          error: 'Rejection reason is required when rejecting content.',
        })
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
      )

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Content not found or not ready for review',
        })
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
        content: result.rows[0],
      })
    } catch (error) {
      console.error('Error reviewing content:', error)
      res.status(500).json({ error: 'Server error' })
    }
  }
)

// Designer publishes approved content
router.patch(
  '/:id/publish',
  authenticateToken,
  requireRole(['design']),
  async (req, res) => {
    try {
      const { id } = req.params

      // Check if designer has access to this content's shop
      const accessCheck = await pool.query(
        `SELECT c.*, s.designer_id, s.name as shop_name
       FROM content c
       JOIN shops s ON c.shop_id = s.id
       WHERE c.id = $1`,
        [id]
      )

      if (accessCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Content not found' })
      }

      const content = accessCheck.rows[0]

      // Verify designer is assigned to this shop
      if (content.designer_id !== req.user.userId) {
        return res
          .status(403)
          .json({ error: 'You are not assigned to this shop' })
      }

      // Verify content is approved
      if (content.status !== 'approved') {
        return res.status(400).json({
          error: 'Content must be approved before publishing',
        })
      }

      const result = await pool.query(
        `UPDATE content
       SET status = 'published',
           published_by = $1,
           published_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
        [req.user.userId, id]
      )

      res.json({
        message: 'Content published successfully',
        content: result.rows[0],
      })
    } catch (error) {
      console.error('Error publishing content:', error)
      res.status(500).json({ error: 'Server error' })
    }
  }
)

// Delete content
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params

    // Get content details first
    const contentResult = await pool.query(
      'SELECT * FROM content WHERE id = $1',
      [id]
    )

    if (contentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' })
    }

    const content = contentResult.rows[0]

    // Check permissions
    if (req.user.role === 'owner') {
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE owner_id = $1',
        [req.user.userId]
      )

      if (
        shopResult.rows.length === 0 ||
        shopResult.rows[0].id !== content.shop_id
      ) {
        return res.status(403).json({ error: 'Access denied' })
      }
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Delete file from DigitalOcean Spaces
    const fileKey = getKeyFromUrl(content.file_url)
    if (fileKey) {
      await deleteFile(fileKey)
    }

    // Delete from database
    await pool.query('DELETE FROM content WHERE id = $1', [id])

    res.json({ message: 'Content deleted successfully' })
  } catch (error) {
    console.error('Error deleting content:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

// Get upload statistics for a shop
router.get(
  '/stats',
  authenticateToken,
  requireRole(['owner', 'admin']),
  async (req, res) => {
    try {
      let shopId

      if (req.user.role === 'owner') {
        const shopResult = await pool.query(
          'SELECT id FROM shops WHERE owner_id = $1',
          [req.user.userId]
        )

        if (shopResult.rows.length === 0) {
          return res.status(404).json({ error: 'Shop not found' })
        }
        shopId = shopResult.rows[0].id
      } else {
        shopId = req.query.shop_id
      }

      // Use database timezone to avoid issues
      const stats = await pool.query(
        `SELECT
        -- Count all uploads this month
        COUNT(CASE WHEN c.created_at >= DATE_TRUNC('month', CURRENT_DATE)
                    AND c.created_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
                    THEN 1 END) as total_uploads_this_month,
        -- Count free uploads used this month
        COUNT(CASE WHEN c.created_at >= DATE_TRUNC('month', CURRENT_DATE)
                    AND c.created_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
                    AND c.was_free_upload = true
                    THEN 1 END) as free_uploads_used,
        -- Status counts
        COUNT(CASE WHEN c.status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN c.status = 'in_design' OR c.status = 'designed' THEN 1 END) as in_progress_count,
        COUNT(CASE WHEN c.status = 'approved' OR c.status = 'published' THEN 1 END) as approved_count,
        COUNT(CASE WHEN c.status = 'rejected' THEN 1 END) as rejected_count
       FROM shops s
       LEFT JOIN content c ON s.id = c.shop_id
       WHERE s.id = $1
       GROUP BY s.id`,
        [shopId]
      )

      const result = stats.rows[0] || {
        total_uploads_this_month: 0,
        free_uploads_used: 0,
        pending_count: 0,
        in_progress_count: 0,
        approved_count: 0,
        rejected_count: 0,
      }

      res.json({
        free_uploads_limit: 1,
        total_uploads_this_month:
          parseInt(result.total_uploads_this_month) || 0,
        free_uploads_used: parseInt(result.free_uploads_used) || 0,
        free_uploads_remaining: Math.max(
          0,
          1 - parseInt(result.free_uploads_used || 0)
        ),
        pending_count: parseInt(result.pending_count) || 0,
        in_progress_count: parseInt(result.in_progress_count) || 0,
        approved_count: parseInt(result.approved_count) || 0,
        rejected_count: parseInt(result.rejected_count) || 0,
      })
    } catch (error) {
      console.error('Error fetching upload stats:', error)
      res.status(500).json({ error: 'Server error' })
    }
  }
)

module.exports = router
