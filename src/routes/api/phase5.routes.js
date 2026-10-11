const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const controller = require('../../controllers/api/phase5.controller');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const schemas = require('../../validators/phase5.validator');

const router = Router();
// Mounted at the API root, so login is required per route (a router-wide check would turn
// every unknown URL into a 401 instead of a 404).
router.param('id', (req, res, next, id) => (/^\d+$/.test(id) ? next() : next(ApiError.notFound('Not found'))));

const perUser = (limit, windowMs, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.isTest,
    keyGenerator: (req) => `user:${req.user.id}`,
    message: { success: false, message },
  });
const messageLimiter = perUser(60, 60 * 1000, 'You are sending messages too fast.');
const reportLimiter = perUser(10, 60 * 60 * 1000, 'Too many reports. Please try again later.');

/**
 * @swagger
 * tags:
 *   - name: Chat
 *     description: >
 *       Each claim is a conversation between the claimer and the item's poster. It is open while the
 *       claim is `pending` or `accepted`, and read-only afterwards.
 *       **Real-time:** connect Socket.io to the API host with `auth: { token: accessToken }`.
 *       Server events: `message:new`, `message:read`, `typing`, `claim:updated`, `notification:new`.
 *       Client events: `claim:join {claimId}`, `claim:leave`, `typing {claimId, isTyping}`,
 *       `message:send {claimId, body}` (ack), `message:read {claimId}` (ack).
 *   - name: Notifications
 *     description: In-app notifications (also sent as push when Firebase is configured, and live over Socket.io).
 *   - name: Reports
 *     description: Report a post or a person to the admins.
 *
 * components:
 *   schemas:
 *     Message:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         claim_id: { type: integer }
 *         sender_id: { type: integer }
 *         is_mine: { type: boolean }
 *         body: { type: string, example: 'Can we meet at Ratnapark at 11?' }
 *         read_at: { type: string, format: date-time, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *     Conversation:
 *       type: object
 *       properties:
 *         claim_id: { type: integer }
 *         claim_status: { type: string }
 *         my_role: { type: string, enum: [claimer, poster] }
 *         can_send: { type: boolean }
 *         item:
 *           type: object
 *           properties:
 *             id: { type: integer }
 *             title: { type: string }
 *             type: { type: string }
 *             image_url: { type: string, nullable: true }
 *         other_person: { $ref: '#/components/schemas/Person' }
 *         last_message: { $ref: '#/components/schemas/Message' }
 *         unread_count: { type: integer }
 *         last_activity_at: { type: string, format: date-time }
 *     Notification:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         type:
 *           type: string
 *           enum: [claim.received, claim.accepted, claim.rejected, claim.cancelled, claim.meeting, claim.confirmed, claim.completed, item.hidden, item.edited]
 *         title: { type: string, example: 'Claim accepted 🎉' }
 *         body: { type: string }
 *         data:
 *           type: object
 *           description: Where to navigate, e.g. { claim_id, item_id }
 *         is_read: { type: boolean }
 *         createdAt: { type: string, format: date-time }
 *     CountResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         data:
 *           type: object
 *           properties:
 *             unread: { type: integer, example: 3 }
 */

/**
 * @swagger
 * /conversations:
 *   get:
 *     tags: [Chat]
 *     summary: My chat list (latest activity first)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 20, maximum: 50 } }
 *     responses:
 *       200:
 *         description: Conversations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Conversation' } }
 *                 meta: { $ref: '#/components/schemas/PageMeta' }
 */
router.get('/conversations', requireAuth, validate(schemas.conversations, 'query'), controller.conversations);

/**
 * @swagger
 * /conversations/unread-count:
 *   get:
 *     tags: [Chat]
 *     summary: Total unread messages (for the chat tab badge)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Count
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/CountResponse' }
 */
router.get('/conversations/unread-count', requireAuth, controller.unreadMessages);

/**
 * @swagger
 * /claims/{id}/messages:
 *   get:
 *     tags: [Chat]
 *     summary: Messages of a conversation (newest page; use next_before for older)
 *     description: '`data` is ordered oldest → newest. `meta.next_before` is the id to pass as `before` to load the previous page.'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ClaimId'
 *       - { name: before, in: query, schema: { type: integer } }
 *       - { name: limit, in: query, schema: { type: integer, default: 30, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Messages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Message' } }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     has_more: { type: boolean }
 *                     next_before: { type: integer, nullable: true }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   post:
 *     tags: [Chat]
 *     summary: Send a message
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ClaimId' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body: { type: string, maxLength: 2000, example: 'Can we meet at Ratnapark at 11?' }
 *     responses:
 *       201:
 *         description: Sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/Message' }
 *       400: { description: Empty / too long, or conversation closed }
 */
router.get('/claims/:id/messages', requireAuth, validate(schemas.messages, 'query'), controller.messages);
router.post('/claims/:id/messages', requireAuth, messageLimiter, validate(schemas.sendMessage), controller.sendMessage);

/**
 * @swagger
 * /claims/{id}/messages/read:
 *   post:
 *     tags: [Chat]
 *     summary: Mark the other person's messages as read
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ $ref: '#/components/parameters/ClaimId' }]
 *     responses:
 *       200: { description: 'data.updated = how many were marked' }
 */
router.post('/claims/:id/messages/read', requireAuth, controller.readMessages);

/**
 * @swagger
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: My notifications (newest first)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: unread_only, in: query, schema: { type: boolean, default: false } }
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 20, maximum: 50 } }
 *     responses:
 *       200:
 *         description: Notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Notification' } }
 *                 meta: { $ref: '#/components/schemas/PageMeta' }
 */
router.get('/notifications', requireAuth, validate(schemas.notifications, 'query'), controller.notifications);

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Unread notifications (for the bell badge)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Count
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/CountResponse' }
 */
router.get('/notifications/unread-count', requireAuth, controller.unreadNotifications);

/**
 * @swagger
 * /notifications/read-all:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark all as read
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: 'data.updated = how many were marked' }
 */
router.post('/notifications/read-all', requireAuth, controller.readAllNotifications);

/**
 * @swagger
 * /notifications/{id}/read:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark one as read
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
 *     responses:
 *       200: { description: The notification }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/notifications/:id/read', requireAuth, controller.readNotification);

/**
 * @swagger
 * /reports:
 *   post:
 *     tags: [Reports]
 *     summary: Report a post or a person
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [target_type, target_id, reason]
 *             properties:
 *               target_type: { type: string, enum: [item, user] }
 *               target_id: { type: integer }
 *               reason: { type: string, enum: [spam, fake, scam, offensive, personal_info, other] }
 *               details: { type: string, maxLength: 1000, example: 'Asked me to pay before returning the phone' }
 *     responses:
 *       201: { description: Report received }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404: { description: Item or user not found }
 *       409: { description: You already have an open report about this }
 */
router.post('/reports', requireAuth, reportLimiter, validate(schemas.report), controller.report);

module.exports = router;
