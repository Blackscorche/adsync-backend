const express = require('express');
const axios = require('axios');
const router = express.Router();

// UK Postcode lookup using Postcodes.io (free API)
router.get('/lookup/:postcode', async (req, res) => {
  try {
    const { postcode } = req.params;
    
    // Clean the postcode (remove spaces and convert to uppercase)
    const cleanPostcode = postcode.replace(/\s/g, '').toUpperCase();
    
    // Call the Postcodes.io API
    const response = await axios.get(`https://api.postcodes.io/postcodes/${cleanPostcode}`);
    
    if (response.data.status === 200 && response.data.result) {
      const result = response.data.result;
      
      // Extract relevant address information
      const addressData = {
        postcode: result.postcode,
        latitude: result.latitude,
        longitude: result.longitude,
        city: result.admin_district || result.parish || '',
        county: result.admin_county || '',
        region: result.region,
        district: result.admin_district,
        ward: result.admin_ward,
        parliamentary_constituency: result.parliamentary_constituency
      };
      
      res.json({
        success: true,
        data: addressData
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Postcode not found'
      });
    }
  } catch (error) {
    console.error('Postcode lookup error:', error.message);
    
    if (error.response?.status === 404) {
      res.status(404).json({
        success: false,
        message: 'Invalid postcode'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to lookup postcode'
      });
    }
  }
});

// Validate postcode format
router.post('/validate', async (req, res) => {
  try {
    const { postcode } = req.body;
    
    if (!postcode) {
      return res.status(400).json({
        success: false,
        message: 'Postcode is required'
      });
    }
    
    const cleanPostcode = postcode.replace(/\s/g, '').toUpperCase();
    
    // Call validation endpoint
    const response = await axios.get(`https://api.postcodes.io/postcodes/${cleanPostcode}/validate`);
    
    res.json({
      success: true,
      valid: response.data.result
    });
  } catch (error) {
    console.error('Postcode validation error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to validate postcode'
    });
  }
});

// Autocomplete/suggest postcodes
router.get('/autocomplete/:partial', async (req, res) => {
  try {
    const { partial } = req.params;
    const limit = req.query.limit || 10;
    
    const response = await axios.get(`https://api.postcodes.io/postcodes/${partial}/autocomplete`, {
      params: { limit }
    });
    
    if (response.data.status === 200) {
      res.json({
        success: true,
        suggestions: response.data.result || []
      });
    } else {
      res.json({
        success: true,
        suggestions: []
      });
    }
  } catch (error) {
    console.error('Postcode autocomplete error:', error.message);
    res.json({
      success: true,
      suggestions: []
    });
  }
});

// Get addresses for a postcode - returns multiple addresses to select from
router.get('/addresses/:postcode', async (req, res) => {
  try {
    const { postcode } = req.params;
    const cleanPostcode = postcode.replace(/\s/g, '').toUpperCase();
    
    // First get the postcode data
    const postcodeResponse = await axios.get(`https://api.postcodes.io/postcodes/${cleanPostcode}`);
    
    if (postcodeResponse.data.status === 200 && postcodeResponse.data.result) {
      const result = postcodeResponse.data.result;
      
      // For UK postcodes, we'll generate common address formats
      // In a real system, you'd use a proper address API like getAddress.io or Ideal Postcodes
      // For now, we'll create sample addresses based on the postcode area
      
      const baseAddress = {
        postcode: result.postcode,
        city: result.admin_district || result.parish || '',
        county: result.admin_county || ''
      };
      
      // Generate sample addresses (in production, use a proper address API)
      const addresses = [];
      
      // Add some sample addresses - in reality these would come from an address database
      for (let i = 1; i <= 5; i++) {
        addresses.push({
          id: `addr_${i}`,
          line1: `${i} Example Street`,
          line2: result.admin_ward || '',
          city: baseAddress.city,
          county: baseAddress.county,
          postcode: baseAddress.postcode,
          formatted: `${i} Example Street, ${baseAddress.city}, ${baseAddress.postcode}`
        });
      }
      
      // Add business addresses
      addresses.push({
        id: 'addr_shop1',
        line1: 'Unit 1, Shopping Centre',
        line2: 'High Street',
        city: baseAddress.city,
        county: baseAddress.county,
        postcode: baseAddress.postcode,
        formatted: `Unit 1, Shopping Centre, High Street, ${baseAddress.city}, ${baseAddress.postcode}`
      });
      
      addresses.push({
        id: 'addr_shop2',
        line1: 'Ground Floor, Retail Park',
        line2: 'Main Road',
        city: baseAddress.city,
        county: baseAddress.county,
        postcode: baseAddress.postcode,
        formatted: `Ground Floor, Retail Park, Main Road, ${baseAddress.city}, ${baseAddress.postcode}`
      });
      
      res.json({
        success: true,
        addresses: addresses,
        note: 'In production, integrate with a proper UK address API for real addresses'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Postcode not found'
      });
    }
  } catch (error) {
    console.error('Address lookup error:', error.message);
    
    if (error.response?.status === 404) {
      res.status(404).json({
        success: false,
        message: 'Invalid postcode'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to lookup addresses'
      });
    }
  }
});

module.exports = router;