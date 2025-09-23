const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const emailService = require('../services/email');

const router = express.Router();

// Create screen request (Shop Owner)
router.post('/', authenticateToken, requireRole(['owner']), async (req, res) => {
  const client = await pool.connect();

  try {
    const { screenName, location, screenTypeId } = req.body;
    const shopId = req.user.shopId;
    const userId = req.user.userId;

    if (!screenName || !screenTypeId) {
      return res.status(400).json({
        error: 'Screen name and type are required'
      });
    }

    await client.query('BEGIN');

    // Get shop details and check credit balance
    const shopResult = await client.query(
      'SELECT * FROM shops WHERE id = $1 FOR UPDATE',
      [shopId]
    );

    if (shopResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = shopResult.rows[0];

    // Get screen type details
    const screenTypeResult = await client.query(
      'SELECT * FROM screen_types WHERE id = $1 AND is_active = true',
      [screenTypeId]
    );

    if (screenTypeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid screen type' });
    }

    const screenType = screenTypeResult.rows[0];
    const monthlyCost = parseFloat(screenType.monthly_price);

    // Check credit balance
    if (parseFloat(shop.credit_balance) < monthlyCost) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: `Insufficient credit. Screen costs £${monthlyCost.toFixed(2)}/month. Please top up.`,
        required_amount: monthlyCost,
        current_balance: parseFloat(shop.credit_balance)
      });
    }

    // Deduct credit immediately
    const deductResult = await client.query(
      'SELECT deduct_credit($1, $2, $3, $4) as success',
      [shopId, monthlyCost, 'screen_request', `Screen request: ${screenType.name} - ${screenName}`]
    );

    if (!deductResult.rows[0].success) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        error: 'Failed to process payment',
        required_amount: monthlyCost,
        current_balance: parseFloat(shop.credit_balance)
      });
    }

    // Get the transaction ID
    const transactionResult = await client.query(
      `SELECT id FROM credit_transactions
       WHERE shop_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [shopId]
    );

    // Create screen request
    const requestResult = await client.query(
      `INSERT INTO screen_requests (
        shop_id, requested_by, screen_name, location,
        screen_type_id, monthly_cost, payment_amount, transaction_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        shopId, userId, screenName, location,
        screenTypeId, monthlyCost, monthlyCost,
        transactionResult.rows[0].id
      ]
    );

    await client.query('COMMIT');

    // Send notification email to admins
    try {
      await emailService.sendScreenRequestNotification(requestResult.rows[0]);
    } catch (emailError) {
      console.error('Failed to send email notification:', emailError);
    }

    res.json({
      message: 'Screen request submitted successfully',
      request: requestResult.rows[0],
      expires_at: requestResult.rows[0].expires_at
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create screen request error:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Get all screen requests (Admin)
router.get('/admin', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT
        sr.*,
        s.name as shop_name,
        s.address as shop_address,
        u.full_name as requester_name,
        u.email as requester_email,
        st.name as screen_type_name,
        st.size_inches,
        ru.full_name as reviewer_name
      FROM screen_requests sr
      JOIN shops s ON sr.shop_id = s.id
      JOIN users u ON sr.requested_by = u.id
      JOIN screen_types st ON sr.screen_type_id = st.id
      LEFT JOIN users ru ON sr.reviewed_by = ru.id
    `;

    const params = [];
    if (status && status !== 'all') {
      query += ' WHERE sr.status = $1';
      params.push(status);
    }

    query += ' ORDER BY sr.created_at DESC';

    const result = await pool.query(query, params);

    res.json(result.rows);

  } catch (error) {
    console.error('Get screen requests error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get shop's screen requests (Shop Owner)
router.get('/shop', authenticateToken, requireRole(['owner']), async (req, res) => {
  try {
    const shopId = req.user.shopId;

    const result = await pool.query(
      `SELECT
        sr.*,
        st.name as screen_type_name,
        st.size_inches,
        u.full_name as reviewer_name,
        s.name as screen_name_created,
        s.device_id as assigned_device_id
      FROM screen_requests sr
      JOIN screen_types st ON sr.screen_type_id = st.id
      LEFT JOIN users u ON sr.reviewed_by = u.id
      LEFT JOIN screens s ON sr.screen_id = s.id
      WHERE sr.shop_id = $1
      ORDER BY sr.created_at DESC`,
      [shopId]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Get shop screen requests error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Approve screen request (Admin)
router.post('/:requestId/approve', authenticateToken, requireRole(['admin']), async (req, res) => {
  const client = await pool.connect();

  try {
    const { requestId } = req.params;
    const { deviceId } = req.body;
    const reviewerId = req.user.userId;

    if (!deviceId) {
      return res.status(400).json({
        error: 'Device ID is required for approval'
      });
    }

    await client.query('BEGIN');

    // Get request details
    const requestResult = await client.query(
      `SELECT sr.*, st.name as screen_type_name
       FROM screen_requests sr
       JOIN screen_types st ON sr.screen_type_id = st.id
       WHERE sr.id = $1 FOR UPDATE`,
      [requestId]
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }

    const request = requestResult.rows[0];

    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Request is already ${request.status}`
      });
    }

    // Check if device ID is already in use
    const deviceCheck = await client.query(
      'SELECT id FROM screens WHERE device_id = $1',
      [deviceId]
    );

    if (deviceCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Device ID is already registered to another screen'
      });
    }

    // Create the screen
    const screenResult = await client.query(
      `INSERT INTO screens (
        shop_id, name, location, device_id,
        screen_type_id, monthly_cost, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
      RETURNING *`,
      [
        request.shop_id,
        request.screen_name,
        request.location,
        deviceId,
        request.screen_type_id,
        request.monthly_cost
      ]
    );

    // Update request status
    await client.query(
      `UPDATE screen_requests
       SET status = 'approved',
           reviewed_by = $1,
           reviewed_at = CURRENT_TIMESTAMP,
           device_id = $2,
           screen_id = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [reviewerId, deviceId, screenResult.rows[0].id, requestId]
    );

    // Get commission percentage from system settings
    const commissionSettings = await client.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'commission_percentage'"
    );
    const commissionPercent = parseFloat(commissionSettings.rows[0]?.setting_value || 10);
    const commissionAmount = request.monthly_cost * (commissionPercent / 100);

    // Get the sales user who registered this shop
    const shopDetails = await client.query(
      'SELECT registered_by FROM shops WHERE id = $1',
      [request.shop_id]
    );

    // Create sales commission if shop was registered by a sales user
    if (shopDetails.rows[0]?.registered_by) {
      await client.query(`
        INSERT INTO sales_commissions (
          sales_user_id, shop_id, commission_type, amount,
          percentage, status, month, description
        )
        VALUES ($1, $2, 'screen', $3, $4, 'approved', DATE_TRUNC('month', CURRENT_DATE), $5)
      `, [
        shopDetails.rows[0].registered_by,
        request.shop_id,
        commissionAmount,
        commissionPercent,
        `${commissionPercent}% of new ${request.screen_type_name} screen (£${parseFloat(request.monthly_cost).toFixed(2)})`
      ]);
    }

    await client.query('COMMIT');

    // Send approval email
    try {
      await emailService.sendScreenRequestApproval(request, deviceId);
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
    }

    res.json({
      message: 'Screen request approved successfully',
      screen: screenResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Approve screen request error:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Reject screen request (Admin)
router.post('/:requestId/reject', authenticateToken, requireRole(['admin']), async (req, res) => {
  const client = await pool.connect();

  try {
    const { requestId } = req.params;
    const { reason } = req.body;
    const reviewerId = req.user.userId;

    if (!reason) {
      return res.status(400).json({
        error: 'Rejection reason is required'
      });
    }

    await client.query('BEGIN');

    // Get request details
    const requestResult = await client.query(
      'SELECT * FROM screen_requests WHERE id = $1 FOR UPDATE',
      [requestId]
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }

    const request = requestResult.rows[0];

    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Request is already ${request.status}`
      });
    }

    // Update request status
    await client.query(
      `UPDATE screen_requests
       SET status = 'rejected',
           reviewed_by = $1,
           reviewed_at = CURRENT_TIMESTAMP,
           rejection_reason = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [reviewerId, reason, requestId]
    );

    // Refund the payment
    await client.query(
      `UPDATE shops
       SET credit_balance = credit_balance + $1
       WHERE id = $2`,
      [request.payment_amount, request.shop_id]
    );

    // Record refund transaction
    await client.query(
      `INSERT INTO credit_transactions (
        shop_id, amount, type, description, reference_id,
        balance_before, balance_after
      ) VALUES (
        $1, $2, 'refund', $3, $4,
        (SELECT credit_balance - $2 FROM shops WHERE id = $1),
        (SELECT credit_balance FROM shops WHERE id = $1)
      )`,
      [
        request.shop_id,
        request.payment_amount,
        `Refund for rejected screen request #${requestId}: ${reason}`,
        requestId
      ]
    );

    await client.query('COMMIT');

    // Send rejection email
    try {
      await emailService.sendScreenRequestRejection(request, reason);
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
    }

    res.json({
      message: 'Screen request rejected and refund processed',
      refund_amount: request.payment_amount
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reject screen request error:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Cancel screen request (Shop Owner - only if still pending)
router.post('/:requestId/cancel', authenticateToken, requireRole(['owner']), async (req, res) => {
  const client = await pool.connect();

  try {
    const { requestId } = req.params;
    const shopId = req.user.shopId;

    await client.query('BEGIN');

    // Get request and verify ownership
    const requestResult = await client.query(
      'SELECT * FROM screen_requests WHERE id = $1 AND shop_id = $2 FOR UPDATE',
      [requestId, shopId]
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }

    const request = requestResult.rows[0];

    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Cannot cancel ${request.status} request`
      });
    }

    // Update request status
    await client.query(
      `UPDATE screen_requests
       SET status = 'cancelled',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [requestId]
    );

    // Refund the payment
    await client.query(
      `UPDATE shops
       SET credit_balance = credit_balance + $1
       WHERE id = $2`,
      [request.payment_amount, shopId]
    );

    // Record refund transaction
    await client.query(
      `INSERT INTO credit_transactions (
        shop_id, amount, type, description, reference_id,
        balance_before, balance_after
      ) VALUES (
        $1, $2, 'refund', $3, $4,
        (SELECT credit_balance - $2 FROM shops WHERE id = $1),
        (SELECT credit_balance FROM shops WHERE id = $1)
      )`,
      [
        shopId,
        request.payment_amount,
        `Refund for cancelled screen request #${requestId}`,
        requestId
      ]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Screen request cancelled and refund processed',
      refund_amount: request.payment_amount
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cancel screen request error:', error);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// Process expired requests (Should be called by cron job)
router.post('/process-expired', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    await pool.query('SELECT auto_expire_screen_requests()');

    const result = await pool.query(
      `SELECT COUNT(*) as expired_count
       FROM screen_requests
       WHERE status = 'expired'
       AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '1 minute'`
    );

    res.json({
      message: 'Expired requests processed',
      expired_count: parseInt(result.rows[0].expired_count)
    });

  } catch (error) {
    console.error('Process expired requests error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;