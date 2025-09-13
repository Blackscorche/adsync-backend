const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Configure multer for shop photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/shops');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'shop-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Get sales dashboard data
router.get('/dashboard', authenticateToken, requireRole(['sales']), async (req, res) => {
  try {
    const salesId = req.user.userId;

    // Get registered shops
    const shopsResult = await pool.query(
      `SELECT s.*, u.email as owner_email, u.full_name as owner_name
       FROM shops s
       LEFT JOIN users u ON s.owner_id = u.id
       WHERE s.registered_by = $1
       ORDER BY s.created_at DESC`,
      [salesId]
    );

    // Get commission stats
    const commissionResult = await pool.query(
      `SELECT
        COUNT(DISTINCT shop_id) as total_shops,
        COUNT(DISTINCT shop_id) FILTER (WHERE shops.approval_status = 'approved') as approved_shops,
        COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) as total_earned,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as total_paid
       FROM sales_commissions
       LEFT JOIN shops ON sales_commissions.shop_id = shops.id
       WHERE sales_user_id = $1`,
      [salesId]
    );

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
    );

    res.json({
      shops: shopsResult.rows,
      stats: commissionResult.rows[0],
      recentActivity: recentActivity.rows
    });
  } catch (error) {
    console.error('Error fetching sales dashboard:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register new shop with owner
router.post('/register-shop',
  authenticateToken,
  requireRole(['sales']),
  upload.single('shopPhoto'),
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

        // Owner details
        ownerEmail,
        ownerPassword,
        ownerFirstName,
        ownerLastName,
        ownerPhone
      } = req.body;

      // Validate required fields
      if (!shopName || !ownerEmail || !ownerPassword || !ownerFirstName || !ownerLastName) {
        return res.status(400).json({
          error: 'Missing required fields'
        });
      }

      // Start transaction
      await pool.query('BEGIN');

      try {
        // Check if email already exists
        const existingUser = await pool.query(
          'SELECT id FROM users WHERE email = $1',
          [ownerEmail]
        );

        if (existingUser.rows.length > 0) {
          await pool.query('ROLLBACK');
          return res.status(400).json({ error: 'Email already registered' });
        }

        // Create owner account (inactive until shop approved)
        const passwordHash = await bcrypt.hash(ownerPassword, 10);
        const fullName = `${ownerFirstName} ${ownerLastName}`;

        const ownerResult = await pool.query(
          `INSERT INTO users (email, password_hash, full_name, role, phone, is_active)
           VALUES ($1, $2, $3, 'owner', $4, false)
           RETURNING id`,
          [ownerEmail, passwordHash, fullName, ownerPhone]
        );

        const ownerId = ownerResult.rows[0].id;

        // Handle shop photo
        const photoUrl = req.file ? `/uploads/shops/${req.file.filename}` : null;

        // Create shop (pending approval)
        const shopResult = await pool.query(
          `INSERT INTO shops (
            name, owner_id, registered_by, address, city, postcode,
            phone, shop_type, approval_status
          )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
           RETURNING id`,
          [
            shopName, ownerId, req.user.userId, address, city,
            postcode, shopPhone, shopType || 'retail'
          ]
        );

        const shopId = shopResult.rows[0].id;

        // Create notification for admin
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, data)
           SELECT id, 'shop_registered', 'New Shop Registration',
                  $1, $2::jsonb
           FROM users WHERE role = 'admin'`,
          [
            `${shopName} has been registered and is pending approval`,
            JSON.stringify({ shop_id: shopId, shop_name: shopName })
          ]
        );

        await pool.query('COMMIT');

        res.status(201).json({
          message: 'Shop registered successfully and pending admin approval',
          shopId: shopId,
          status: 'pending'
        });

      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('Error registering shop:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// Get shops registered by this sales person
router.get('/my-shops', authenticateToken, requireRole(['sales']), async (req, res) => {
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
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sales shops:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get commission details
router.get('/commissions', authenticateToken, requireRole(['sales']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        sc.*,
        s.name as shop_name
       FROM sales_commissions sc
       LEFT JOIN shops s ON sc.shop_id = s.id
       WHERE sc.sales_user_id = $1
       ORDER BY sc.created_at DESC`,
      [req.user.userId]
    );

    const summary = await pool.query(
      `SELECT
        status,
        COUNT(*) as count,
        SUM(amount) as total
       FROM sales_commissions
       WHERE sales_user_id = $1
       GROUP BY status`,
      [req.user.userId]
    );

    res.json({
      commissions: result.rows,
      summary: summary.rows
    });
  } catch (error) {
    console.error('Error fetching commissions:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get performance metrics
router.get('/performance', authenticateToken, requireRole(['sales']), async (req, res) => {
  try {
    const salesId = req.user.userId;

    // Monthly performance
    const monthlyResult = await pool.query(
      `SELECT
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as shops_registered,
        COUNT(*) FILTER (WHERE approval_status = 'approved') as shops_approved
       FROM shops
       WHERE registered_by = $1
       GROUP BY DATE_TRUNC('month', created_at)
       ORDER BY month DESC
       LIMIT 12`,
      [salesId]
    );

    // Shop type breakdown
    const shopTypesResult = await pool.query(
      `SELECT
        shop_type,
        COUNT(*) as count
       FROM shops
       WHERE registered_by = $1
       GROUP BY shop_type`,
      [salesId]
    );

    // Revenue generated
    const revenueResult = await pool.query(
      `SELECT
        SUM(i.total_amount) as total_revenue
       FROM invoices i
       JOIN shops s ON i.shop_id = s.id
       WHERE s.registered_by = $1 AND i.status = 'paid'`,
      [salesId]
    );

    res.json({
      monthly: monthlyResult.rows,
      shopTypes: shopTypesResult.rows,
      totalRevenue: revenueResult.rows[0]?.total_revenue || 0
    });
  } catch (error) {
    console.error('Error fetching performance metrics:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;