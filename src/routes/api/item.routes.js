const { Router } = require('express');
const controller = require('../../controllers/api/item.controller');
const validate = require('../../middlewares/validate');
const { requireAuth, optionalAuth } = require('../../middlewares/auth');
const { createItemLimiter, claimLimiter } = require('../../middlewares/rateLimiters');
const { imagesUpload } = require('../../middlewares/upload');
const ApiError = require('../../utils/ApiError');
const schemas = require('../../validators/item.validator');
const claimSchemas = require('../../validators/claim.validator');
const claimController = require('../../controllers/api/claim.controller');

const router = Router();

router.param('id', (req, res, next, id) => (/^\d+$/.test(id) ? next() : next(ApiError.notFound('Item not found'))));
router.param('imageId', (req, res, next, id) => (/^\d+$/.test(id) ? next() : next(ApiError.notFound('Image not found'))));

/**
 * @swagger
 * tags:
 *   - name: Items
 *     description: Lost and found posts
 *
 * components:
 *   schemas:
 *     Item:
 *       type: object
 *       properties:
 *         id: { type: integer, example: 41 }
 *         type: { type: string, enum: [lost, found] }
 *         title: { type: string, example: Black leather wallet }
 *         description: { type: string, example: 'Has a citizenship card and a photo inside' }
 *         status: { type: string, enum: [open, claimed, returned, closed] }
 *         category:
 *           type: object
 *           properties:
 *             id: { type: integer }
 *             name: { type: string, example: Wallet }
 *             slug: { type: string, example: wallet }
 *             icon: { type: string, example: wallet }
 *         event_date: { type: string, format: date, description: 'When it was lost / found', example: '2026-10-09' }
 *         area_name: { type: string, example: 'Ratnapark, Kathmandu' }
 *         location:
 *           type: object
 *           description: Exact only for the owner. Others get coordinates rounded to about 1 km.
 *           properties:
 *             latitude: { type: number, example: 27.71 }
 *             longitude: { type: number, example: 85.32 }
 *             approximate: { type: boolean }
 *         distance_km: { type: number, description: 'Only when lat/lng are sent', example: 1.5 }
 *         secret_question: { type: string, nullable: true, description: 'Found items only. The claimer must answer it.', example: 'What is the name on the card inside?' }
 *         images:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id: { type: integer }
 *               url: { type: string }
 *               width: { type: integer }
 *               height: { type: integer }
 *         owner:
 *           type: object
 *           properties:
 *             id: { type: integer }
 *             name: { type: string }
 *             avatar_url: { type: string, nullable: true }
 *         is_mine: { type: boolean }
 *         is_hidden: { type: boolean, description: Owner only }
 *         hidden_reason: { type: string, nullable: true, description: Owner only }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *         pending_claims: { type: integer, description: 'Item detail, poster only — claims waiting for you' }
 *         my_claim:
 *           type: object
 *           nullable: true
 *           description: 'Item detail, others only — your latest claim on this item'
 *           properties:
 *             id: { type: integer }
 *             status: { type: string }
 *         claim_attempts_left: { type: integer, description: 'Item detail, others only' }
 *     ItemResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string }
 *         data: { $ref: '#/components/schemas/Item' }
 *     ItemListResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string }
 *         data:
 *           type: array
 *           items: { $ref: '#/components/schemas/Item' }
 *         meta: { $ref: '#/components/schemas/PageMeta' }
 *     PageMeta:
 *       type: object
 *       properties:
 *         page: { type: integer, example: 1 }
 *         limit: { type: integer, example: 20 }
 *         total: { type: integer, example: 57 }
 *         totalPages: { type: integer, example: 3 }
 *   parameters:
 *     ItemId:
 *       name: id
 *       in: path
 *       required: true
 *       schema: { type: integer }
 *   responses:
 *     NotFound:
 *       description: Not found
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ErrorResponse' }
 */

/**
 * @swagger
 * /items:
 *   get:
 *     tags: [Items]
 *     summary: Browse open items (feed, search, nearby)
 *     description: >
 *       Public — no login needed. If you send a token, `is_mine` is filled in.
 *       Send `lat` + `lng` to get `distance_km` and only items within `radius_km`.
 *     parameters:
 *       - { name: type, in: query, schema: { type: string, enum: [lost, found] } }
 *       - { name: category, in: query, description: Category id or slug, schema: { type: string }, example: wallet }
 *       - { name: q, in: query, description: Search title, description and area, schema: { type: string } }
 *       - { name: lat, in: query, schema: { type: number }, example: 27.7172 }
 *       - { name: lng, in: query, schema: { type: number }, example: 85.324 }
 *       - { name: radius_km, in: query, schema: { type: number, default: 10, minimum: 0.5, maximum: 200 } }
 *       - { name: date_from, in: query, schema: { type: string, format: date } }
 *       - { name: date_to, in: query, schema: { type: string, format: date } }
 *       - { name: sort, in: query, schema: { type: string, enum: [newest, nearest], default: newest } }
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 20, maximum: 50 } }
 *     responses:
 *       200:
 *         description: Items
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ItemListResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *   post:
 *     tags: [Items]
 *     summary: Post a lost or found item
 *     description: >
 *       Send as **multipart/form-data**. Up to 5 photos in the `images` field (JPG/PNG/WEBP, max 8 MB each).
 *       Photos are resized and all hidden metadata (including GPS) is removed.
 *       Found items require `secret_question` + `secret_answer`; lost items must not send them.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [type, title, category_id, event_date, area_name, latitude, longitude]
 *             properties:
 *               type: { type: string, enum: [lost, found] }
 *               title: { type: string, example: Black leather wallet }
 *               description: { type: string }
 *               category_id: { type: integer, example: 2 }
 *               event_date: { type: string, format: date, example: '2026-10-09' }
 *               area_name: { type: string, example: 'Ratnapark, Kathmandu' }
 *               latitude: { type: number, example: 27.7056 }
 *               longitude: { type: number, example: 85.3149 }
 *               secret_question: { type: string, description: Found items only, example: 'What is the name on the card inside?' }
 *               secret_answer: { type: string, description: 'Found items only. Stored encrypted, never shown.' }
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Item created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ItemResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429:
 *         description: Posting too often
 */
