const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const emailService = require('../services/email');

// Initialize Stripe with your secret key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

// Get shop credit balance
router.get('/credit/balance', authenticateToken, requireRole(['owner']), async (req, res) => {
  try {
    const shopResult = await pool.query(
      'SELECT id, credit_balance, payment_status FROM shops WHERE owner_id = $1',
      [req.user.userId]
    );

    if (shopResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = shopResult.rows[0];

    // Get recent transactions
    const transactionsResult = await pool.query(
      `SELECT * FROM credit_transactions
       WHERE shop_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [shop.id]
    );

    res.json({
      credit_balance: shop.credit_balance,
      payment_status: shop.payment_status,
      transactions: transactionsResult.rows,
      pricing: {
        upload_cost: 3.00,
        screen_32_monthly: 15.00,
        screen_43_monthly: 20.00,
        screen_55_monthly: 25.00
      }
    });
  } catch (error) {
    console.error('Get credit balance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Top up credit balance
router.post('/credit/topup', authenticateToken, requireRole(['owner']), async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount < 5) {
      return res.status(400).json({ error: 'Minimum top-up is £5' });
    }

    if (amount > 500) {
      return res.status(400).json({ error: 'Maximum top-up is £500' });
    }

    // Get shop details
    const shopResult = await pool.query(
      `SELECT s.*, u.email
       FROM shops s
       JOIN users u ON s.owner_id = u.id
       WHERE s.owner_id = $1`,
      [req.user.userId]
    );

    if (shopResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = shopResult.rows[0];

    // Create Stripe payment intent for credit top-up
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to pence
      currency: 'gbp',
      metadata: {
        shop_id: shop.id,
        type: 'credit_topup',
        shop_name: shop.name
      },
      description: `Credit top-up for ${shop.name}`,
      receipt_email: shop.email,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      amount: amount
    });
  } catch (error) {
    console.error('Create top-up error:', error);
    res.status(500).json({ error: 'Failed to create top-up' });
  }
});

// Confirm credit top-up
router.post('/credit/confirm', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { payment_intent_id, amount } = req.body;

    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);

    if (paymentIntent.status !== 'succeeded') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Payment not successful' });
    }

    // Get shop
    const shopResult = await client.query(
      'SELECT * FROM shops WHERE owner_id = $1 FOR UPDATE',
      [req.user.userId]
    );

    if (shopResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = shopResult.rows[0];
    const currentBalance = parseFloat(shop.credit_balance);
    const newBalance = currentBalance + parseFloat(amount);

    // Update credit balance
    await client.query(
      'UPDATE shops SET credit_balance = $1 WHERE id = $2',
      [newBalance, shop.id]
    );

    // Record transaction
    await client.query(
      `INSERT INTO credit_transactions
       (shop_id, amount, type, description, balance_before, balance_after)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        shop.id,
        amount,
        'top_up',
        `Credit top-up via Stripe`,
        currentBalance,
        newBalance
      ]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Credit added successfully',
      new_balance: newBalance,
      added: amount
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Confirm top-up error:', error);
    res.status(500).json({ error: 'Failed to confirm top-up' });
  } finally {
    client.release();
  }
});

// Create payment intent for a bill (for monthly subscriptions)
router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { billId } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Get bill details with user email
    const billResult = await pool.query(
      `SELECT b.*, s.name as shop_name, s.owner_id, u.email as owner_email
       FROM billing b
       JOIN shops s ON b.shop_id = s.id
       JOIN users u ON s.owner_id = u.id
       WHERE b.id = $1 AND b.status = 'pending'`,
      [billId]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bill not found or already paid' });
    }

    const bill = billResult.rows[0];

    // Check permissions - only owner or admin can pay
    if (userRole === 'owner' && bill.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    } else if (!['owner', 'admin'].includes(userRole)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(bill.total_amount * 100), // Convert to pence
      currency: 'gbp',
      metadata: {
        bill_id: bill.id,
        invoice_number: bill.invoice_number,
        shop_name: bill.shop_name,
        shop_id: bill.shop_id
      },
      description: `IVAA AdSync - Invoice ${bill.invoice_number}`,
      receipt_email: bill.owner_email,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    // Store payment intent ID in database
    await pool.query(
      `UPDATE billing
       SET payment_intent_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [paymentIntent.id, billId]
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      amount: bill.total_amount,
      invoice_number: bill.invoice_number
    });

  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Confirm bill payment and check for shop reactivation
router.post('/confirm', authenticateToken, async (req, res) => {
  try {
    const { billId, paymentIntentId } = req.body;

    // Verify payment intent with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    // Update bill status
    const result = await pool.query(
      `UPDATE billing
       SET status = 'paid',
           payment_method = 'card',
           payment_reference = $1,
           payment_date = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND payment_intent_id = $1
       RETURNING *`,
      [paymentIntentId, billId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const bill = result.rows[0];

    // Get shop and owner details for email
    const shopResult = await pool.query(
      `SELECT s.name as shop_name, u.email, u.full_name
       FROM shops s
       JOIN users u ON s.owner_id = u.id
       WHERE s.id = $1`,
      [bill.shop_id]
    );

    if (shopResult.rows.length > 0) {
      const shop = shopResult.rows[0];

      // Check if shop needs reactivation
      const shopStatusResult = await pool.query(
        'SELECT payment_status FROM shops WHERE id = $1',
        [bill.shop_id]
      );

      if (shopStatusResult.rows.length > 0 && shopStatusResult.rows[0].payment_status === 'inactive') {
        // Check if all bills are paid
        const unpaidBillsResult = await pool.query(
          `SELECT COUNT(*) as unpaid_count FROM billing
           WHERE shop_id = $1 AND status = 'pending'`,
          [bill.shop_id]
        );

        if (parseInt(unpaidBillsResult.rows[0].unpaid_count) === 0) {
          // Reactivate shop
          await pool.query(
            `UPDATE shops SET payment_status = 'active' WHERE id = $1`,
            [bill.shop_id]
          );
        }
      }

      // Send payment confirmation email
      await emailService.sendPaymentConfirmation(
        shop.email,
        shop.full_name,
        bill.invoice_number,
        bill.total_amount,
        new Date()
      );

      // Create notification for admin
      const adminResult = await pool.query(
        `SELECT id FROM users WHERE role = 'admin'`
      );

      for (const admin of adminResult.rows) {
        await pool.query(
          `INSERT INTO notifications (user_id, type, title, message, data)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            admin.id,
            'payment_received',
            'Payment Received',
            `Payment received for ${shop.shop_name} - Invoice ${bill.invoice_number}`,
            JSON.stringify({
              bill_id: bill.id,
              amount: bill.total_amount,
              shop_name: shop.shop_name
            })
          ]
        );
      }
    }

    res.json({
      message: 'Payment confirmed successfully',
      bill: bill
    });

  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// Stripe webhook handler (for automatic updates)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;

      // Update bill status
      await pool.query(
        `UPDATE billing
         SET status = 'paid',
             payment_method = 'card',
             payment_reference = $1,
             payment_date = NOW(),
             updated_at = NOW()
         WHERE payment_intent_id = $2`,
        [paymentIntent.id, paymentIntent.id]
      );

      // Create notification for admin
      const billResult = await pool.query(
        `SELECT b.*, s.name as shop_name
         FROM billing b
         JOIN shops s ON b.shop_id = s.id
         WHERE payment_intent_id = $1`,
        [paymentIntent.id]
      );

      if (billResult.rows.length > 0) {
        const bill = billResult.rows[0];

        // Get admin users
        const adminResult = await pool.query(
          `SELECT id FROM users WHERE role = 'admin'`
        );

        // Create notification for each admin
        for (const admin of adminResult.rows) {
          await pool.query(
            `INSERT INTO notifications (user_id, type, title, message, data)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              admin.id,
              'payment_received',
              'Payment Received',
              `Payment received for ${bill.shop_name} - Invoice ${bill.invoice_number}`,
              JSON.stringify({
                bill_id: bill.id,
                amount: bill.total_amount,
                shop_name: bill.shop_name
              })
            ]
          );
        }
      }

      break;

    case 'payment_intent.payment_failed':
      const failedIntent = event.data.object;

      // Log failed payment attempt
      console.error('Payment failed for intent:', failedIntent.id);

      // You might want to send an email notification here
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Get payment configuration
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (!['owner', 'admin'].includes(userRole)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Return Stripe publishable key for frontend
    res.json({
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51OHJGxSJZRvNQz1eXrYgLqMz1zXqHfKJ0KqLZAJYFhXx5X0XqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXq',
      supportedPaymentMethods: ['card'],
      currency: 'gbp'
    });

  } catch (error) {
    console.error('Get payment config error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get payment history for a shop
router.get('/history/:shopId', authenticateToken, async (req, res) => {
  try {
    const { shopId } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Check permissions
    if (userRole === 'owner') {
      const shopCheck = await pool.query(
        'SELECT id FROM shops WHERE id = $1 AND owner_id = $2',
        [shopId, userId]
      );
      if (shopCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    } else if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get payment history
    const result = await pool.query(
      `SELECT b.*,
              CASE WHEN b.payment_intent_id IS NOT NULL THEN 'online' ELSE 'manual' END as payment_type
       FROM billing b
       WHERE b.shop_id = $1 AND b.status = 'paid'
       ORDER BY b.payment_date DESC
       LIMIT 50`,
      [shopId]
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;