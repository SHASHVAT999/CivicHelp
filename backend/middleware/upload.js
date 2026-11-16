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

// Inspect file header magic bytes for genuine image content (JPEG, PNG, WebP)
const detectImageSignature = (buffer) => {
  if (!buffer || buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) {
    return 'image/png';
  }
  // WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
};

// Validate file signature on disk and clean up if invalid
const validateFileSignature = (filePath, claimedMime) => {
  let fd;
  try {
    const buffer = Buffer.alloc(12);
    fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);
    fd = null;
    if (bytesRead < 12) {
      return false;
    }
    const detectedType = detectImageSignature(buffer);
    if (!detectedType) {
      return false;
    }
    const normalizedClaimed = claimedMime === 'image/jpg' ? 'image/jpeg' : claimedMime;
    if (normalizedClaimed && detectedType !== normalizedClaimed) {
      return false;
    }
    return true;
  } catch (err) {
    if (fd !== null && fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) {}
    }
    return false;
  }
};

// Middleware wrapper to handle Multer errors and enforce magic byte validation
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

      // If a file was received, verify genuine image content via magic bytes
      if (req.file) {
        const isValid = validateFileSignature(req.file.path, req.file.mimetype);
        if (!isValid) {
          try {
            if (fs.existsSync(req.file.path)) {
              fs.unlinkSync(req.file.path);
            }
          } catch (cleanupErr) {
            console.error('[Upload Security] Failed to delete invalid upload:', cleanupErr.message);
          }
          delete req.file;
          return res.status(400).json({
            error: 'Invalid image content. File signature does not match allowed JPEG, PNG, or WebP format.'
          });
        }
      }

      next();
    });
  };
};

const defaultMiddleware = handleSingleImageUpload('image');
defaultMiddleware.upload = upload;
defaultMiddleware.uploadsDir = uploadsDir;
defaultMiddleware.single = (field) => handleSingleImageUpload(field);
defaultMiddleware.validateFileSignature = validateFileSignature;
defaultMiddleware.detectImageSignature = detectImageSignature;

module.exports = defaultMiddleware;
