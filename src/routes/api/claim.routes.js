const { Router } = require('express');
const controller = require('../../controllers/api/claim.controller');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const ApiError = require('../../utils/ApiError');
const schemas = require('../../validators/claim.validator');

const router = Router();
router.use(requireAuth);
router.param('id', (req, res, next, id) => (/^\d+$/.test(id) ? next() : next(ApiError.notFound('Claim not found'))));

/**
 * @swagger
 * tags:
 *   - name: Claims
 *     description: >
 *       "This is mine" (on a found item) and "I found this" (on a lost item), then the handover.
 *       Flow: **pending** → poster accepts → **accepted** (item becomes `claimed`) → both set meeting
 *       details and each calls confirm-return → **completed** (item becomes `returned`).
 *       Pending claims can be **rejected** by the poster or withdrawn by the claimer; accepted ones can be
 *       **cancelled** by either side, which puts the item back in the feed.
 *
 * components:
 *   schemas:
 *     Claim:
 *       type: object
 *       properties:
 *         id: { type: integer, example: 7 }
 *         kind: { type: string, enum: [ownership, finder], description: 'ownership = "this is mine" on a found item; finder = "I found this" on a lost item' }
 *         status: { type: string, enum: [pending, accepted, rejected, cancelled, completed] }
 *         my_role: { type: string, enum: [claimer, poster], description: 'claimer = I sent it; poster = it is on my item' }
 *         message: { type: string, example: 'I lost it on Friday evening near the bus stop.' }
 *         answer: { type: string, nullable: true, description: Answer to the secret question (ownership claims) }
 *         answer_correct: { type: boolean, nullable: true, description: 'Poster only — whether the answer matched. Never shown to the claimer.' }
 *         rejection_reason: { type: string, nullable: true }
 *         item:
 *           type: object
 *           properties:
 *             id: { type: integer }
 *             type: { type: string, enum: [lost, found] }
 *             title: { type: string }
 *             status: { type: string }
 *             area_name: { type: string }
 *             secret_question: { type: string, nullable: true }
 *             image_url: { type: string, nullable: true }
 *         claimer: { $ref: '#/components/schemas/Person' }
 *         poster: { $ref: '#/components/schemas/Person' }
 *         meeting:
 *           type: object
 *           properties:
 *             place: { type: string, nullable: true, example: 'Ratnapark police post' }
 *             at: { type: string, format: date-time, nullable: true }
 *             notes: { type: string, nullable: true }
 *         confirmations:
 *           type: object
 *           properties:
 *             claimer: { type: boolean }
 *             poster: { type: boolean }
 *         cancelled_by: { type: string, nullable: true, enum: [claimer, poster, admin, system] }
 *         cancel_reason: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         decided_at: { type: string, format: date-time, nullable: true }
 *         completed_at: { type: string, format: date-time, nullable: true }
 *         cancelled_at: { type: string, format: date-time, nullable: true }
 *     Person:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         name: { type: string }
 *         avatar_url: { type: string, nullable: true }
 *     ClaimResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string }
 *         data: { $ref: '#/components/schemas/Claim' }
 *     ClaimListResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         data:
 *           type: array
 *           items: { $ref: '#/components/schemas/Claim' }
 *         meta: { $ref: '#/components/schemas/PageMeta' }
 *     ReasonBody:
 *       type: object
 *       properties:
 *         reason: { type: string, maxLength: 500 }
 *   parameters:
 *     ClaimId:
 *       name: id
 *       in: path
 *       required: true
 *       schema: { type: integer }
 *     ClaimStatusFilter:
 *       name: status
 *       in: query
 *       schema: { type: string, enum: [pending, accepted, rejected, cancelled, completed] }
 */

/**
 * @swagger
 * /claims/sent:
 *   get:
 *     tags: [Claims]
 *     summary: Claims I have made
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ClaimStatusFilter'
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 20, maximum: 50 } }
 *     responses:
 *       200:
 *         description: My claims, most recently updated first
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ClaimListResponse' }
 */
router.get('/sent', validate(schemas.list, 'query'), controller.sent);

/**
 * @swagger
 * /claims/received:
 *   get:
 *     tags: [Claims]
 *     summary: Claims on my items
 *     description: Pending claims first. Includes `answer_correct` so you can judge ownership claims.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ClaimStatusFilter'
 *       - { name: item_id, in: query, schema: { type: integer } }
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 20, maximum: 50 } }
 *     responses:
 *       200:
 *         description: Claims on my items
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ClaimListResponse' }
 */
router.get('/received', validate(schemas.list, 'query'), controller.received);

/**
 * @swagger
 * /claims/{id}:
 *   get:
 *     tags: [Claims]
 *     summary: Claim details (only for the claimer and the poster)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ClaimId' }]
 *     responses:
 *       200:
 *         description: Claim
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ClaimResponse' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', controller.show);

/**
 * @swagger
 * /claims/{id}/accept:
 *   post:
 *     tags: [Claims]
 *     summary: Accept a pending claim (poster)
 *     description: The item becomes `claimed` and every other pending claim on it is rejected automatically.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ClaimId' }]
 *     responses:
 *       200:
 *         description: Accepted claim
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ClaimResponse' }
 *       400: { description: Claim is not pending, or item already claimed }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/accept', controller.accept);

/**
 * @swagger
 * /claims/{id}/reject:
 *   post:
 *     tags: [Claims]
 *     summary: Reject a pending claim (poster)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ClaimId' }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ReasonBody' }
 *     responses:
 *       200:
 *         description: Rejected claim
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ClaimResponse' }
 */
router.post('/:id/reject', validate(schemas.reason), controller.reject);

/**
 * @swagger
 * /claims/{id}/cancel:
 *   post:
 *     tags: [Claims]
 *     summary: Withdraw my pending claim, or call off an accepted handover (either side)
 *     description: Cancelling an accepted claim puts the item back in the feed.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ClaimId' }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ReasonBody' }
 *     responses:
 *       200:
 *         description: Cancelled claim
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ClaimResponse' }
 */
router.post('/:id/cancel', validate(schemas.reason), controller.cancel);

/**
 * @swagger
 * /claims/{id}/meeting:
 *   patch:
 *     tags: [Claims]
 *     summary: Set where and when to hand over (either side, after acceptance)
 *     description: Suggest a public place, e.g. a police post, shop or bus park office.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ClaimId' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               place: { type: string, example: 'Ratnapark police post' }
 *               at: { type: string, format: date-time, example: '2026-10-12T05:30:00.000Z' }
 *               notes: { type: string, example: 'I will wear a red jacket' }
 *     responses:
 *       200:
 *         description: Claim with meeting details
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ClaimResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.patch('/:id/meeting', validate(schemas.meeting), controller.meeting);

/**
 * @swagger
 * /claims/{id}/confirm-return:
 *   post:
 *     tags: [Claims]
 *     summary: Confirm the item was handed over (each side once)
 *     description: When both sides have confirmed, the claim is `completed`, the item is `returned` and the finder's returned count goes up.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ClaimId' }]
 *     responses:
 *       200:
 *         description: Claim with confirmations
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ClaimResponse' }
 */
router.post('/:id/confirm-return', controller.confirmReturn);

module.exports = router;
