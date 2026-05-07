const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const isLocalMode = !process.env.DO_SPACES_BUCKET || process.env.DO_SPACES_BUCKET === 'your-bucket-name' || process.env.DO_SPACES_BUCKET === 'your-real-bucket-name';

// Configure DigitalOcean Spaces with AWS SDK v3
const s3 = new S3Client({
  endpoint: `https://${process.env.DO_SPACES_ENDPOINT || 'fra1.digitaloceanspaces.com'}`,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY || 'fake',
    secretAccessKey: process.env.DO_SPACES_SECRET || 'fake',
  },
  region: process.env.DO_SPACES_REGION || 'fra1',
  forcePathStyle: false, // Use subdomain/virtual calling format
});

// Custom local storage engine to mimic S3 properties (like file.key)
function LocalStorage(opts) {
  this.getDestination = opts.destination;
  this.getFilename = opts.filename;
  this.folder = opts.folder;
}
LocalStorage.prototype._handleFile = function _handleFile(req, file, cb) {
  this.getDestination(req, file, (err, destination) => {
    if (err) return cb(err);
    this.getFilename(req, file, (err, filename) => {
      if (err) return cb(err);
      fs.mkdirSync(destination, { recursive: true });
      const finalPath = path.join(destination, filename);
      const outStream = fs.createWriteStream(finalPath);
      file.stream.pipe(outStream);
      outStream.on('error', cb);
      outStream.on('finish', () => {
        cb(null, {
          destination: destination,
          filename: filename,
          path: finalPath,
          size: outStream.bytesWritten,
          key: this.folder + '/' + filename
        });
      });
    });
  });
};
LocalStorage.prototype._removeFile = function _removeFile(req, file, cb) {
  fs.unlink(file.path, cb);
};

const getStorage = (folderPath, limits, filter) => {
  if (isLocalMode) {
    return multer({
      storage: new LocalStorage({
        folder: folderPath,
        destination: (req, file, cb) => {
          cb(null, path.join(__dirname, '../../uploads', folderPath));
        },
        filename: (req, file, cb) => {
          const uniqueId = uuidv4();
          const ext = path.extname(file.originalname);
          cb(null, `${uniqueId}${ext}`);
        }
      }),
      limits: limits,
      fileFilter: filter
    });
  }

  return multer({
    storage: multerS3({
      s3: s3,
      bucket: process.env.DO_SPACES_BUCKET,
      acl: 'public-read',
      key: function (req, file, cb) {
        const uniqueId = uuidv4();
        const ext = path.extname(file.originalname);
        cb(null, `${folderPath}/${uniqueId}${ext}`);
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
    limits: limits,
    fileFilter: filter
  });
};

// Content upload configuration
const contentUpload = getStorage('content', { fileSize: 100 * 1024 * 1024 }, (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mov|pdf|webp/;
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = allowedTypes.test(file.mimetype);
  const extName = allowedTypes.test(ext);
  if (mimeType && extName) return cb(null, true);
  cb(new Error('Invalid file type. Only images, videos, and PDFs are allowed.'));
});

// Shop image upload configuration
const shopUpload = getStorage('shops', { fileSize: 5 * 1024 * 1024 }, (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (mimetype && extname) return cb(null, true);
  cb(new Error('Only image files are allowed'));
});

// Support ticket attachment upload
const ticketUpload = getStorage('tickets', { fileSize: 10 * 1024 * 1024 }, (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt/;
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = allowedTypes.test(file.mimetype);
  const extName = allowedTypes.test(ext);
  if (mimeType && extName) return cb(null, true);
  cb(new Error('Invalid file type. Only images, PDFs, and documents are allowed.'));
});

// Utility function to delete file from Spaces or local
const deleteFile = async (fileKey) => {
  try {
    if (isLocalMode) {
      const filePath = path.join(__dirname, '../../uploads', fileKey);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Local file deleted successfully: ${fileKey}`);
      }
      return true;
    }

    const params = { Bucket: process.env.DO_SPACES_BUCKET, Key: fileKey };
    await s3.send(new DeleteObjectCommand(params));
    console.log(`File deleted successfully: ${fileKey}`);
    return true;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
};

// Utility function to get file URL
const getFileUrl = (fileKey) => {
  if (!fileKey) return null;
  
  if (isLocalMode) {
    // Return URL that will be served by express.static in index.js
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:5000';
    return `${baseUrl}/uploads/${fileKey}`;
  }

  if (process.env.DO_SPACES_CDN_URL) {
    return `${process.env.DO_SPACES_CDN_URL}/${fileKey}`;
  }

  const region = process.env.DO_SPACES_REGION;
  const bucket = process.env.DO_SPACES_BUCKET;
  return `https://${bucket}.${region}.digitaloceanspaces.com/${fileKey}`;
};

// Utility function to extract key from URL
const getKeyFromUrl = (url) => {
  if (!url) return null;
  
  if (isLocalMode) {
    const uploadPath = '/uploads/';
    if (url.includes(uploadPath)) {
      return url.substring(url.indexOf(uploadPath) + uploadPath.length);
    }
  }

  if (process.env.DO_SPACES_CDN_URL && url.includes(process.env.DO_SPACES_CDN_URL)) {
    return url.replace(`${process.env.DO_SPACES_CDN_URL}/`, '');
  }

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