router.get('/', optionalAuth, validate(schemas.list, 'query'), controller.list);
router.post('/', requireAuth, createItemLimiter, imagesUpload, validate(schemas.create), controller.create);

/**
 * @swagger
 * /items/mine:
 *   get:
 *     tags: [Items]
 *     summary: My posts (all statuses, including hidden)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: status, in: query, schema: { type: string, enum: [open, claimed, returned, closed] } }
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 20, maximum: 50 } }
 *     responses:
 *       200:
 *         description: My items
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ItemListResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/mine', requireAuth, validate(schemas.mine, 'query'), controller.mine);

/**
 * @swagger
 * /items/{id}:
 *   get:
 *     tags: [Items]
 *     summary: Item details
 *     parameters: [{ $ref: '#/components/parameters/ItemId' }]
 *     responses:
 *       200:
 *         description: Item
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ItemResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Items]
 *     summary: Edit my item
 *     description: Only while the item is `open`. Send `latitude` and `longitude` together, and `secret_question` with `secret_answer`.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ItemId' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               category_id: { type: integer }
 *               event_date: { type: string, format: date }
 *               area_name: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               secret_question: { type: string }
 *               secret_answer: { type: string }
 *     responses:
 *       200:
 *         description: Updated item
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ItemResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403:
 *         description: Not your item
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     tags: [Items]
 *     summary: Delete my item
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ItemId' }]
 *     responses:
 *       200:
 *         description: Deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MessageResponse' }
 *       403:
 *         description: Not your item
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', optionalAuth, controller.show);
router.patch('/:id', requireAuth, validate(schemas.update), controller.update);
router.delete('/:id', requireAuth, controller.destroy);

/**
 * @swagger
 * /items/{id}/images:
 *   post:
 *     tags: [Items]
 *     summary: Add photos to my item (max 5 in total)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ItemId' }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Item with new images
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ItemResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/:id/images', requireAuth, imagesUpload, controller.addImages);

/**
 * @swagger
 * /items/{id}/images/{imageId}:
 *   delete:
 *     tags: [Items]
 *     summary: Remove a photo from my item
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { $ref: '#/components/parameters/ItemId' }
 *       - { name: imageId, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Item without that image
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ItemResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/:id/images/:imageId', requireAuth, controller.deleteImage);

/**
 * @swagger
 * /items/{id}/close:
 *   post:
 *     tags: [Items]
 *     summary: Close my post (e.g. I found it myself)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ItemId' }]
 *     responses:
 *       200:
 *         description: Item with status closed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ItemResponse' }
 */
router.post('/:id/close', requireAuth, controller.close);

/**
 * @swagger
 * /items/{id}/matches:
 *   get:
 *     tags: [Items]
 *     summary: Possible matches for my item
 *     description: >
 *       For a lost item, returns found items (and vice versa) in the same category, within 15 km and
 *       30 days, ranked by `match_score` (0–100) from distance, date and similar words.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ItemId' }]
 *     responses:
 *       200:
 *         description: Up to 10 matches, best first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Item'
 *                       - type: object
 *                         properties:
 *                           match_score: { type: integer, example: 82 }
 */
router.get('/:id/matches', requireAuth, controller.matches);

/**
 * @swagger
 * /items/{id}/claims:
 *   post:
 *     tags: [Claims]
 *     summary: '"This is mine" (found item) or "I found this" (lost item)'
 *     description: >
 *       **Found item:** `answer` (to the item's `secret_question`) is required; `message` is optional.
 *       Each person gets 3 attempts per item.
 *       **Lost item:** `message` is required (where/when you found it); `answer` must not be sent.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ItemId' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               answer: { type: string, example: 'Ram Thapa' }
 *               message: { type: string, example: 'I lost it on Friday near the bus stop.' }
 *     responses:
 *       201:
 *         description: Claim created (pending)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ClaimResponse' }
 *       400: { description: 'Own item, item not open, or missing answer/message' }
 *       409: { description: You already have an active claim on this item }
 *       429: { description: No attempts left for this item }
 *   get:
 *     tags: [Claims]
 *     summary: Claims on my item (poster)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ItemId'
 *       - $ref: '#/components/parameters/ClaimStatusFilter'
 *     responses:
 *       200:
 *         description: Claims
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ClaimListResponse' }
 */
router.post('/:id/claims', requireAuth, claimLimiter, validate(claimSchemas.create), claimController.create);
router.get('/:id/claims', requireAuth, validate(claimSchemas.list, 'query'), claimController.listForItem);

module.exports = router;
