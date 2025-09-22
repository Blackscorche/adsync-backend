const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const emailService = require('../services/email');

const router = express.Router();

// Get shop billing information
router.get('/shops/:shopId', authenticateToken, async (req, res) => {
  try {
    const { shopId } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Check permissions
    let query;
    let params;

    if (userRole === 'owner') {
      query = 'SELECT * FROM shops WHERE id = $1 AND owner_id = $2';
      params = [shopId, userId];
    } else if (['admin', 'design'].includes(userRole)) {
      query = 'SELECT * FROM shops WHERE id = $1';
      params = [shopId];
    } else {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const shopResult = await pool.query(query, params);

    if (shopResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = shopResult.rows[0];

    // Get billing history
    const billsResult = await pool.query(
      `SELECT * FROM billing
       WHERE shop_id = $1
       ORDER BY created_at DESC
       LIMIT 12`,
      [shopId]
    );

    // Get current month usage
    const currentMonth = new Date();
    const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);

    const usageResult = await pool.query(
      `SELECT COUNT(*) as content_uploads
       FROM contents
       WHERE shop_id = $1
       AND created_at >= $2`,
      [shopId, startOfMonth]
    );

    // Calculate current month charges
    const freeUploads = 1;
    const uploadPrice = 3.00;
    const contentUploads = parseInt(usageResult.rows[0].content_uploads);
    const billableUploads = Math.max(0, contentUploads - freeUploads);
    const contentCharges = billableUploads * uploadPrice;

    // Get screen subscription charges
    const screenCharges =
      (shop.screen_32_count || 0) * (shop.screen_32_price || 15) +
      (shop.screen_43_count || 0) * (shop.screen_43_price || 20) +
      (shop.screen_55_count || 0) * (shop.screen_55_price || 25);

    const totalCharges = screenCharges + contentCharges;

    res.json({
      shop: {
        id: shop.id,
        name: shop.name,
        subscription_status: shop.subscription_status,
        screen_32_count: shop.screen_32_count,
        screen_43_count: shop.screen_43_count,
        screen_55_count: shop.screen_55_count,
        screen_32_price: shop.screen_32_price,
        screen_43_price: shop.screen_43_price,
        screen_55_price: shop.screen_55_price
      },
      currentMonth: {
        contentUploads,
        freeUploads,
        billableUploads,
        contentCharges,
        screenCharges,
        totalCharges
      },
      bills: billsResult.rows
    });

  } catch (error) {
    console.error('Get billing info error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Generate invoice
router.post('/shops/:shopId/generate-invoice', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { shopId } = req.params;
    const { month, year } = req.body;

    // Get shop details
    const shopResult = await pool.query(
      `SELECT s.*, u.full_name, u.email
       FROM shops s
       JOIN users u ON s.owner_id = u.id
       WHERE s.id = $1`,
      [shopId]
    );

    if (shopResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shop = shopResult.rows[0];

    // Calculate billing period
    const billingMonth = new Date(year, month - 1, 1);
    const startDate = new Date(billingMonth.getFullYear(), billingMonth.getMonth(), 1);
    const endDate = new Date(billingMonth.getFullYear(), billingMonth.getMonth() + 1, 0);

    // Get content usage for the month
    const usageResult = await pool.query(
      `SELECT COUNT(*) as content_uploads
       FROM contents
       WHERE shop_id = $1
       AND created_at >= $2
       AND created_at <= $3`,
      [shopId, startDate, endDate]
    );

    // Calculate charges
    const freeUploads = 1;
    const uploadPrice = 3.00;
    const contentUploads = parseInt(usageResult.rows[0].content_uploads);
    const billableUploads = Math.max(0, contentUploads - freeUploads);
    const contentCharges = billableUploads * uploadPrice;

    const screenCharges =
      (shop.screen_32_count || 0) * (shop.screen_32_price || 15) +
      (shop.screen_43_count || 0) * (shop.screen_43_price || 20) +
      (shop.screen_55_count || 0) * (shop.screen_55_price || 25);

    const subtotal = screenCharges + contentCharges;
    const vat = subtotal * 0.20; // 20% VAT
    const total = subtotal + vat;

    // Check if invoice already exists
    const existingBill = await pool.query(
      `SELECT id FROM billing
       WHERE shop_id = $1
       AND EXTRACT(MONTH FROM billing_period_start) = $2
       AND EXTRACT(YEAR FROM billing_period_start) = $3`,
      [shopId, month, year]
    );

    if (existingBill.rows.length > 0) {
      return res.status(400).json({ error: 'Invoice already exists for this period' });
    }

    // Create bill record
    const invoiceNumber = `INV-${shop.id}-${year}${String(month).padStart(2, '0')}`;

    const billResult = await pool.query(
      `INSERT INTO billing (
        shop_id, invoice_number, billing_period_start, billing_period_end,
        screen_charges, content_charges, additional_charges, subtotal,
        vat_amount, total_amount, status, payment_due_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        shopId, invoiceNumber, startDate, endDate,
        screenCharges, contentCharges, 0, subtotal,
        vat, total, 'pending', new Date(endDate.getTime() + 14 * 24 * 60 * 60 * 1000) // 14 days payment terms
      ]
    );

    // Send invoice email
    await emailService.sendInvoiceEmail(billResult.rows[0].id);

    res.json({
      message: 'Invoice generated successfully',
      bill: billResult.rows[0]
    });

  } catch (error) {
    console.error('Generate invoice error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Download invoice PDF
router.get('/invoices/:invoiceId/pdf', authenticateToken, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Get invoice details
    const billResult = await pool.query(
      `SELECT b.*, s.name as shop_name, s.address, s.city, s.postcode,
              u.full_name as owner_name, u.email as owner_email
       FROM billing b
       JOIN shops s ON b.shop_id = s.id
       JOIN users u ON s.owner_id = u.id
       WHERE b.id = $1`,
      [invoiceId]
    );

    if (billResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const bill = billResult.rows[0];

    // Check permissions
    if (userRole === 'owner') {
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE id = $1 AND owner_id = $2',
        [bill.shop_id, userId]
      );
      if (shopResult.rows.length === 0) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    } else if (!['admin', 'design'].includes(userRole)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Create PDF
    const doc = new PDFDocument();
    const filename = `${bill.invoice_number}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text('IVAA AdSync', 50, 50);
    doc.fontSize(10).text('123 Business Street', 50, 80);
    doc.text('London, UK', 50, 95);
    doc.text('VAT: GB123456789', 50, 110);

    // Invoice title
    doc.fontSize(16).text('INVOICE', 400, 50);
    doc.fontSize(10).text(`Invoice #: ${bill.invoice_number}`, 400, 80);
    doc.text(`Date: ${new Date(bill.created_at).toLocaleDateString()}`, 400, 95);
    doc.text(`Due Date: ${new Date(bill.payment_due_date).toLocaleDateString()}`, 400, 110);

    // Bill to
    doc.fontSize(12).text('Bill To:', 50, 160);
    doc.fontSize(10).text(bill.shop_name, 50, 180);
    doc.text(bill.owner_name, 50, 195);
    doc.text(bill.address, 50, 210);
    doc.text(`${bill.city}, ${bill.postcode}`, 50, 225);
    doc.text(bill.owner_email, 50, 240);

    // Billing period
    doc.fontSize(12).text('Billing Period:', 50, 280);
    doc.fontSize(10).text(
      `${new Date(bill.billing_period_start).toLocaleDateString()} - ${new Date(bill.billing_period_end).toLocaleDateString()}`,
      50, 300
    );

    // Line items
    doc.fontSize(12).text('Description', 50, 340);
    doc.text('Amount', 450, 340);

    let yPosition = 360;

    if (bill.screen_charges > 0) {
      doc.fontSize(10).text('Screen Subscription Charges', 50, yPosition);
      doc.text(`£${bill.screen_charges.toFixed(2)}`, 450, yPosition);
      yPosition += 20;
    }

    if (bill.content_charges > 0) {
      doc.fontSize(10).text('Content Upload Charges', 50, yPosition);
      doc.text(`£${bill.content_charges.toFixed(2)}`, 450, yPosition);
      yPosition += 20;
    }

    // Totals
    yPosition += 20;
    doc.fontSize(10).text('Subtotal:', 380, yPosition);
    doc.text(`£${bill.subtotal.toFixed(2)}`, 450, yPosition);

    yPosition += 20;
    doc.text('VAT (20%):', 380, yPosition);
    doc.text(`£${bill.vat_amount.toFixed(2)}`, 450, yPosition);

    yPosition += 20;
    doc.fontSize(12).text('Total:', 380, yPosition);
    doc.text(`£${bill.total_amount.toFixed(2)}`, 450, yPosition);

    // Payment status
    yPosition += 40;
    doc.fontSize(10).text(`Payment Status: ${bill.status.toUpperCase()}`, 50, yPosition);

    // Footer
    doc.fontSize(8).text('Thank you for your business!', 50, 700);
    doc.text('For questions, please contact support@ivaa-adsync.com', 50, 715);

    doc.end();

  } catch (error) {
    console.error('Download invoice error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update payment status
router.patch('/bills/:billId/payment', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { billId } = req.params;
    const { status, payment_method, payment_reference, payment_date } = req.body;

    const result = await pool.query(
      `UPDATE billing
       SET status = $1,
           payment_method = $2,
           payment_reference = $3,
           payment_date = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [status, payment_method, payment_reference, payment_date || new Date(), billId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    // Send payment confirmation email if marked as paid
    if (status === 'paid') {
      await emailService.sendPaymentConfirmation(billId);
    }

    res.json({
      message: 'Payment status updated',
      bill: result.rows[0]
    });

  } catch (error) {
    console.error('Update payment status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all unpaid bills (admin only)
router.get('/unpaid', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, s.name as shop_name, u.full_name as owner_name
       FROM billing b
       JOIN shops s ON b.shop_id = s.id
       JOIN users u ON s.owner_id = u.id
       WHERE b.status = 'pending'
       ORDER BY b.payment_due_date ASC`
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Get unpaid bills error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;