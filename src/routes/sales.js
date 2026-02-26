const express = require('express')
const bcrypt = require('bcryptjs')
const pool = require('../config/database')
const { authenticateToken, requireRole } = require('../middleware/auth')
const {
  shopUpload,
  getFileUrl,
  deleteFile,
  getKeyFromUrl,
} = require('../services/digitalOceanSpaces')

const router = express.Router()

// Get sales dashboard data
router.get(
  '/dashboard',
  authenticateToken,
  requireRole(['sales']),
  async (req, res) => {
    try {
      const salesId = req.user.userId

      // Get registered shops
      const shopsResult = await pool.query(
        `SELECT s.*, u.email as owner_email, u.full_name as owner_name
       FROM shops s
       LEFT JOIN users u ON s.owner_id = u.id
       WHERE s.registered_by = $1
       ORDER BY s.created_at DESC`,
        [salesId]
      )

      // Get shop stats - count directly from shops table
      const shopStats = await pool.query(
        `SELECT
        COUNT(*) as total_shops,
        COUNT(*) FILTER (WHERE approval_status = 'approved') as approved_shops
       FROM shops
       WHERE registered_by = $1`,
        [salesId]
      )

      // Get commission stats
      const commissionResult = await pool.query(
        `SELECT
        COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) as total_earned,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as total_paid
       FROM sales_commissions
       WHERE sales_user_id = $1`,
        [salesId]
      )

      // Get recent activity
      const recentActivity = await pool.query(
        `SELECT
        s.name as shop_name,
        s.approval_status,
        s.created_at,
        s.approved_at
       FROM shops s
       WHERE s.registered_by = $1
       ORDER BY s.created_at DESC
       LIMIT 10`,
        [salesId]
      )

      // Combine stats from both queries
      const combinedStats = {
        total_shops: parseInt(shopStats.rows[0].total_shops),
        approved_shops: parseInt(shopStats.rows[0].approved_shops),
        total_earned: parseFloat(commissionResult.rows[0].total_earned),
        total_paid: parseFloat(commissionResult.rows[0].total_paid),
      }

      res.json({
        shops: shopsResult.rows,
        stats: combinedStats,
        recentActivity: recentActivity.rows,
      })
    } catch (error) {
      console.error('Error fetching sales dashboard:', error)
      res.status(500).json({ error: 'Server error' })
    }
  }
)

