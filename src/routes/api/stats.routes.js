const { Router } = require('express');
const controller = require('../../controllers/api/stats.controller');

const router = Router();

/**
 * @swagger
 * /stats:
 *   get:
 *     tags: [System]
 *     summary: Community numbers for the home screen
 *     description: Posts created today (hidden posts excluded) and items returned in the last 7 days.
 *     responses:
 *       200:
 *         description: Counts
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: OK
 *               data: { lost_today: 24, found_today: 18, returned_week: 9 }
 */
router.get('/', controller.summary);

module.exports = router;
