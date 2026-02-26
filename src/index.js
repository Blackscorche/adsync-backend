require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const path = require('path')
const billingScheduler = require('./services/billingScheduler')

const app = express()
const PORT = process.env.PORT || 5000

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin image loading
    contentSecurityPolicy: false, // Disable CSP for now to avoid blocking resources
  })
)
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true)

      // Parse multiple frontend URLs from environment variable
      const allowedOrigins = process.env.FRONTEND_URLS
        ? process.env.FRONTEND_URLS.split(',').map((url) => url.trim())
        : ['http://localhost:3000']

      // Check if origin is allowed
      const isAllowed =
        allowedOrigins.some((allowed) => origin === allowed) ||
        origin.includes('localhost') || // Allow all localhost for development
        origin.includes('10.0.2') || // Allow Android emulator
        origin.startsWith('exp://') // Allow Expo client

      callback(null, isAllowed)
    },
    credentials: true,
  })
)

// Trust proxy for production (to handle X-Forwarded-For headers)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1)
}

// Rate limiting - Different limits for different endpoints
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
})

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 uploads per 15 minutes
  message: 'Too many uploads from this IP, please try again later.',
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per 15 minutes
  message: 'Too many login attempts from this IP, please try again later.',
})

// Mobile-specific rate limiter - more lenient for heartbeats
const mobileLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 100, // 100 requests per minute
  message: 'Too many requests from this device, please try again later.',
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
})

// Heartbeat-specific rate limiter - very lenient
const heartbeatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 200, // 200 heartbeats per minute (basically unlimited for normal use)
  message: 'Too many heartbeats from this device.',
  skipFailedRequests: true, // Don't count failed requests
  standardHeaders: true,
  legacyHeaders: false,
})

// Apply general limiter to all API routes EXCEPT mobile
app.use('/api', (req, res, next) => {
  // Skip rate limiting for mobile endpoints
  if (req.path.startsWith('/mobile')) {
    return next()
  }
  generalLimiter(req, res, next)
})

// Body parsing middleware - increased limits for file uploads
app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ extended: true, limit: '100mb' }))

// Middleware to add CORS headers for static files
const staticCors = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  )
  res.header('Cross-Origin-Resource-Policy', 'cross-origin')
  next()
}

// Static file serving is now handled by DigitalOcean Spaces + CDN
// Keep logo serving for backward compatibility
app.use(
  '/uploads',
  staticCors,
  express.static(path.join(__dirname, '../uploads'))
)

// Routes with specific rate limiters
app.use('/api/auth', authLimiter, require('./routes/auth'))

// Mobile routes with custom middleware for heartbeat
app.use(
  '/api/mobile',
  (req, res, next) => {
    // Apply different rate limiter for heartbeat endpoint
    if (req.path === '/heartbeat') {
      return heartbeatLimiter(req, res, next)
    }
    // Apply normal mobile limiter for other endpoints
    return mobileLimiter(req, res, next)
  },
  require('./routes/mobile')
) // Mobile app endpoints with lenient rate limiting
app.use('/api/admin', require('./routes/admin'))
app.use('/api/shops', require('./routes/shops'))
app.use('/api/screens', require('./routes/screens'))
app.use('/api/screen-requests', require('./routes/screenRequests'))
app.use('/api/content', require('./routes/content'))
app.use('/api/postcode', require('./routes/postcode'))
app.use('/api/sales', require('./routes/sales'))
app.use('/api/design', require('./routes/design'))
app.use('/api/notifications', require('./routes/notifications'))
app.use('/api/promotion-types', require('./routes/promotionTypes'))
// app.use('/api/support', require('./routes/support')); // Disabled - Support feature removed

// Routes for Milestone 2
app.use('/api/playlists', require('./routes/playlists'))
app.use('/api/billing', require('./routes/billing'))
app.use('/api/payment', require('./routes/payment'))
app.use('/api/monitoring', require('./routes/monitoring'))
app.use('/api/ad-preferences', require('./routes/adPreferences'))

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Ivaa AdSync API is running',
    timestamp: new Date().toISOString(),
  })
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(err.status || 500).json({
    error:
      process.env.NODE_ENV === 'production'
        ? 'Something went wrong!'
        : err.message,
  })
})

// Start server
app.listen(PORT, () => {
  console.log(`
  🚀 Ivaa AdSync Backend Server
  ================================
  Running on port: ${PORT}
  Environment: ${process.env.NODE_ENV || 'development'}
  ================================
  `)

  // Start billing scheduler
  billingScheduler.start()
  console.log('  ✅ Billing scheduler started\n')
})
