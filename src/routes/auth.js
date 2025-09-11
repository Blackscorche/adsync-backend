const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

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

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query(
      'SELECT id, email, password_hash, full_name, role FROM users WHERE email = $1 AND is_active = true',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get shop info if user is owner
    let shopId = null;
    if (user.role === 'owner') {
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE owner_id = $1',
        [user.id]
      );
      shopId = shopResult.rows[0]?.id;
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        role: user.role,
        shopId: shopId 
      },
      process.env.JWT_SECRET || 'your-secret-key-here',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role,
        shopId: shopId
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register shop owner (with optional photo)
router.post('/register', upload.single('shopPhoto'), async (req, res) => {
  try {
    const { 
      email, 
      password, 
      firstName, 
      lastName, 
      phone,
      role = 'owner',
      shopName, 
      address,
      city,
      postcode,
      shopType,
      county,
      termsAccepted,
      termsAcceptedDate,
      adminKey
    } = req.body;

    // Validate admin registration
    if (role === 'admin') {
      if (adminKey !== 'IVAA-ADMIN-2024') {
        return res.status(403).json({ error: 'Invalid admin registration key' });
      }
    }

    // Check if email exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    const fullName = `${firstName} ${lastName}`;

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Create user
      const userResult = await pool.query(
        'INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [email, passwordHash, fullName, role, true]
      );

      const userId = userResult.rows[0].id;

      // Create shop for owner role
      if (role === 'owner' && shopName) {
        const fullAddress = `${address}, ${city}`;
        
        // Get photo URL if uploaded
        const photoUrl = req.file ? `/uploads/shops/${req.file.filename}` : null;
        
        const shopResult = await pool.query(
          'INSERT INTO shops (name, owner_id, address, phone, subscription_status, shop_type, postcode, city, county, photo_url, photo_uploaded_at, terms_accepted, terms_accepted_date, terms_accepted_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id',
          [
            shopName, 
            userId, 
            fullAddress, 
            phone, 
            'trial',
            shopType || 'retail',
            postcode,
            city,
            county,
            photoUrl,
            photoUrl ? new Date() : null,
            termsAccepted || false,
            termsAcceptedDate || null,
            termsAccepted ? userId : null
          ]
        );

        const shopId = shopResult.rows[0].id;

        // Generate token with shop info
        const token = jwt.sign(
          { 
            userId: userId, 
            email: email,
            role: role,
            shopId: shopId 
          },
          process.env.JWT_SECRET || 'your-secret-key-here',
          { expiresIn: '24h' }
        );

        await pool.query('COMMIT');

        return res.status(201).json({ 
          message: 'Registration successful',
          token,
          user: {
            id: userId,
            email: email,
            name: fullName,
            role: role,
            shopId: shopId
          }
        });
      }

      // For admin or design, no shop needed
      const token = jwt.sign(
        { 
          userId: userId, 
          email: email,
          role: role,
          shopId: null 
        },
        process.env.JWT_SECRET || 'your-secret-key-here',
        { expiresIn: '24h' }
      );

      await pool.query('COMMIT');

      res.status(201).json({ 
        message: 'Registration successful',
        token,
        user: {
          id: userId,
          email: email,
          name: fullName,
          role: role,
          shopId: null
        }
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify token
router.get('/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Change password
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    const validPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, userId]
    );

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;