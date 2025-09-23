const { Resend } = require('resend');
const pool = require('../config/database');

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY || 'test_key');

class EmailService {
  constructor() {
    this.fromEmail = process.env.FROM_EMAIL || 'noreply@ivaa-adsync.com';
    this.fromName = 'IVAA AdSync';
  }

  // Send shop approval email to owner
  async sendShopApprovalEmail(shopId) {
    try {
      const result = await pool.query(
        `SELECT s.*, u.email, u.full_name, d.full_name as designer_name
         FROM shops s
         JOIN users u ON s.owner_id = u.id
         LEFT JOIN users d ON s.designer_id = d.id
         WHERE s.id = $1`,
        [shopId]
      );

      if (result.rows.length === 0) return;

      const shop = result.rows[0];

      await resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: shop.email,
        subject: '✅ Your Shop Has Been Approved!',
        html: `
          <h1>Welcome to IVAA AdSync!</h1>
          <p>Hi ${shop.full_name},</p>
          <p>Great news! Your shop <strong>${shop.name}</strong> has been approved and is now active on our platform.</p>
          <h3>Your Account Details:</h3>
          <ul>
            <li>Shop Name: ${shop.name}</li>
            <li>Login Email: ${shop.email}</li>
            <li>Assigned Designer: ${shop.designer_name || 'To be assigned'}</li>
          </ul>
          <p>You can now log in to your dashboard and start uploading content for your digital displays.</p>
          <a href="${process.env.FRONTEND_URL}/login">Login to Dashboard</a>
        `
      });

      console.log('Shop approval email sent to:', shop.email);

    } catch (error) {
      console.error('Error sending shop approval email:', error);
    }
  }

  // Send shop rejection email
  async sendShopRejectionEmail(shopId, reason) {
    try {
      const result = await pool.query(
        `SELECT s.*, u.email, u.full_name
         FROM shops s
         JOIN users u ON s.owner_id = u.id
         WHERE s.id = $1`,
        [shopId]
      );

      if (result.rows.length === 0) return;

      const shop = result.rows[0];

      await resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: shop.email,
        subject: 'Update on Your Shop Registration',
        html: `
          <h2>Shop Registration Update</h2>
          <p>Hi ${shop.full_name},</p>
          <p>Thank you for registering your shop <strong>${shop.name}</strong> with IVAA AdSync.</p>
          <p>After reviewing your application, we need some additional information or corrections before we can approve your shop.</p>
          <p><strong>Feedback:</strong> ${reason || 'Please contact our sales team for more information.'}</p>
          <p>Please contact our sales team to resolve this issue.</p>
        `
      });

      console.log('Shop rejection email sent to:', shop.email);

    } catch (error) {
      console.error('Error sending shop rejection email:', error);
    }
  }

  // Send new content notification to designer
  async sendNewContentNotification(contentId) {
    try {
      const result = await pool.query(
        `SELECT c.*, s.name as shop_name, u.email as designer_email, u.full_name as designer_name
         FROM content c
         JOIN shops s ON c.shop_id = s.id
         LEFT JOIN users u ON s.designer_id = u.id
         WHERE c.id = $1`,
        [contentId]
      );

      if (result.rows.length === 0 || !result.rows[0].designer_email) return;

      const content = result.rows[0];

      await resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: content.designer_email,
        subject: `New Content to Design - ${content.shop_name}`,
        html: `
          <h2>New Content Ready for Design</h2>
          <p>Hi ${content.designer_name},</p>
          <p>New content has been uploaded by <strong>${content.shop_name}</strong> and is ready for your professional touch!</p>
          <h3>Content Details:</h3>
          <ul>
            <li>Title: ${content.title}</li>
            <li>Type: ${content.content_type}</li>
            <li>Uploaded: ${new Date(content.created_at).toLocaleDateString()}</li>
          </ul>
          <a href="${process.env.FRONTEND_URL}/design">View in Design Dashboard</a>
        `
      });

      console.log('New content notification sent to designer:', content.designer_email);

    } catch (error) {
      console.error('Error sending new content notification:', error);
    }
  }

  // Send invoice email
  async sendInvoiceEmail(billId) {
    try {
      const result = await pool.query(
        `SELECT b.*, s.name as shop_name, u.email, u.full_name
         FROM billing b
         JOIN shops s ON b.shop_id = s.id
         JOIN users u ON s.owner_id = u.id
         WHERE b.id = $1`,
        [billId]
      );

      if (result.rows.length === 0) return;

      const bill = result.rows[0];

      await resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: bill.email,
        subject: `Invoice ${bill.invoice_number} - IVAA AdSync`,
        html: `
          <h2>Monthly Invoice</h2>
          <p>Hi ${bill.full_name},</p>
          <p>Your monthly invoice for <strong>${bill.shop_name}</strong> is ready.</p>
          <h3>Invoice Details:</h3>
          <ul>
            <li>Invoice Number: ${bill.invoice_number}</li>
            <li>Amount Due: £${bill.total_amount.toFixed(2)}</li>
            <li>Due Date: ${new Date(bill.due_date).toLocaleDateString()}</li>
          </ul>
          <table border="1" cellpadding="5">
            <tr><th>Description</th><th>Amount</th></tr>
            <tr><td>Screen Subscription</td><td>£${bill.screen_charges.toFixed(2)}</td></tr>
            <tr><td>Content Uploads</td><td>£${bill.content_charges.toFixed(2)}</td></tr>
            <tr><td>VAT (20%)</td><td>£${bill.vat_amount.toFixed(2)}</td></tr>
            <tr><td><strong>Total</strong></td><td><strong>£${bill.total_amount.toFixed(2)}</strong></td></tr>
          </table>
          <a href="${process.env.FRONTEND_URL}/owner/billing">Pay Invoice</a>
        `
      });

      console.log('Invoice email sent to:', bill.email);

    } catch (error) {
      console.error('Error sending invoice email:', error);
    }
  }

  // Send payment confirmation email
  async sendPaymentConfirmation(billId) {
    try {
      const result = await pool.query(
        `SELECT b.*, s.name as shop_name, u.email, u.full_name
         FROM billing b
         JOIN shops s ON b.shop_id = s.id
         JOIN users u ON s.owner_id = u.id
         WHERE b.id = $1`,
        [billId]
      );

      if (result.rows.length === 0) return;

      const bill = result.rows[0];

      await resend.emails.send({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: bill.email,
        subject: 'Payment Received - Thank You!',
        html: `
          <h2>Payment Confirmed</h2>
          <p>Hi ${bill.full_name},</p>
          <p>We've received your payment of <strong>£${bill.total_amount.toFixed(2)}</strong> for invoice <strong>${bill.invoice_number}</strong>.</p>
          <h3>Payment Details:</h3>
          <ul>
            <li>Amount Paid: £${bill.total_amount.toFixed(2)}</li>
            <li>Payment Date: ${new Date(bill.payment_date).toLocaleDateString()}</li>
            <li>Reference: ${bill.payment_reference}</li>
          </ul>
          <p>Thank you for your prompt payment!</p>
        `
      });

      console.log('Payment confirmation sent to:', bill.email);

    } catch (error) {
      console.error('Error sending payment confirmation:', error);
    }
  }
}

module.exports = new EmailService();