const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { ticketUpload, getFileUrl, deleteFile, getKeyFromUrl } = require('../services/digitalOceanSpaces');

const router = express.Router();

// Generate unique ticket number
function generateTicketNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().substr(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `TKT${year}${month}${random}`;
}

// Create new ticket (for owners)
router.post('/create', authenticateToken, ticketUpload.array('attachments', 5), async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      category,
      priority,
      subject,
      description,
      // Screen request fields
      screen_size,
      screen_quantity,
      installation_address,
      preferred_installation_date,
      // Content request fields
      content_type,
      play_duration,
      target_screens,
      start_date,
      end_date
    } = req.body;

    // Get user's shop
    let shopId = null;
    if (req.user.role === 'owner') {
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE owner_id = $1 LIMIT 1',
        [userId]
      );
      if (shopResult.rows.length > 0) {
        shopId = shopResult.rows[0].id;
      }
    }

    // Create ticket
    const ticketNumber = generateTicketNumber();
    const ticketResult = await pool.query(
      `INSERT INTO support_tickets (
        ticket_number, shop_id, created_by, category, priority, subject, description,
        screen_size, screen_quantity, installation_address, preferred_installation_date,
        content_type, play_duration, target_screens, start_date, end_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        ticketNumber, shopId, userId, category, priority || 'medium', subject, description,
        screen_size, screen_quantity, installation_address, preferred_installation_date,
        content_type, play_duration,
        target_screens ? target_screens.split(',') : null,
        start_date, end_date
      ]
    );

    const ticket = ticketResult.rows[0];

    // Handle file attachments
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.query(
          `INSERT INTO ticket_attachments (ticket_id, filename, file_url, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            ticket.id,
            file.originalname,
            getFileUrl(file.key),
            file.size,
            file.mimetype,
            userId
          ]
        );
      }
    }

    // Send notification to admins
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, data)
       SELECT id, 'new_ticket', 'New Support Ticket',
              $1, $2::jsonb
       FROM users WHERE role = 'admin'`,
      [
        `New ${category} ticket from ${req.user.email}: ${subject}`,
        JSON.stringify({ ticket_id: ticket.id, ticket_number: ticketNumber })
      ]
    );

    res.status(201).json({
      message: 'Ticket created successfully',
      ticket: ticket
    });
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// Get tickets for current user
router.get('/my-tickets', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, category } = req.query;

    let query = `
      SELECT
        t.*,
        u.full_name as created_by_name,
        u.email as created_by_email,
        a.full_name as assigned_to_name,
        COUNT(DISTINCT c.id) as comment_count,
        COUNT(DISTINCT att.id) as attachment_count
      FROM support_tickets t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN users a ON t.assigned_to = a.id
      LEFT JOIN ticket_comments c ON t.id = c.ticket_id
      LEFT JOIN ticket_attachments att ON t.id = att.ticket_id
      WHERE t.created_by = $1
    `;

    const params = [userId];
    let paramIndex = 2;

    if (status) {
      query += ` AND t.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (category) {
      query += ` AND t.category = $${paramIndex}`;
      params.push(category);
    }

    query += ` GROUP BY t.id, u.full_name, u.email, a.full_name ORDER BY t.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// Get all tickets (admin only)
router.get('/all', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { status, category, priority, assigned_to } = req.query;

    let query = `
      SELECT
        t.*,
        s.name as shop_name,
        u.full_name as created_by_name,
        u.email as created_by_email,
        a.full_name as assigned_to_name,
        COUNT(DISTINCT c.id) as comment_count,
        COUNT(DISTINCT att.id) as attachment_count
      FROM support_tickets t
      LEFT JOIN shops s ON t.shop_id = s.id
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN users a ON t.assigned_to = a.id
      LEFT JOIN ticket_comments c ON t.id = c.ticket_id
      LEFT JOIN ticket_attachments att ON t.id = att.ticket_id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND t.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (category) {
      query += ` AND t.category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (priority) {
      query += ` AND t.priority = $${paramIndex}`;
      params.push(priority);
      paramIndex++;
    }

    if (assigned_to) {
      query += ` AND t.assigned_to = $${paramIndex}`;
      params.push(assigned_to);
    }

    query += ` GROUP BY t.id, s.name, u.full_name, u.email, a.full_name
               ORDER BY
                 CASE t.priority
                   WHEN 'urgent' THEN 1
                   WHEN 'high' THEN 2
                   WHEN 'medium' THEN 3
                   WHEN 'low' THEN 4
                 END,
                 t.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all tickets:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// Get single ticket with comments
router.get('/:ticketId', authenticateToken, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.userId;

    // Check access rights
    const accessCheck = await pool.query(
      `SELECT * FROM support_tickets
       WHERE id = $1 AND (created_by = $2 OR $3 = 'admin')`,
      [ticketId, userId, req.user.role]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get ticket details
    const ticketResult = await pool.query(
      `SELECT
        t.*,
        s.name as shop_name,
        u.full_name as created_by_name,
        u.email as created_by_email,
        a.full_name as assigned_to_name
      FROM support_tickets t
      LEFT JOIN shops s ON t.shop_id = s.id
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN users a ON t.assigned_to = a.id
      WHERE t.id = $1`,
      [ticketId]
    );

    // Get comments
    const commentsResult = await pool.query(
      `SELECT
        c.*,
        u.full_name as user_name,
        u.email as user_email,
        u.role as user_role
      FROM ticket_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.ticket_id = $1 AND (c.is_internal = false OR $2 = 'admin')
      ORDER BY c.created_at ASC`,
      [ticketId, req.user.role]
    );

    // Get attachments
    const attachmentsResult = await pool.query(
      `SELECT * FROM ticket_attachments WHERE ticket_id = $1`,
      [ticketId]
    );

    res.json({
      ticket: ticketResult.rows[0],
      comments: commentsResult.rows,
      attachments: attachmentsResult.rows
    });
  } catch (error) {
    console.error('Error fetching ticket details:', error);
    res.status(500).json({ error: 'Failed to fetch ticket details' });
  }
});

