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

    // Get actual screen counts by type
    const screenCountsResult = await pool.query(
      `SELECT
        st.name as screen_type,
        st.size_inches,
        st.monthly_price,
        COUNT(s.id) as count
       FROM screens s
       JOIN screen_types st ON s.screen_type_id = st.id
       WHERE s.shop_id = $1 AND s.status = 'active'
       GROUP BY st.id, st.name, st.size_inches, st.monthly_price
       ORDER BY st.size_inches`,
      [shopId]
    );

    // Get current month usage
    const currentMonth = new Date();
    const startOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);

    const usageResult = await pool.query(
      `SELECT COUNT(*) as content_uploads
       FROM content
       WHERE shop_id = $1
       AND created_at >= $2`,
      [shopId, startOfMonth]
    );

    const uploadPriceResult = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'content_upload_price'`
    );
    const uploadPrice = parseFloat(uploadPriceResult.rows[0]?.setting_value || 3.00);

    const freeUploads = 1;
    const contentUploads = parseInt(usageResult.rows[0].content_uploads);
    const billableUploads = Math.max(0, contentUploads - freeUploads);
    const contentCharges = billableUploads * uploadPrice;

    const screenCharges = screenCountsResult.rows.reduce((total, screenType) => {
      return total + (parseInt(screenType.count) * parseFloat(screenType.monthly_price));
    }, 0);

    const totalCharges = screenCharges + contentCharges;

    const transactionsResult = await pool.query(
      `SELECT * FROM credit_transactions
       WHERE shop_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [shopId]
    );
    const screenPurchasesResult = await pool.query(
      `SELECT
        s.id,
        s.device_id,
        s.name as screen_name,
        s.size,
        s.location,
        s.status,
        s.created_at as purchase_date,
        s.monthly_cost,
        st.name as screen_type_name,
        st.size_inches as screen_size,
        st.monthly_price as screen_price
       FROM screens s
       LEFT JOIN screen_types st ON s.screen_type_id = st.id
       WHERE s.shop_id = $1
       ORDER BY s.created_at DESC`,
      [shopId]
    );

    const contentPurchasesResult = await pool.query(
      `SELECT
        c.id,
        c.original_filename,
        c.status,
        c.created_at as upload_date,
        c.charge_amount,
        c.was_free_upload
       FROM content c
       WHERE c.shop_id = $1
       AND c.charge_amount > 0
       ORDER BY c.created_at DESC
       LIMIT 50`,
      [shopId]
    );

    res.json({
      shop: {
        id: shop.id,
        name: shop.name,
        subscription_status: shop.subscription_status
      },
      screenTypes: screenCountsResult.rows,
      currentMonth: {
        contentUploads,
        freeUploads,
        billableUploads,
        contentCharges,
        screenCharges,
        totalCharges
      },
      bills: billsResult.rows,
      transactions: transactionsResult.rows,
      screenPurchases: screenPurchasesResult.rows,
      contentPurchases: contentPurchasesResult.rows
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

    const usageResult = await pool.query(
      `SELECT COUNT(*) as content_uploads
       FROM content
       WHERE shop_id = $1
       AND created_at >= $2
       AND created_at <= $3`,
      [shopId, startDate, endDate]
    );

    const screenCountsResult = await pool.query(
      `SELECT
        st.name as screen_type,
        st.size_inches,
        st.monthly_price,
        COUNT(s.id) as count
       FROM screens s
       JOIN screen_types st ON s.screen_type_id = st.id
       WHERE s.shop_id = $1 AND s.status = 'active'
       GROUP BY st.id, st.name, st.size_inches, st.monthly_price
       ORDER BY st.size_inches`,
      [shopId]
    );

    const uploadPriceResult = await pool.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'content_upload_price'`
    );
    const uploadPrice = parseFloat(uploadPriceResult.rows[0]?.setting_value || 3.00);

    const freeUploads = 1;
    const contentUploads = parseInt(usageResult.rows[0].content_uploads);
    const billableUploads = Math.max(0, contentUploads - freeUploads);
    const contentCharges = billableUploads * uploadPrice;

    const screenCharges = screenCountsResult.rows.reduce((total, screenType) => {
      return total + (parseInt(screenType.count) * parseFloat(screenType.monthly_price));
    }, 0);

    const subtotal = screenCharges + contentCharges;
    const vat = subtotal * 0.20;
    const total = subtotal + vat;
    const existingBill = await pool.query(
      `SELECT id FROM billing
       WHERE shop_id = $1
       AND EXTRACT(MONTH FROM billing_month) = $2
       AND EXTRACT(YEAR FROM billing_month) = $3`,
      [shopId, month, year]
    );

    if (existingBill.rows.length > 0) {
      return res.status(400).json({ error: 'Invoice already exists for this period' });
    }

    // Create bill record
    const invoiceNumber = `INV-${shop.id}-${year}${String(month).padStart(2, '0')}`;
    const dueDate = new Date(endDate.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days payment terms

    const billResult = await pool.query(
      `INSERT INTO billing (
        shop_id, invoice_number, bill_date, billing_month,
        amount, total_amount, status, due_date, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        shopId,
        invoiceNumber,
        new Date(), // bill_date is today
        startDate, // billing_month is the month being billed
        total, // amount
        total, // total_amount
        'pending',
        dueDate,
        `Screens: £${screenCharges.toFixed(2)}, Content: £${contentCharges.toFixed(2)}, VAT: £${vat.toFixed(2)}`
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
    const filename = `${bill.invoice_number || 'invoice'}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Handle stream errors before piping
    doc.on('error', (err) => {
      console.error('PDF generation error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'PDF generation failed' });
      }
    });

    res.on('error', (err) => {
      console.error('Response stream error:', err);
    });

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
    doc.text(`Due Date: ${new Date(bill.due_date).toLocaleDateString()}`, 400, 110);

    // Bill to
    doc.fontSize(12).text('Bill To:', 50, 160);
    doc.fontSize(10).text(bill.shop_name, 50, 180);
    doc.text(bill.owner_name, 50, 195);
    doc.text(bill.address, 50, 210);
    doc.text(`${bill.city}, ${bill.postcode}`, 50, 225);
    doc.text(bill.owner_email, 50, 240);

    // Billing period
    doc.fontSize(12).text('Billing Period:', 50, 280);
    const billingDate = bill.billing_month || bill.bill_date;
    if (billingDate) {
      const date = new Date(billingDate);
      doc.fontSize(10).text(
        `${date.toLocaleDateString('default', { month: 'long', year: 'numeric' })}`,
        50, 300
      );
    }

    // Line items
    doc.fontSize(12).text('Description', 50, 340);
    doc.text('Amount', 450, 340);

    let yPosition = 360;

    // Use description if available, otherwise show generic billing
    if (bill.description) {
      doc.fontSize(10).text(bill.description, 50, yPosition);
    } else {
      doc.fontSize(10).text('Monthly Service Charges', 50, yPosition);
    }

    yPosition += 40;

    // Total
    doc.fontSize(12).text('Total Amount:', 380, yPosition);
    const totalAmount = parseFloat(bill.total_amount || bill.amount || 0);
    doc.text(`£${totalAmount.toFixed(2)}`, 450, yPosition);

    // Payment status
    yPosition += 40;
    doc.fontSize(10).text(`Payment Status: ${bill.status.toUpperCase()}`, 50, yPosition);

    // Footer
    doc.fontSize(8).text('Thank you for your business!', 50, 700);
    doc.text('For questions, please contact support@ivaa-adsync.com', 50, 715);

    doc.end();

  } catch (error) {
    console.error('Download invoice error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Update payment status
router.patch('/bills/:billId/payment', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { billId } = req.params;
    const { status, payment_method, payment_date } = req.body;

    const result = await pool.query(
      `UPDATE billing
       SET status = $1,
           payment_method = $2,
           paid_at = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, payment_method, payment_date || new Date(), billId]
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
       ORDER BY b.due_date ASC`
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Get unpaid bills error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all bills (Admin only)
router.get('/all', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { status, shopId, month, year } = req.query;

    let query = `
      SELECT b.*, s.name as shop_name, u.full_name as owner_name, u.email as owner_email
      FROM billing b
      JOIN shops s ON b.shop_id = s.id
      JOIN users u ON s.owner_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
      query += ` AND b.status = $${paramIndex++}`;
      params.push(status);
    }

    if (shopId) {
      query += ` AND b.shop_id = $${paramIndex++}`;
      params.push(shopId);
    }

    if (month) {
      query += ` AND EXTRACT(MONTH FROM b.billing_month) = $${paramIndex++}`;
      params.push(month);
    }

    if (year) {
      query += ` AND EXTRACT(YEAR FROM b.billing_month) = $${paramIndex++}`;
      params.push(year);
    }

    query += ' ORDER BY b.created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (error) {
    console.error('Get all bills error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get overdue bills (Admin only)
router.get('/overdue', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, s.name as shop_name, u.full_name as owner_name, u.email as owner_email,
              DATE_PART('day', NOW() - b.due_date) as days_overdue
       FROM billing b
       JOIN shops s ON b.shop_id = s.id
       JOIN users u ON s.owner_id = u.id
       WHERE b.status = 'pending' AND b.due_date < CURRENT_DATE
       ORDER BY b.due_date ASC`
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Get overdue bills error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;