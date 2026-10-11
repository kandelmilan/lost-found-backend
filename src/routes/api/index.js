const { Router } = require('express');

const router = Router();

router.use('/health', require('./health.routes'));
router.use('/auth', require('./auth.routes'));
router.use('/me', require('./me.routes'));
router.use('/categories', require('./category.routes'));
router.use('/stats', require('./stats.routes'));
router.use('/items', require('./item.routes'));
router.use('/claims', require('./claim.routes'));
// Chat (/conversations, /claims/:id/messages), /notifications and /reports.
router.use('/', require('./phase5.routes'));

module.exports = router;