// Add comment to ticket
router.post('/:ticketId/comment', authenticateToken, ticketUpload.array('attachments', 3), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { comment, is_internal } = req.body;
    const userId = req.user.userId;

    // Check access
    const accessCheck = await pool.query(
      `SELECT * FROM support_tickets
       WHERE id = $1 AND (created_by = $2 OR $3 = 'admin')`,
      [ticketId, userId, req.user.role]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Add comment
    const commentResult = await pool.query(
      `INSERT INTO ticket_comments (ticket_id, user_id, comment, is_internal)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [ticketId, userId, comment, is_internal || false]
    );

    const newComment = commentResult.rows[0];

    // Handle attachments
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.query(
          `INSERT INTO ticket_attachments (ticket_id, comment_id, filename, file_url, file_size, mime_type, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ticketId,
            newComment.id,
            file.originalname,
            getFileUrl(file.key),
            file.size,
            file.mimetype,
            userId
          ]
        );
      }
    }

    // Update ticket status if needed
    const ticket = accessCheck.rows[0];
    if (req.user.role === 'admin' && ticket.status === 'open') {
      await pool.query(
        `UPDATE support_tickets SET status = 'in_progress', assigned_to = $1 WHERE id = $2`,
        [userId, ticketId]
      );
    } else if (req.user.role === 'owner' && ticket.status === 'waiting_owner') {
      await pool.query(
        `UPDATE support_tickets SET status = 'waiting_admin' WHERE id = $1`,
        [ticketId]
      );
    }

    // Send notification
    const notifyUserId = req.user.role === 'admin' ? ticket.created_by : ticket.assigned_to;
    if (notifyUserId) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, message, data)
         VALUES ($1, 'ticket_comment', 'New comment on ticket', $2, $3::jsonb)`,
        [
          notifyUserId,
          `New comment on ticket #${ticket.ticket_number}`,
          JSON.stringify({ ticket_id: ticketId, comment_id: newComment.id })
        ]
      );
    }

    res.json({
      message: 'Comment added successfully',
      comment: newComment
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Update ticket status (admin only)
router.put('/:ticketId/status', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, resolution_notes, assigned_to } = req.body;

    const updateFields = ['status = $1'];
    const params = [status, ticketId];
    let paramIndex = 3;

    if (resolution_notes) {
      updateFields.push(`resolution_notes = $${paramIndex}`);
      params.splice(1, 0, resolution_notes);
      paramIndex++;
    }

    if (assigned_to) {
      updateFields.push(`assigned_to = $${paramIndex}`);
      params.splice(params.length - 1, 0, assigned_to);
      paramIndex++;
    }

    if (status === 'resolved') {
      updateFields.push('resolved_at = CURRENT_TIMESTAMP');
    } else if (status === 'closed') {
      updateFields.push('closed_at = CURRENT_TIMESTAMP');
    }

    const result = await pool.query(
      `UPDATE support_tickets
       SET ${updateFields.join(', ')}
       WHERE id = $2
       RETURNING *`,
      params
    );

    // Send notification to ticket creator
    const ticket = result.rows[0];
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, data)
       VALUES ($1, 'ticket_status', 'Ticket status updated', $2, $3::jsonb)`,
      [
        ticket.created_by,
        `Your ticket #${ticket.ticket_number} status changed to ${status}`,
        JSON.stringify({ ticket_id: ticketId, new_status: status })
      ]
    );

    res.json({
      message: 'Ticket status updated',
      ticket: ticket
    });
  } catch (error) {
    console.error('Error updating ticket status:', error);
    res.status(500).json({ error: 'Failed to update ticket status' });
  }
});

// Get ticket statistics (admin only)
router.get('/stats/overview', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_tickets,
        COUNT(*) FILTER (WHERE status = 'open') as open_tickets,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_tickets,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_tickets,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_tickets,
        COUNT(*) FILTER (WHERE priority = 'urgent') as urgent_tickets,
        COUNT(*) FILTER (WHERE priority = 'high') as high_priority_tickets,
        COUNT(*) FILTER (WHERE category = 'screen_request') as screen_requests,
        COUNT(*) FILTER (WHERE category = 'content_request') as content_requests,
        COUNT(*) FILTER (WHERE created_at > CURRENT_DATE - INTERVAL '7 days') as new_this_week,
        COUNT(*) FILTER (WHERE resolved_at > CURRENT_DATE - INTERVAL '7 days') as resolved_this_week,
        AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600)::INTEGER as avg_resolution_hours
      FROM support_tickets
    `);

    // Get tickets by category
    const byCategory = await pool.query(`
      SELECT category, COUNT(*) as count
      FROM support_tickets
      GROUP BY category
      ORDER BY count DESC
    `);

    // Get recent urgent tickets
    const urgentTickets = await pool.query(`
      SELECT
        t.id,
        t.ticket_number,
        t.subject,
        t.priority,
        t.status,
        t.created_at,
        u.full_name as created_by_name,
        s.name as shop_name
      FROM support_tickets t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN shops s ON t.shop_id = s.id
      WHERE t.priority IN ('urgent', 'high') AND t.status NOT IN ('resolved', 'closed')
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 END,
        t.created_at DESC
      LIMIT 10
    `);

    res.json({
      overview: stats.rows[0],
      by_category: byCategory.rows,
      urgent_tickets: urgentTickets.rows
    });
  } catch (error) {
    console.error('Error fetching ticket statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;