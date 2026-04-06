const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Public: Submit a new inquiry (no auth required)
router.post('/', async (req, res) => {
  try {
    const { name, email, phone } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, and phone are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    await pool.query(
      'INSERT INTO customer_inquiries (name, email, phone) VALUES ($1, $2, $3)',
      [name, email, phone]
    );

    res.status(201).json({ message: 'Thank you! We will contact you as soon as possible.' });
  } catch (error) {
    console.error('Error submitting inquiry:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get all inquiries
router.get('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM customer_inquiries';
    const params = [];

    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching inquiries:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Update inquiry status
router.put('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const result = await pool.query(
      'UPDATE customer_inquiries SET status = $1, notes = $2 WHERE id = $3 RETURNING *',
      [status, notes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating inquiry:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Delete inquiry
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM customer_inquiries WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }

    res.json({ message: 'Inquiry deleted' });
  } catch (error) {
    console.error('Error deleting inquiry:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
