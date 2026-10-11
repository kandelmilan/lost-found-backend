const { Router } = require('express');
const csrfProtection = require('../../middlewares/csrf');
const flash = require('../../middlewares/flash');
const { loadAdmin, requireAdmin, redirectIfLoggedIn } = require('../../middlewares/adminAuth');
const { adminLoginLimiter } = require('../../middlewares/rateLimiters');
const { imagesUpload } = require('../../middlewares/upload');
const ApiError = require('../../utils/ApiError');
const authController = require('../../controllers/admin/auth.controller');
const dashboardController = require('../../controllers/admin/dashboard.controller');
const usersController = require('../../controllers/admin/users.controller');
const itemsController = require('../../controllers/admin/items.controller');
const categoriesController = require('../../controllers/admin/categories.controller');
const claimsController = require('../../controllers/admin/claims.controller');
const reportsController = require('../../controllers/admin/reports.controller');
const logsController = require('../../controllers/admin/logs.controller');
const settingsController = require('../../controllers/admin/settings.controller');
const inboxController = require('../../controllers/admin/inbox.controller');
const claimService = require('../../services/claim.service');

const router = Router();

router.use(loadAdmin);
// The Post Item form is multipart (photos), so it must be parsed before the CSRF check can read
// its _csrf field. Only for a signed-in admin, so anonymous requests can't push uploads into memory.
const adminUploads = (req, res, next) => (req.admin ? imagesUpload(req, res, next) : next());
router.post('/items', adminUploads);
router.post('/items/:id/edit', adminUploads);
router.use(csrfProtection);
router.use(flash);
router.use((req, res, next) => {
  res.locals.active = '';
  next();
});

// Any :id in admin URLs must be a positive integer.
router.param('id', (req, res, next, id) => (/^\d+$/.test(id) ? next() : next(ApiError.notFound('Page not found'))));

// Public
router.get('/login', redirectIfLoggedIn, authController.showLogin);
router.post('/login', redirectIfLoggedIn, adminLoginLimiter, authController.login);

// Protected
router.use(requireAdmin);
// Badge on the Inbox menu (claims + messages waiting for an admin).
router.use(async (req, res, next) => {
  res.locals.inboxCount = await claimService.adminInboxCount();
  next();
});
router.post('/logout', authController.logout);
router.get('/', dashboardController.index);

router.get('/users', usersController.index);
router.get('/users/export', usersController.exportCsv);
router.get('/users/:id', usersController.show);
router.post('/users/:id/block', usersController.block);
router.post('/users/:id/unblock', usersController.unblock);

router.get('/items', itemsController.index);
router.get('/items/export', itemsController.exportCsv);
router.get('/items/new', itemsController.newForm);
router.post('/items', itemsController.create);
router.get('/items/:id', itemsController.show);
router.get('/items/:id/edit', itemsController.editForm);
router.post('/items/:id/edit', itemsController.update);
router.post('/items/:id/hide', itemsController.hide);
router.post('/items/:id/unhide', itemsController.unhide);
router.post('/items/:id/status', itemsController.setStatus);
router.post('/items/:id/delete', itemsController.destroy);

router.get('/inbox', inboxController.index);
router.get('/inbox/count', inboxController.count);
router.get('/claims/:id/live', inboxController.live);
router.post('/claims/:id/accept', inboxController.accept);
router.post('/claims/:id/reject', inboxController.reject);
router.post('/claims/:id/meeting', inboxController.meeting);
router.post('/claims/:id/confirm', inboxController.confirm);
router.post('/claims/:id/messages', inboxController.message);

router.get('/claims', claimsController.index);
router.get('/claims/export', claimsController.exportCsv);
router.get('/claims/:id', claimsController.show);
router.post('/claims/:id/cancel', claimsController.cancel);

router.get('/reports', reportsController.index);
router.get('/reports/export', reportsController.exportCsv);
router.get('/reports/:id', reportsController.show);
router.post('/reports/:id/resolve', reportsController.resolve);
router.post('/reports/:id/dismiss', reportsController.dismiss);

router.get('/logs', logsController.index);
router.get('/logs/export', logsController.exportCsv);

router.get('/settings', settingsController.show);
router.post('/settings/password', settingsController.changePassword);

router.get('/categories', categoriesController.index);
router.post('/categories', categoriesController.create);
router.get('/categories/:id/edit', categoriesController.edit);
router.post('/categories/:id', categoriesController.update);
router.post('/categories/:id/delete', categoriesController.destroy);

module.exports = router;
