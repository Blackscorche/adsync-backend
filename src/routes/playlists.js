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
    } else if (req.user.role === 'design') {
      // Designer can access playlists for their assigned shops
      shopId = req.query.shop_id;
      if (shopId) {
        // Verify designer is assigned to this shop
        const shopCheck = await pool.query(
          'SELECT id FROM shops WHERE id = $1 AND designer_id = $2',
          [shopId, req.user.userId]
        );
        if (shopCheck.rows.length === 0) {
          return res.status(403).json({ error: 'Access denied to this shop' });
        }
      }
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
        pi.id,
        pi.playlist_id,
        pi.content_id,
        pi.position,
        pi.duration,
        json_build_object(
          'title', c.original_filename,
          'file_url', c.file_url,
          'file_type', c.file_type
        ) as content
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
        'SELECT id FROM shops WHERE id = $1 AND designer_id = $2',
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
      `INSERT INTO playlists (name, shop_id, created_by, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING *`,
      [name, shopId, req.user.userId]
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

// Add content to playlist - DESIGNERS manage playlists
router.post('/:id/items', authenticateToken, requireRole(['design', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { content_id, duration = 10 } = req.body;

    // Check if designer is assigned to the shop
    if (req.user.role === 'design') {
      const checkResult = await pool.query(
        `SELECT p.* FROM playlists p
         JOIN shops s ON p.shop_id = s.id
         WHERE p.id = $1 AND s.designer_id = $2`,
        [id, req.user.userId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied - not assigned to this shop' });
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

// Bulk remove items from playlist
router.delete('/:playlistId/items', authenticateToken, requireRole(['design', 'admin']), async (req, res) => {
  try {
    const { playlistId } = req.params;
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array is required' });
    }

    const result = await pool.query(
      'DELETE FROM playlist_items WHERE playlist_id = $1 AND id = ANY($2::int[]) RETURNING id',
      [playlistId, itemIds]
    );

    // Reorder remaining items
    await pool.query(
      `WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 AS new_position
        FROM playlist_items
        WHERE playlist_id = $1
      )
      UPDATE playlist_items SET position = numbered.new_position
      FROM numbered WHERE playlist_items.id = numbered.id`,
      [playlistId]
    );

    res.json({ message: `${result.rowCount} items removed from playlist` });
  } catch (error) {
    console.error('Error bulk removing items from playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update playlist items (positions and durations) - Designers only
router.put('/:id/items', authenticateToken, requireRole(['design']), async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body; // Array of { content_id, position, duration }

    // Verify designer has access to this playlist's shop
    const accessCheck = await pool.query(
      `SELECT p.id FROM playlists p
       JOIN shops s ON p.shop_id = s.id
       WHERE p.id = $1 AND s.designer_id = $2`,
      [id, req.user.userId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this playlist' });
    }

    // Clear existing items and add new ones in a transaction
    await pool.query('BEGIN');

    try {
      // Delete all existing items for this playlist
      await pool.query(
        'DELETE FROM playlist_items WHERE playlist_id = $1',
        [id]
      );

      // Insert new items
      for (const item of items) {
        await pool.query(
          `INSERT INTO playlist_items (playlist_id, content_id, position, duration)
           VALUES ($1, $2, $3, $4)`,
          [id, item.content_id, item.position, item.duration]
        );
      }

      await pool.query('COMMIT');
      res.json({ message: 'Playlist items updated successfully' });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Error updating playlist items:', error);
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

// Publish playlist - DESIGNERS can publish their playlists
router.post('/:id/publish', authenticateToken, requireRole(['design', 'admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if designer is assigned to the shop
    if (req.user.role === 'design') {
      const checkResult = await pool.query(
        `SELECT p.* FROM playlists p
         JOIN shops s ON p.shop_id = s.id
         WHERE p.id = $1 AND s.designer_id = $2`,
        [id, req.user.userId]
      );

      if (checkResult.rows.length === 0) {
        return res.status(403).json({ error: 'Access denied - not assigned to this shop' });
      }
    }

    // Check if playlist has content
    const itemsCheck = await pool.query(
      'SELECT COUNT(*) as count FROM playlist_items WHERE playlist_id = $1',
      [id]
    );

    if (parseInt(itemsCheck.rows[0].count) === 0) {
      return res.status(400).json({ error: 'Cannot publish empty playlist' });
    }

    // Update playlist status to published
    const result = await pool.query(
      `UPDATE playlists
       SET status = 'published', is_active = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    res.json({
      message: 'Playlist published successfully',
      playlist: result.rows[0]
    });
  } catch (error) {
    console.error('Error publishing playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get playlists for owner to view and assign
router.get('/owner/:shopId', authenticateToken, requireRole(['owner']), async (req, res) => {
  try {
    const { shopId } = req.params;

    // Verify owner owns this shop
    const shopCheck = await pool.query(
      'SELECT id FROM shops WHERE id = $1 AND owner_id = $2',
      [shopId, req.user.userId]
    );

    if (shopCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get only published playlists for the shop
    const result = await pool.query(
      `SELECT
        p.*,
        u.full_name as created_by_name,
        COUNT(DISTINCT pi.id) as item_count,
        SUM(pi.duration) as total_duration,
        STRING_AGG(DISTINCT sp.screen_id::text, ',') as assigned_screens
       FROM playlists p
       LEFT JOIN users u ON p.created_by = u.id
       LEFT JOIN playlist_items pi ON p.id = pi.playlist_id
       LEFT JOIN screen_playlists sp ON p.id = sp.playlist_id
       WHERE p.shop_id = $1 AND p.status = 'published'
       GROUP BY p.id, u.full_name
       ORDER BY p.updated_at DESC`,
      [shopId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching owner playlists:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get schedules for a screen
router.get('/schedules/:screenId', authenticateToken, async (req, res) => {
  try {
    const { screenId } = req.params;
    const result = await pool.query(
      `SELECT ps.*, p.name as playlist_name, p.status as playlist_status
       FROM playlist_schedules ps
       JOIN playlists p ON ps.playlist_id = p.id
       WHERE ps.screen_id = $1
       ORDER BY ps.start_time`,
      [screenId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create or update a schedule for a screen
router.post('/schedules', authenticateToken, requireRole(['owner', 'admin', 'design']), async (req, res) => {
  try {
    const { screenId, playlistId, scheduleName, startTime, endTime } = req.body;

    if (!screenId || !playlistId || !scheduleName || !startTime || !endTime) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const result = await pool.query(
      `INSERT INTO playlist_schedules (screen_id, playlist_id, schedule_name, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (screen_id, schedule_name)
       DO UPDATE SET playlist_id = $2, start_time = $4, end_time = $5
       RETURNING *`,
      [screenId, playlistId, scheduleName, startTime, endTime]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a schedule
router.delete('/schedules/:id', authenticateToken, requireRole(['owner', 'admin', 'design']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM playlist_schedules WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    res.json({ message: 'Schedule deleted' });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mobile: Get active playlist for screen based on schedule
router.get('/schedules/:screenId/active', async (req, res) => {
  try {
    const { screenId } = req.params;

    // Check for a time-based schedule first
    const scheduleResult = await pool.query(
      `SELECT ps.playlist_id, p.name as playlist_name
       FROM playlist_schedules ps
       JOIN playlists p ON ps.playlist_id = p.id
       WHERE ps.screen_id = $1 AND ps.is_active = true
       AND CURRENT_TIME BETWEEN ps.start_time AND ps.end_time
       ORDER BY ps.start_time
       LIMIT 1`,
      [screenId]
    );

    if (scheduleResult.rows.length > 0) {
      return res.json({ source: 'schedule', ...scheduleResult.rows[0] });
    }

    // Fallback to default screen_playlists assignment
    const defaultResult = await pool.query(
      `SELECT sp.playlist_id, p.name as playlist_name
       FROM screen_playlists sp
       JOIN playlists p ON sp.playlist_id = p.id
       WHERE sp.screen_id = $1
       LIMIT 1`,
      [screenId]
    );

    if (defaultResult.rows.length > 0) {
      return res.json({ source: 'default', ...defaultResult.rows[0] });
    }

    res.json({ source: 'none', playlist_id: null });
  } catch (error) {
    console.error('Error fetching active playlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;