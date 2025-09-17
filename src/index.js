require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const billingScheduler = require('./services/billingScheduler');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin image loading
  contentSecurityPolicy: false // Disable CSP for now to avoid blocking resources
}));
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

// Middleware to add CORS headers for static files
const staticCors = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
};

// Static file serving for uploaded content with CORS
app.use('/uploads/content', staticCors, express.static(path.join(__dirname, '../uploads/content')));
app.use('/uploads/thumbnails', staticCors, express.static(path.join(__dirname, '../uploads/thumbnails')));
app.use('/uploads/shops', staticCors, express.static(path.join(__dirname, '../uploads/shops')));
app.use('/uploads/tickets', staticCors, express.static(path.join(__dirname, '../uploads/tickets')));

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

  // Start billing scheduler
  billingScheduler.start();
  console.log('  ✅ Billing scheduler started\n');
});