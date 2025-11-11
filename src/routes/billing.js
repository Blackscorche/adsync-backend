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
      `SELECT b.*, s.name as shop_name, s.address, s.city, s.postcode, s.vat_number,
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

    // Define colors
    const primaryColor = '#2563eb'; // Blue
    const darkGray = '#374151';
    const lightGray = '#9ca3af';

    // ===== HEADER SECTION =====
    // Company name with blue background
    doc.rect(0, 0, 612, 65).fill(primaryColor);

    // Add logo
    const logoPath = path.join(__dirname, '../../public/assets/logo.png');
    try {
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 50, 15, { width: 40, height: 40 });
      }
    } catch (err) {
      console.error('Logo not found, skipping:', err.message);
    }

    doc.fillColor('#ffffff')
       .fontSize(22)
       .font('Helvetica-Bold')
       .text('IVAA AdSync', 100, 20);

    doc.fillColor('#ffffff')
       .fontSize(9)
       .font('Helvetica')
       .text('Digital Signage Solutions', 100, 46);

    // Reset to black for rest of document
    doc.fillColor(darkGray);

    // Company details (right side)
    doc.fontSize(8)
       .text('123 Business Street', 400, 20, { width: 150, align: 'right' })
       .text('London, UK', 400, 32, { width: 150, align: 'right' })
       .text('VAT: GB123456789', 400, 44, { width: 150, align: 'right' });

    // ===== INVOICE TITLE =====
    doc.fillColor(darkGray)
       .fontSize(24)
       .font('Helvetica-Bold')
       .text('INVOICE', 50, 85);

    // Invoice details box
    doc.rect(400, 85, 150, 60).lineWidth(1).stroke('#e5e7eb');

    doc.fontSize(8)
       .fillColor(lightGray)
       .text('Invoice Number:', 410, 93)
       .text('Invoice Date:', 410, 110)
       .text('Due Date:', 410, 127);

    doc.fillColor(darkGray)
       .font('Helvetica-Bold')
       .text(bill.invoice_number, 485, 93, { width: 60, align: 'right' })
       .text(new Date(bill.created_at).toLocaleDateString('en-GB'), 485, 110, { width: 60, align: 'right' })
       .text(new Date(bill.due_date).toLocaleDateString('en-GB'), 485, 127, { width: 60, align: 'right' });

    // ===== BILL TO SECTION =====
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor(darkGray)
       .text('BILL TO:', 50, 165);

    doc.font('Helvetica')
       .fontSize(9)
       .text(bill.shop_name, 50, 180)
       .text(bill.owner_name, 50, 193)
       .fontSize(8)
       .fillColor(lightGray)
       .text(bill.address, 50, 206)
       .text(`${bill.city}, ${bill.postcode}`, 50, 218)
       .text(bill.owner_email, 50, 230);

    if (bill.vat_number) {
      doc.fillColor(darkGray)
         .fontSize(8)
         .text(`VAT: ${bill.vat_number}`, 50, 242);
    }

    // Billing period box
    const billingDate = bill.billing_month || bill.bill_date;
    if (billingDate) {
      const date = new Date(billingDate);
      doc.rect(350, 165, 200, 45).lineWidth(1).stroke('#e5e7eb');
      doc.font('Helvetica-Bold')
         .fontSize(9)
         .fillColor(darkGray)
         .text('Billing Period:', 360, 173);
      doc.font('Helvetica')
         .fontSize(11)
         .text(date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), 360, 190);
    }

    // ===== LINE ITEMS TABLE =====
    let tableTop = bill.vat_number ? 275 : 265;

    // Table header
    doc.rect(50, tableTop, 500, 25).fill('#f3f4f6');
    doc.fillColor(darkGray)
       .font('Helvetica-Bold')
       .fontSize(10)
       .text('Description', 60, tableTop + 8)
       .text('Amount', 490, tableTop + 8, { width: 50, align: 'right' });

    // Table content
    tableTop += 25;
    doc.rect(50, tableTop, 500, 35).stroke('#e5e7eb');

    doc.fillColor(darkGray)
       .font('Helvetica')
       .fontSize(9);

    if (bill.description) {
      doc.text(bill.description, 60, tableTop + 10, { width: 380 });
    } else {
      doc.text('Monthly Digital Signage Service', 60, tableTop + 10);
    }

    const totalAmount = parseFloat(bill.total_amount || bill.amount || 0);
    doc.font('Helvetica-Bold')
       .text(`£${totalAmount.toFixed(2)}`, 490, tableTop + 10, { width: 50, align: 'right' });

    // ===== TOTALS SECTION =====
    tableTop += 45;

    // Subtotal, VAT, Total
    doc.rect(350, tableTop, 200, 70).lineWidth(1).stroke('#e5e7eb');

    const subtotal = totalAmount / 1.20; // Assuming 20% VAT
    const vatAmount = totalAmount - subtotal;

    doc.font('Helvetica')
       .fontSize(9)
       .fillColor(lightGray)
       .text('Subtotal:', 360, tableTop + 8)
       .text('VAT (20%):', 360, tableTop + 26);

    doc.fillColor(darkGray)
       .text(`£${subtotal.toFixed(2)}`, 490, tableTop + 8, { width: 50, align: 'right' })
       .text(`£${vatAmount.toFixed(2)}`, 490, tableTop + 26, { width: 50, align: 'right' });

    // Total with background
    doc.rect(350, tableTop + 44, 200, 26).fill('#f3f4f6');
    doc.fillColor(darkGray)
       .font('Helvetica-Bold')
       .fontSize(11)
       .text('Total:', 360, tableTop + 52)
       .text(`£${totalAmount.toFixed(2)}`, 490, tableTop + 52, { width: 50, align: 'right' });

    // ===== PAYMENT STATUS =====
    tableTop += 85;
    const statusColor = bill.status === 'paid' ? '#10b981' : bill.status === 'pending' ? '#f59e0b' : '#ef4444';

    doc.fontSize(9)
       .fillColor(lightGray)
       .text('Payment Status: ', 50, tableTop);

    doc.fillColor(statusColor)
       .font('Helvetica-Bold')
       .text(bill.status.toUpperCase(), 135, tableTop);

    // ===== NOTES SECTION =====
    tableTop += 25;
    doc.fontSize(8)
       .fillColor(lightGray)
       .font('Helvetica')
       .text('Payment terms: Due within 30 days', 50, tableTop)
       .text('All prices include VAT at 20%', 50, tableTop + 12);

    // ===== FOOTER =====
    doc.fillColor(lightGray)
       .font('Helvetica')
       .fontSize(8)
       .text('Thank you for your business!', 50, 720, { align: 'center', width: 500 })
       .text('For questions or support, please contact: support@ivaa-adsync.com', 50, 733, { align: 'center', width: 500 });

    // Footer line
    doc.moveTo(50, 710).lineTo(550, 710).stroke('#e5e7eb');

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