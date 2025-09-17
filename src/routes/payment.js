const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const emailService = require('../services/email');

// Initialize Stripe with your secret key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_51OHJGxSJZRvNQz1eXrYgLqMz1zXqHfKJ0KqLZAJYFhXx5X0XqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXqXq');

const router = express.Router();

// Create payment intent for a bill
router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { billId } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Get bill details with user email
    const billResult = await pool.query(
      `SELECT b.*, s.name as shop_name, s.owner_id, u.email as owner_email
       FROM bills b
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
      `UPDATE bills
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

// Confirm payment (called after successful payment)
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
      `UPDATE bills
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
        `UPDATE bills
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
         FROM bills b
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
       FROM bills b
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