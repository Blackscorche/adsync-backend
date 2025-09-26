const { S3Client } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Configure DigitalOcean Spaces with AWS SDK v3
const s3 = new S3Client({
  endpoint: `https://${process.env.DO_SPACES_ENDPOINT}`,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
  region: process.env.DO_SPACES_REGION,
  forcePathStyle: false, // Use subdomain/virtual calling format
});

// Content upload configuration
const contentUpload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.DO_SPACES_BUCKET,
    acl: 'public-read',
    key: function (req, file, cb) {
      const uniqueId = uuidv4();
      const ext = path.extname(file.originalname);
      const key = `content/${uniqueId}${ext}`;
      cb(null, key);
    },
    metadata: function (req, file, cb) {
      cb(null, {
        fieldName: file.fieldname,
        originalName: file.originalname,
        uploadedBy: req.user?.userId?.toString() || 'unknown',
        uploadedAt: new Date().toISOString()
      });
    },
    contentType: multerS3.AUTO_CONTENT_TYPE
  }),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mov|pdf|webp/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = allowedTypes.test(file.mimetype);
    const extName = allowedTypes.test(ext);

    if (mimeType && extName) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, videos, and PDFs are allowed.'));
    }
  }
});

// Shop image upload configuration
const shopUpload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.DO_SPACES_BUCKET,
    acl: 'public-read',
    key: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const key = `shops/shop-${uniqueSuffix}${ext}`;
      cb(null, key);
    },
    metadata: function (req, file, cb) {
      cb(null, {
        fieldName: file.fieldname,
        originalName: file.originalname,
        uploadedBy: req.user?.userId?.toString() || 'unknown',
        uploadedAt: new Date().toISOString()
      });
    },
    contentType: multerS3.AUTO_CONTENT_TYPE
  }),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit for shop images
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Support ticket attachment upload
const ticketUpload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.DO_SPACES_BUCKET,
    acl: 'public-read',
    key: function (req, file, cb) {
      const uniqueId = uuidv4();
      const ext = path.extname(file.originalname);
      const key = `tickets/${uniqueId}${ext}`;
      cb(null, key);
    },
    metadata: function (req, file, cb) {
      cb(null, {
        fieldName: file.fieldname,
        originalName: file.originalname,
        uploadedBy: req.user?.userId?.toString() || 'unknown',
        uploadedAt: new Date().toISOString()
      });
    },
    contentType: multerS3.AUTO_CONTENT_TYPE
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = allowedTypes.test(file.mimetype);
    const extName = allowedTypes.test(ext);

    if (mimeType && extName) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, PDFs, and documents are allowed.'));
    }
  }
});

// Utility function to delete file from Spaces
const deleteFile = async (fileKey) => {
  try {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const params = {
      Bucket: process.env.DO_SPACES_BUCKET,
      Key: fileKey
    };

    await s3.send(new DeleteObjectCommand(params));
    console.log(`File deleted successfully: ${fileKey}`);
    return true;
  } catch (error) {
    console.error('Error deleting file from Spaces:', error);
    return false;
  }
};

// Utility function to get file URL with CDN
const getFileUrl = (fileKey) => {
  if (!fileKey) return null;

  // If CDN URL is configured, use it
  if (process.env.DO_SPACES_CDN_URL) {
    return `${process.env.DO_SPACES_CDN_URL}/${fileKey}`;
  }

  // Otherwise use direct Spaces URL
  const region = process.env.DO_SPACES_REGION;
  const bucket = process.env.DO_SPACES_BUCKET;
  return `https://${bucket}.${region}.digitaloceanspaces.com/${fileKey}`;
};

// Utility function to extract key from URL
const getKeyFromUrl = (url) => {
  if (!url) return null;

  // Handle CDN URLs
  if (process.env.DO_SPACES_CDN_URL && url.includes(process.env.DO_SPACES_CDN_URL)) {
    return url.replace(`${process.env.DO_SPACES_CDN_URL}/`, '');
  }

  // Handle direct Spaces URLs
  const bucket = process.env.DO_SPACES_BUCKET;
  const region = process.env.DO_SPACES_REGION;
  const spacesUrl = `https://${bucket}.${region}.digitaloceanspaces.com/`;

  if (url.includes(spacesUrl)) {
    return url.replace(spacesUrl, '');
  }

  return url;
};


module.exports = {
  contentUpload,
  shopUpload,
  ticketUpload,
  deleteFile,
  getFileUrl,
  getKeyFromUrl,
  s3
};