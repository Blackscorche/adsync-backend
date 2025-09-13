const express = require('express');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Get all playlists for a shop
router.get('/', authenticateToken, async (req, res) => {
  try {
    let shopId;
    
    if (req.user.role === 'owner') {
      // Get shop_id for the owner
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE owner_id = $1',
        [req.user.userId]
      );
      
      if (shopResult.rows.length === 0) {
        return res.status(404).json({ error: 'Shop not found for this owner' });
      }
      shopId = shopResult.rows[0].id;
    } else if (req.user.role === 'admin') {
      // Admin can specify shop_id or get all
      shopId = req.query.shop_id;
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    let query;
    let params = [];

    if (shopId) {
      query = `
        SELECT 
          p.*,
          u.full_name as created_by_name,
          COUNT(DISTINCT pi.id) as item_count,
          SUM(pi.duration) as total_duration
        FROM playlists p
        LEFT JOIN users u ON p.created_by = u.id
        LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
        WHERE p.shop_id = $1
        GROUP BY p.id, u.full_name
        ORDER BY p.created_at DESC
      `;
      params = [shopId];
    } else {
      // Admin getting all playlists
      query = `
        SELECT 
          p.*,
          s.name as shop_name,
          u.full_name as created_by_name,
          COUNT(DISTINCT pi.id) as item_count,
          SUM(pi.duration) as total_duration
        FROM playlists p
        LEFT JOIN shops s ON p.shop_id = s.id
        LEFT JOIN users u ON p.created_by = u.id
        LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
        GROUP BY p.id, s.name, u.full_name
        ORDER BY p.created_at DESC
      `;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching playlists:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single playlist with items
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get playlist details
    const playlistResult = await pool.query(
      `SELECT 
        p.*,
        s.name as shop_name,
        u.full_name as created_by_name
       FROM playlists p
       LEFT JOIN shops s ON p.shop_id = s.id
       LEFT JOIN users u ON p.created_by = u.id
       WHERE p.id = $1`,
      [id]
    );

    if (playlistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const playlist = playlistResult.rows[0];

    // Check access rights
    if (req.user.role === 'owner') {
      const shopResult = await pool.query(
        'SELECT id FROM shops WHERE owner_id = $1',
        [req.user.userId]
      );
      
      if (shopResult.rows.length === 0 || shopResult.rows[0].id !== playlist.shop_id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Get playlist items with content details
    const itemsResult = await pool.query(
      `SELECT 
        pi.*,
        c.filename,
        c.file_url,
        c.file_type,
        c.thumbnail_url
       FROM playlist_items pi
       LEFT JOIN content c ON pi.content_id = c.id
       WHERE pi.playlist_id = $1
       ORDER BY pi.position`,
      [id]
    );

    playlist.items = itemsResult.rows;
    res.json(playlist);
  } catch (error) {
    console.error('Error fetching playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new playlist - ONLY designers can create playlists
router.post('/', authenticateToken, requireRole(['design', 'admin']), async (req, res) => {
  try {
    const { name, description, shopId } = req.body;

    if (req.user.role === 'design') {
      // Verify designer is assigned to this shop
      const assignmentCheck = await pool.query(
        'SELECT id FROM shops WHERE id = $1 AND assigned_designer_id = $2',
        [shopId, req.user.userId]
      );

      if (assignmentCheck.rows.length === 0) {
        return res.status(403).json({ error: 'You are not assigned to this shop' });
      }
    } else {
      // Admin must specify shop_id
      shopId = req.body.shop_id;
      if (!shopId) {
        return res.status(400).json({ error: 'shop_id is required for admin' });
      }
    }

    const result = await pool.query(
      `INSERT INTO playlists (name, description, shop_id, created_by, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING *`,
      [name, description || null, shopId, req.user.userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update playlist
router.put('/:id', authenticateToken, requireRole(['design', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;

    // Check ownership
    if (req.user.role === 'owner') {
      const checkResult = await pool.query(
        `SELECT p.* FROM playlists p
         JOIN shops s ON p.shop_id = s.id
         WHERE p.id = $1 AND s.owner_id = $2`,
        [id, req.user.userId]
      );
      
      if (checkResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await pool.query(
      `UPDATE playlists 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           is_active = COALESCE($3, is_active)
       WHERE id = $4
       RETURNING *`,
      [name, description, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add content to playlist
router.post('/:id/items', authenticateToken, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { content_id, duration = 10 } = req.body;

    // Check playlist ownership
    if (req.user.role === 'owner') {
      const checkResult = await pool.query(
        `SELECT p.* FROM playlists p
         JOIN shops s ON p.shop_id = s.id
         WHERE p.id = $1 AND s.owner_id = $2`,
        [id, req.user.userId]
      );
      
      if (checkResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Verify content is approved and belongs to the same shop
    const contentCheck = await pool.query(
      `SELECT c.* FROM content c
       JOIN playlists p ON c.shop_id = p.shop_id
       WHERE c.id = $1 AND p.id = $2 AND c.status = 'approved'`,
      [content_id, id]
    );

    if (contentCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Content not found or not approved for this shop' });
    }

    // Get the next position
    const positionResult = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 as next_position FROM playlist_items WHERE playlist_id = $1',
      [id]
    );

    const nextPosition = positionResult.rows[0].next_position;

    // Add item to playlist
    const result = await pool.query(
      `INSERT INTO playlist_items (playlist_id, content_id, position, duration)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, content_id, nextPosition, duration]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding item to playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update playlist item order
router.put('/:id/items/reorder', authenticateToken, requireRole(['design', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body; // Array of { id, position }

    // Check playlist ownership
    if (req.user.role === 'owner') {
      const checkResult = await pool.query(
        `SELECT p.* FROM playlists p
         JOIN shops s ON p.shop_id = s.id
         WHERE p.id = $1 AND s.owner_id = $2`,
        [id, req.user.userId]
      );
      
      if (checkResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Update positions in a transaction
    await pool.query('BEGIN');
    
    for (const item of items) {
      await pool.query(
        'UPDATE playlist_items SET position = $1 WHERE id = $2 AND playlist_id = $3',
        [item.position, item.id, id]
      );
    }
    
    await pool.query('COMMIT');

    res.json({ message: 'Playlist order updated successfully' });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error reordering playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove item from playlist
router.delete('/:playlistId/items/:itemId', authenticateToken, requireRole(['design', 'admin']), async (req, res) => {
  try {
    const { playlistId, itemId } = req.params;

    // Check playlist ownership
    if (req.user.role === 'owner') {
      const checkResult = await pool.query(
        `SELECT p.* FROM playlists p
         JOIN shops s ON p.shop_id = s.id
         WHERE p.id = $1 AND s.owner_id = $2`,
        [playlistId, req.user.userId]
      );
      
      if (checkResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const result = await pool.query(
      'DELETE FROM playlist_items WHERE id = $1 AND playlist_id = $2 RETURNING id',
      [itemId, playlistId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found in playlist' });
    }

    // Reorder remaining items
    await pool.query(
      `UPDATE playlist_items 
       SET position = position - 1 
       WHERE playlist_id = $1 AND position > (
         SELECT position FROM playlist_items WHERE id = $2
       )`,
      [playlistId, itemId]
    );

    res.json({ message: 'Item removed from playlist' });
  } catch (error) {
    console.error('Error removing item from playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete playlist
router.delete('/:id', authenticateToken, requireRole(['design', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check playlist ownership
    if (req.user.role === 'owner') {
      const checkResult = await pool.query(
        `SELECT p.* FROM playlists p
         JOIN shops s ON p.shop_id = s.id
         WHERE p.id = $1 AND s.owner_id = $2`,
        [id, req.user.userId]
      );
      
      if (checkResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Check if playlist is assigned to any screen
    const assignmentCheck = await pool.query(
      'SELECT COUNT(*) as count FROM screen_playlists WHERE playlist_id = $1',
      [id]
    );

    if (parseInt(assignmentCheck.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete playlist that is assigned to screens' });
    }

    // Delete playlist (items will be cascade deleted)
    const result = await pool.query(
      'DELETE FROM playlists WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    res.json({ message: 'Playlist deleted successfully' });
  } catch (error) {
    console.error('Error deleting playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Assign playlist to screen
router.post('/assign', authenticateToken, requireRole(['owner', 'admin']), async (req, res) => {
  try {
    const { playlist_id, screen_id } = req.body;

    // Verify ownership of both playlist and screen
    if (req.user.role === 'owner') {
      const checkResult = await pool.query(
        `SELECT COUNT(*) as valid FROM playlists p
         JOIN screens s ON p.shop_id = s.shop_id
         JOIN shops sh ON p.shop_id = sh.id
         WHERE p.id = $1 AND s.id = $2 AND sh.owner_id = $3`,
        [playlist_id, screen_id, req.user.userId]
      );
      
      if (parseInt(checkResult.rows[0].valid) === 0) {
        return res.status(403).json({ error: 'Access denied or invalid playlist/screen combination' });
      }
    }

    // Remove any existing assignment for this screen
    await pool.query(
      'DELETE FROM screen_playlists WHERE screen_id = $1',
      [screen_id]
    );

    // Create new assignment
    const result = await pool.query(
      `INSERT INTO screen_playlists (screen_id, playlist_id)
       VALUES ($1, $2)
       RETURNING *`,
      [screen_id, playlist_id]
    );

    res.status(201).json({
      message: 'Playlist assigned to screen successfully',
      assignment: result.rows[0]
    });
  } catch (error) {
    console.error('Error assigning playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;