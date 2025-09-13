require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api', limiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file serving for uploaded content
app.use('/uploads/content', express.static(path.join(__dirname, '../uploads/content')));
app.use('/uploads/thumbnails', express.static(path.join(__dirname, '../uploads/thumbnails')));
app.use('/uploads/shops', express.static(path.join(__dirname, '../uploads/shops')));
app.use('/uploads/tickets', express.static(path.join(__dirname, '../uploads/tickets')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/shops', require('./routes/shops'));
app.use('/api/screens', require('./routes/screens'));
app.use('/api/content', require('./routes/content'));
app.use('/api/postcode', require('./routes/postcode'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/design', require('./routes/design'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/support', require('./routes/support'));

// Routes for Milestone 2
app.use('/api/playlists', require('./routes/playlists'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/payment', require('./routes/payment'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Ivaa AdSync API is running',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong!' 
      : err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
  🚀 Ivaa AdSync Backend Server
  ================================
  Running on port: ${PORT}
  Environment: ${process.env.NODE_ENV || 'development'}
  ================================
  `);
});