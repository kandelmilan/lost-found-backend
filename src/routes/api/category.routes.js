const { Router } = require('express');
const controller = require('../../controllers/api/category.controller');

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Categories
 *     description: Item categories (Phone, Wallet, Keys...)
 */

/**
 * @swagger
 * /categories:
 *   get:
 *     tags: [Categories]
 *     summary: List active categories
 *     responses:
 *       200:
 *         description: List of categories
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: OK
 *               data:
 *                 - { id: 1, name: Phone, slug: phone, icon: smartphone }
 *                 - { id: 2, name: Wallet, slug: wallet, icon: wallet }
 */
router.get('/', controller.list);

module.exports = router;
