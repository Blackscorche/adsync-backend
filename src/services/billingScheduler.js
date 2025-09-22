const cron = require('node-cron');
const pool = require('../config/database');
const emailService = require('./email');

class BillingScheduler {
  start() {
    console.log('Starting billing scheduler...');

    // Run every day at 2 AM to generate monthly invoices on the 1st
    cron.schedule('0 2 1 * *', this.generateMonthlyInvoices);

    // Run every day at 3 AM to check overdue bills
    cron.schedule('0 3 * * *', this.checkOverdueBills);

    // Run every day at 4 AM to check for shops to terminate
    cron.schedule('0 4 * * *', this.checkShopsForTermination);
  }

  async generateMonthlyInvoices() {
    console.log('Generating monthly invoices...');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get all active shops
      const shopsResult = await client.query(`
        SELECT s.*, u.email, u.full_name
        FROM shops s
        JOIN users u ON s.owner_id = u.id
        WHERE s.approval_status = 'approved'
        AND s.payment_status != 'terminated'
      `);

      const today = new Date();
      const billingStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const billingEnd = new Date(today.getFullYear(), today.getMonth(), 0);

      for (const shop of shopsResult.rows) {
        // Calculate screen subscription charges
        const screensResult = await client.query(`
          SELECT COUNT(*) as count, SUM(monthly_cost) as total_cost
          FROM screens
          WHERE shop_id = $1 AND status = 'active'
        `, [shop.id]);

        const screenCharges = parseFloat(screensResult.rows[0].total_cost || 0);

        // Get content monthly price from settings
        const contentPriceSettings = await client.query(
          "SELECT setting_value FROM system_settings WHERE setting_key = 'content_monthly_price'"
        );
        const contentMonthlyPrice = parseFloat(contentPriceSettings.rows[0]?.setting_value || 1.00);

        // Calculate content storage/display charges
        const contentResult = await client.query(`
          SELECT COUNT(*) as count
          FROM content
          WHERE shop_id = $1 AND status IN ('approved', 'published')
        `, [shop.id]);

        const contentCount = parseInt(contentResult.rows[0].count || 0);
        const contentCharges = contentCount * contentMonthlyPrice;

        const totalCharges = screenCharges + contentCharges;

        if (totalCharges > 0) {
          const subtotal = totalCharges;
          const vat = subtotal * 0.20;
          const total = subtotal + vat;

          const invoiceNumber = `INV-${shop.id}-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

          // Create bill with both screen and content charges
          await client.query(`
            INSERT INTO bills (
              shop_id, invoice_number, billing_period_start, billing_period_end,
              screen_charges, content_charges, subtotal, vat_amount, total_amount,
              status, payment_due_date, created_at, description
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
          `, [
            shop.id, invoiceNumber, billingStart, billingEnd,
            screenCharges, contentCharges, subtotal, vat, total,
            'pending',
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days to pay
            `Screens: ${screensResult.rows[0].count || 0}, Content items: ${contentCount}`
          ]);

          // Deduct from credit balance immediately
          const deductResult = await client.query(
            'SELECT deduct_credit($1, $2, $3, $4) as success',
            [shop.id, total, 'monthly_billing', `Monthly charges - ${invoiceNumber}`]
          );

          if (!deductResult.rows[0].success) {
            // Mark as unpaid if insufficient credit
            await client.query(
              'UPDATE bills SET status = $1 WHERE invoice_number = $2',
              ['unpaid', invoiceNumber]
            );
          } else {
            // Mark as paid if successfully deducted
            await client.query(
              'UPDATE bills SET status = $1, paid_at = NOW() WHERE invoice_number = $2',
              ['paid', invoiceNumber]
            );

            // Get commission percentage from settings
            const commissionSettings = await client.query(
              "SELECT setting_value FROM system_settings WHERE setting_key = 'commission_percentage'"
            );
            const commissionPercentage = parseFloat(commissionSettings.rows[0]?.setting_value || 10) / 100;

            // Calculate sales commission
            if (shop.registered_by) {
              const commissionAmount = total * commissionPercentage;

              // Create or update monthly commission for sales person
              await client.query(`
                INSERT INTO sales_commissions (
                  sales_user_id, shop_id, commission_type, amount,
                  percentage, status, month, description
                )
                VALUES ($1, $2, 'monthly', $3, $4, 'approved', DATE_TRUNC('month', CURRENT_DATE), $5)
                ON CONFLICT (sales_user_id, shop_id, month, commission_type)
                DO UPDATE SET
                  amount = sales_commissions.amount + EXCLUDED.amount,
                  updated_at = NOW()
              `, [
                shop.registered_by,
                shop.id,
                commissionAmount,
                commissionPercentage * 100,
                `${commissionPercentage * 100}% of ${invoiceNumber} (£${total.toFixed(2)})`
              ]);
            }
          }

          // Send invoice email
          await emailService.sendInvoice(
            shop.email,
            shop.full_name,
            invoiceNumber,
            total
          );
        }
      }

      // Reset free upload for all shops for the new month
      await client.query(`
        UPDATE shops
        SET free_upload_used = false
        WHERE approval_status = 'approved'
      `);

      await client.query('COMMIT');
      console.log(`Generated invoices for ${shopsResult.rows.length} shops and reset free uploads`);

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error generating invoices:', error);
    } finally {
      client.release();
    }
  }

  async checkOverdueBills() {
    console.log('Checking for overdue bills...');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Find bills that are 7+ days overdue
      const overdueBillsResult = await client.query(`
        SELECT b.*, s.id as shop_id, s.name as shop_name,
               u.email, u.full_name,
               DATE_PART('day', NOW() - b.payment_due_date) as days_overdue
        FROM bills b
        JOIN shops s ON b.shop_id = s.id
        JOIN users u ON s.owner_id = u.id
        WHERE b.status = 'pending'
        AND b.payment_due_date < NOW()
        AND s.payment_status = 'active'
      `);

      for (const bill of overdueBillsResult.rows) {
        if (bill.days_overdue >= 7) {
          // Mark shop as inactive
          await client.query(
            `UPDATE shops SET payment_status = 'inactive' WHERE id = $1`,
            [bill.shop_id]
          );

          // Update bill status
          await client.query(
            `UPDATE bills SET status = 'overdue', days_overdue = $1 WHERE id = $2`,
            [bill.days_overdue, bill.id]
          );

          // Send notification
          await emailService.sendOverdueNotice(
            bill.email,
            bill.full_name,
            bill.invoice_number,
            bill.total_amount,
            bill.days_overdue
          );

          console.log(`Shop ${bill.shop_name} marked inactive - ${bill.days_overdue} days overdue`);
        }
      }

      await client.query('COMMIT');

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error checking overdue bills:', error);
    } finally {
      client.release();
    }
  }

  async checkShopsForTermination() {
    console.log('Checking for shops to terminate...');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Find shops with bills 30+ days overdue
      const terminationResult = await client.query(`
        SELECT DISTINCT s.*, u.email, u.full_name,
               MIN(b.payment_due_date) as oldest_due_date,
               DATE_PART('day', NOW() - MIN(b.payment_due_date)) as days_overdue
        FROM shops s
        JOIN bills b ON s.id = b.shop_id
        JOIN users u ON s.owner_id = u.id
        WHERE s.payment_status = 'inactive'
        AND b.status IN ('pending', 'overdue')
        GROUP BY s.id, u.email, u.full_name
        HAVING DATE_PART('day', NOW() - MIN(b.payment_due_date)) >= 30
      `);

      for (const shop of terminationResult.rows) {
        // Mark shop as terminated
        await client.query(
          `UPDATE shops SET payment_status = 'terminated' WHERE id = $1`,
          [shop.id]
        );

        // Delete all shop data (cascade will handle related records)
        await client.query(
          `DELETE FROM shops WHERE id = $1`,
          [shop.id]
        );

        // Send termination notice
        await emailService.sendTerminationNotice(
          shop.email,
          shop.full_name,
          shop.name
        );

        console.log(`Shop ${shop.name} terminated - ${shop.days_overdue} days overdue`);
      }

      await client.query('COMMIT');

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error checking for termination:', error);
    } finally {
      client.release();
    }
  }
}

module.exports = new BillingScheduler();