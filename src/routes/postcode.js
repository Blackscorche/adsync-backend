const express = require('express');
const axios = require('axios');
const router = express.Router();

const IDEAL_POSTCODES_API_KEY = process.env.IDEAL_POSTCODES_API_KEY;
const IDEAL_POSTCODES_BASE_URL = 'https://api.ideal-postcodes.co.uk/v1';

router.get('/lookup/:postcode', async (req, res) => {
  try {
    const { postcode } = req.params;
    const cleanPostcode = postcode.replace(/\s/g, '').toUpperCase();
    
    const response = await axios.get(`https://api.postcodes.io/postcodes/${cleanPostcode}`);
    
    if (response.data.status === 200 && response.data.result) {
      const result = response.data.result;
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

router.get('/addresses/:postcode', async (req, res) => {
  try {
    const { postcode } = req.params;
    const cleanPostcode = postcode.replace(/\s/g, '').toUpperCase();
    
    if (IDEAL_POSTCODES_API_KEY) {
      try {
        const response = await axios.get(
          `${IDEAL_POSTCODES_BASE_URL}/postcodes/${cleanPostcode}`,
          {
            params: {
              api_key: IDEAL_POSTCODES_API_KEY
            }
          }
        );
        
        if (response.data.result && response.data.result.length > 0) {
          const addresses = response.data.result.map((addr, index) => {
            let line1 = addr.line_1 || '';
            let line2 = addr.line_2 || '';
            
            if (!line1) {
              const parts = [];
              if (addr.organisation_name) parts.push(addr.organisation_name);
              if (addr.building_name) parts.push(addr.building_name);
              if (addr.sub_building_name) parts.push(addr.sub_building_name);
              if (addr.building_number) parts.push(addr.building_number);
              if (addr.thoroughfare) parts.push(addr.thoroughfare);
              
              line1 = parts.filter(p => p).join(', ');
            }
            
            if (!line1) {
              line1 = addr.premise || addr.thoroughfare || 'Address';
            }
            
            return {
              id: `addr_${index + 1}`,
              line1: line1,
              line2: line2 || addr.dependant_locality || '',
              city: addr.post_town || '',
              county: addr.county || '',
              postcode: addr.postcode,
              formatted: `${line1}${line2 ? ', ' + line2 : ''}, ${addr.post_town}, ${addr.postcode}`
            };
          });
          
          res.json({
            success: true,
            addresses: addresses,
            source: 'Ideal Postcodes'
          });
        } else {
          res.status(404).json({
            success: false,
            message: 'No addresses found for this postcode'
          });
        }
      } catch (idealPostcodesError) {
        console.error('Ideal Postcodes API error:', idealPostcodesError.response?.data || idealPostcodesError.message);
        res.status(503).json({
          success: false,
          message: 'Address lookup service unavailable. Please enter address manually.'
        });
      }
    } else {
      res.status(503).json({
        success: false,
        message: 'Address lookup not configured. Please enter address manually.'
      });
    }
  } catch (error) {
    console.error('Address lookup error:', error.message);
    
    res.status(500).json({
      success: false,
      message: 'Failed to lookup addresses'
    });
  }
});


module.exports = router;