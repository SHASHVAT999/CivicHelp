const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Use an absolute, reliable filesystem path for uploads
const uploadsDir = path.resolve(__dirname, '../uploads');

// Create the uploads directory automatically at runtime
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Strict mapping of allowed MIME types to extensions (JPEG, PNG, WebP)
const MIME_EXTENSION_MAP = {
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/png': new Set(['.png']),
  'image/webp': new Set(['.webp']),
};

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const validExtensions = MIME_EXTENSION_MAP[file.mimetype];
    const safeExt = (validExtensions && validExtensions.has(ext))
      ? ext
      : (file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `complaint-${uniqueSuffix}${safeExt}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const validExtensions = MIME_EXTENSION_MAP[file.mimetype];
    if (validExtensions && validExtensions.has(ext)) {
      cb(null, true);
    } else {
      const err = new Error('Invalid file format. Only JPEG, PNG, and WebP images are allowed.');
      err.code = 'INVALID_FILE_TYPE';
      cb(err, false);
    }
  }
});

// Middleware wrapper to handle Multer errors gracefully without crashing the server
const handleSingleImageUpload = (fieldName = 'image') => {
  const uploader = upload.single(fieldName);
  return (req, res, next) => {
    uploader(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Image file size exceeds the 5 MB limit.' });
          }
          return res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        return res.status(400).json({ error: err.message || 'Failed to process uploaded file.' });
      }
      next();
    });
  };
};

const defaultMiddleware = handleSingleImageUpload('image');
defaultMiddleware.upload = upload;
defaultMiddleware.uploadsDir = uploadsDir;
defaultMiddleware.single = (field) => handleSingleImageUpload(field);

module.exports = defaultMiddleware;
