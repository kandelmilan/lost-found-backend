const multer = require('multer');
const ApiError = require('../utils/ApiError');

const MAX_FILE_SIZE_MB = 8;
// HEIC isn't supported by sharp's prebuilt binaries; the Flutter app sends JPEG
// (image_picker converts when imageQuality is set).
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(), // processed by sharp, then saved by storage.service
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, files: 5, fields: 20 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(ApiError.badRequest('Only JPG, PNG or WEBP images are allowed'));
    }
    return cb(null, true);
  },
});

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: `Each image must be ${MAX_FILE_SIZE_MB} MB or smaller`,
  LIMIT_FILE_COUNT: 'You can upload up to 5 images',
  LIMIT_UNEXPECTED_FILE: 'Images must be sent in the "images" field',
};

// Usage: router.post('/', imagesUpload, ...) — expects multipart field "images" (up to 5 files).
function imagesUpload(req, res, next) {
  upload.array('images', 5)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) return next(ApiError.badRequest(MULTER_MESSAGES[err.code] || err.message));
    return next(err);
  });
}

module.exports = { imagesUpload };