// Register new shop with owner
router.post(
  '/register-shop',
  authenticateToken,
  requireRole(['sales', 'admin']),
  shopUpload.fields([
    { name: 'shopPhoto', maxCount: 1 },
    { name: 'windowsPhoto', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        // Shop details
        shopName,
        address,
        city,
        postcode,
        shopPhone,
        shopType,
        vatNumber,
        promotionType,
        wifiConnection,
        wifiDistance,
        cableSupport,
        cableLength,
        displayFixedAt,
        windowsPhotoUrl,

        // Owner details
        ownerEmail,
        ownerPassword,
        ownerFirstName,
        ownerLastName,
        ownerPhone,
      } = req.body

      // Validate required fields
      if (
        !shopName ||
        !ownerEmail ||
        !ownerPassword ||
        !ownerFirstName ||
        !ownerLastName ||
        !vatNumber ||
        !promotionType ||
        !wifiConnection ||
        !wifiDistance ||
        !cableSupport ||
        !displayFixedAt
      ) {
        return res.status(400).json({
          error: 'Missing required fields (including VAT number)',
        })
      }

      // Start transaction
      await pool.query('BEGIN')

      try {
        // Check if email already exists
        const existingUser = await pool.query(
          'SELECT id FROM users WHERE email = $1',
          [ownerEmail]
        )

        if (existingUser.rows.length > 0) {
          await pool.query('ROLLBACK')
          return res.status(400).json({ error: 'Email already registered' })
        }

        // Create owner account (inactive until shop approved)
        const passwordHash = await bcrypt.hash(ownerPassword, 10)
        const fullName = `${ownerFirstName} ${ownerLastName}`

        const ownerResult = await pool.query(
          `INSERT INTO users (email, password_hash, full_name, role, phone, is_active)
           VALUES ($1, $2, $3, 'owner', $4, false)
           RETURNING id`,
          [ownerEmail, passwordHash, fullName, ownerPhone]
        )

        const ownerId = ownerResult.rows[0].id

        // Handle shop photo
        const photoUrl = req.file ? getFileUrl(req.file.key) : null

        // Create shop (pending approval)
        const shopResult = await pool.query(
          `INSERT INTO shops (
            name, owner_id, registered_by, address, city, postcode,
            phone, shop_type, approval_status, photo_url, subscription_status,
            commission_rate, vat_number, promotion_type, wifi_connection, wifi_distance, cable_support, cable_length, display_fixed_at, windows_photo_url, created_at
          )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, 'trial', 10.00, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP)
           RETURNING id`,
          [
            shopName,
            ownerId,
            req.user.userId,
            address,
            city,
            postcode,
            shopPhone,
            shopType || 'retail',
            photoUrl,
            vatNumber,
            promotionType,
            wifiConnection,
            wifiDistance,
            cableSupport,
            cableLength,
            displayFixedAt,
            windowsPhotoUrl,
          ]
        )

        const shopId = shopResult.rows[0].id

        // Update user with shop_id reference
        await pool.query('UPDATE users SET shop_id = $1 WHERE id = $2', [
          shopId,
          ownerId,
        ])

        // Create notification for admin
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, data)
           SELECT id, 'shop_registered', 'New Shop Registration',
                  $1, $2::jsonb
           FROM users WHERE role = 'admin'`,
          [
            `${shopName} has been registered and is pending approval`,
            JSON.stringify({ shop_id: shopId, shop_name: shopName }),
          ]
        )

        await pool.query('COMMIT')

        res.status(201).json({
          message: 'Shop registered successfully and pending admin approval',
          shopId: shopId,
          status: 'pending',
        })
      } catch (error) {
        await pool.query('ROLLBACK')
        throw error
      }
    } catch (error) {
      console.error('Error registering shop:', error)
      res.status(500).json({ error: 'Server error' })
    }
  }
)

// Get shops registered by this sales person
router.get(
  '/my-shops',
  authenticateToken,
  requireRole(['sales']),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
        s.*,
        u.email as owner_email,
        u.full_name as owner_name,
        d.full_name as designer_name,
        COUNT(DISTINCT sc.id) as screen_count
       FROM shops s
       LEFT JOIN users u ON s.owner_id = u.id
       LEFT JOIN users d ON s.designer_id = d.id
       LEFT JOIN screens sc ON s.id = sc.shop_id
       WHERE s.registered_by = $1
       GROUP BY s.id, u.email, u.full_name, d.full_name
       ORDER BY s.created_at DESC`,
        [req.user.userId]
      )

      res.json(result.rows)
    } catch (error) {
      console.error('Error fetching sales shops:', error)
      res.status(500).json({ error: 'Server error' })
    }
  }
)

