const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');

const router = express.Router();

// Create payment intent for a bill
router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { billId } = req.body;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Get bill details
    const billResult = await pool.query(
      `SELECT b.*, s.name as shop_name, s.owner_id
       FROM bills b
       JOIN shops s ON b.shop_id = s.id
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
        shop_name: bill.shop_name
      },
      description: `Payment for invoice ${bill.invoice_number}`
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

// Confirm payment webhook (called by Stripe)
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

// Get payment methods for a shop
router.get('/methods', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    if (!['owner', 'admin'].includes(userRole)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // For now, return supported payment methods
    // In production, you'd fetch saved payment methods from Stripe
    res.json({
      methods: [
        { id: 'card', name: 'Credit/Debit Card', enabled: true },
        { id: 'bank_transfer', name: 'Bank Transfer', enabled: true },
        { id: 'direct_debit', name: 'Direct Debit', enabled: false }
      ]
    });

  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Process manual payment (for admin recording bank transfers)
router.post('/manual', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { billId, payment_method, payment_reference, payment_date, amount } = req.body;

    // Get bill details
    const billResult = await pool.query(
      `SELECT * FROM bills WHERE id = $1`,
      [billId]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const bill = billResult.rows[0];

    // Validate amount matches
    if (Math.abs(bill.total_amount - amount) > 0.01) {
      return res.status(400).json({
        error: 'Payment amount does not match bill total',
        expected: bill.total_amount,
        received: amount
      });
    }

    // Update bill status
    await pool.query(
      `UPDATE bills
       SET status = 'paid',
           payment_method = $1,
           payment_reference = $2,
           payment_date = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [payment_method, payment_reference, payment_date || new Date(), billId]
    );

    res.json({
      message: 'Payment recorded successfully',
      bill_id: billId
    });

  } catch (error) {
    console.error('Manual payment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;