const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Check if user is still active
    try {
      const result = await pool.query(
        'SELECT is_active FROM users WHERE id = $1',
        [user.userId]
      );

      if (result.rows.length === 0 || !result.rows[0].is_active) {
        return res.status(403).json({ error: 'Account has been deactivated' });
      }
    } catch (error) {
      console.error('Error checking user status:', error);
      // Continue with request if database check fails to avoid blocking all requests
    }

    req.user = user;
    next();
  });
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
};

module.exports = {
  authenticateToken,
  requireRole
};