// Get commission details
router.get(
  '/commissions',
  authenticateToken,
  requireRole(['sales']),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
        sc.*,
        s.name as shop_name,
        s.approval_status,
        s.created_at as shop_registered_at,
        s.approved_at
       FROM sales_commissions sc
       LEFT JOIN shops s ON sc.shop_id = s.id
       WHERE sc.sales_user_id = $1
       ORDER BY sc.created_at DESC`,
        [req.user.userId]
      )

      const summary = await pool.query(
        `SELECT
        status,
        COUNT(*) as count,
        SUM(amount) as total
       FROM sales_commissions
       WHERE sales_user_id = $1
       GROUP BY status
       UNION ALL
       SELECT
        'total' as status,
        COUNT(*) as count,
        SUM(amount) as total
       FROM sales_commissions
       WHERE sales_user_id = $1`,
        [req.user.userId]
      )

      // Calculate commission stats
      const stats = {
        pending: { count: 0, total: 0 },
        approved: { count: 0, total: 0 },
        paid: { count: 0, total: 0 },
        total: { count: 0, total: 0 },
      }

      summary.rows.forEach((row) => {
        stats[row.status] = {
          count: parseInt(row.count),
          total: parseFloat(row.total || 0),
        }
      })

      res.json({
        commissions: result.rows,
        summary: summary.rows,
        stats: stats,
        commissionInfo: {
          howItWorks: [
            'You earn commission when shops you register get approved by admin',
            'Standard commission rate is 10% of monthly shop subscription',
            "Commission status changes from 'pending' → 'approved' → 'paid'",
            'Payments are processed monthly for approved commissions',
          ],
          rates: {
            standard: '10% of monthly subscription',
            bonus: 'Additional bonuses for high performance',
          },
        },
      })
    } catch (error) {
      console.error('Error fetching commissions:', error)
      res.status(500).json({ error: 'Server error' })
    }
  }
)

// Get performance metrics
router.get(
  '/performance',
  authenticateToken,
  requireRole(['sales']),
  async (req, res) => {
    try {
      const salesId = req.user.userId
      const { period = 'current_month', year = new Date().getFullYear() } =
        req.query

      // Get overall performance stats
      const overallStats = await pool.query(
        `SELECT
        COUNT(*) as shops_registered,
        COUNT(*) FILTER (WHERE approval_status = 'approved') as shops_approved,
        COALESCE(SUM(sc.amount) FILTER (WHERE sc.status = 'approved'), 0) as commission_earned,
        COALESCE(SUM(sc.amount) FILTER (WHERE sc.status = 'paid'), 0) as commission_paid
       FROM shops s
       LEFT JOIN sales_commissions sc ON s.id = sc.shop_id AND sc.sales_user_id = $1
       WHERE s.registered_by = $1`,
        [salesId]
      )

      const stats = overallStats.rows[0]
      const approvalRate =
        stats.shops_registered > 0
          ? (parseInt(stats.shops_approved) /
              parseInt(stats.shops_registered)) *
            100
          : 0

      const target = 1500 // Monthly target
      const achievementRate =
        target > 0 ? (parseFloat(stats.commission_earned) / target) * 100 : 0

      // Monthly performance
      const monthlyResult = await pool.query(
        `SELECT
        TO_CHAR(DATE_TRUNC('month', s.created_at), 'Month') as month,
        COUNT(*) as registrations,
        COUNT(*) FILTER (WHERE s.approval_status = 'approved') as approvals,
        COALESCE(SUM(sc.amount) FILTER (WHERE sc.status IN ('approved', 'paid')), 0) as earnings,
        1200 as target,
        CASE WHEN COUNT(*) > 0
          THEN (COUNT(*) FILTER (WHERE s.approval_status = 'approved')::float / COUNT(*)::float * 100)
          ELSE 0
        END as performance
       FROM shops s
       LEFT JOIN sales_commissions sc ON s.id = sc.shop_id AND sc.sales_user_id = $1
       WHERE s.registered_by = $1
         AND EXTRACT(YEAR FROM s.created_at) = $2
       GROUP BY DATE_TRUNC('month', s.created_at)
       ORDER BY DATE_TRUNC('month', s.created_at) DESC
       LIMIT 12`,
        [salesId, year]
      )

      // Shop type breakdown
      const shopTypesResult = await pool.query(
        `SELECT
        shop_type,
        COUNT(*) as count
       FROM shops
       WHERE registered_by = $1
       GROUP BY shop_type`,
        [salesId]
      )

      res.json({
        summary: {
          period:
            period === 'current_month' ? 'Current Month' : 'Custom Period',
          shops_registered: parseInt(stats.shops_registered),
          shops_approved: parseInt(stats.shops_approved),
          approval_rate: Math.round(approvalRate * 10) / 10, // Round to 1 decimal
          commission_earned: parseFloat(stats.commission_earned),
          commission_paid: parseFloat(stats.commission_paid),
          target: target,
          achievement_rate: Math.round(achievementRate * 10) / 10,
        },
        monthly: monthlyResult.rows,
        shopTypes: shopTypesResult.rows,
      })
    } catch (error) {
      console.error('Error fetching performance metrics:', error)
      res.status(500).json({ error: 'Server error' })
    }
  }
)

module.exports = router
