const express = require('express')
const { authenticateToken } = require('../middleware/auth')
const pool = require('../config/database')

const router = express.Router()

router.get('/', authenticateToken, async (req, res) => {
  try {
    const promotionTypes = await pool.query(
      'SELECT id, name FROM promotion_types'
    )

    res.json({
      data: promotionTypes.rows,
      total: promotionTypes.rows.length,
    })
  } catch (error) {
    console.error('Error on fetching promotion types:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
