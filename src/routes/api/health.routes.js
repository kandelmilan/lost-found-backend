const { Router } = require('express');
const controller = require('../../controllers/api/health.controller');

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: System
 *     description: Server status
 */

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [System]
 *     summary: Check that the API and database are running
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: Service is healthy
 *               data: { status: ok, database: up, uptime: 120, timestamp: '2026-10-10T10:00:00.000Z' }
 *       503:
 *         description: Database is not reachable
 */
router.get('/', controller.health);

module.exports = router;
