const { Router } = require('express');
const controller = require('../../controllers/api/me.controller');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { authLimiter } = require('../../middlewares/rateLimiters');
const schemas = require('../../validators/auth.validator');

const router = Router();
router.use(requireAuth);

/**
 * @swagger
 * tags:
 *   - name: Profile
 *     description: The logged-in user's own account
 *
 * components:
 *   schemas:
 *     UserResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string }
 *         data: { $ref: '#/components/schemas/User' }
 */

/**
 * @swagger
 * /me:
 *   get:
 *     tags: [Profile]
 *     summary: Get my profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *   patch:
 *     tags: [Profile]
 *     summary: Update my profile
 *     description: Send only the fields you want to change. Changing email or phone marks the account as unverified.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: Sita Sharma }
 *               email: { type: string, nullable: true, example: sita@example.com }
 *               phone: { type: string, nullable: true, example: '+9779812345678' }
 *     responses:
 *       200:
 *         description: Updated user
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409:
 *         description: Email or phone already registered
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     tags: [Profile]
 *     summary: Delete my account
 *     description: Permanently deletes the account. Required by the App Store / Play Store.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Account deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MessageResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', controller.show);
router.patch('/', validate(schemas.updateProfile), controller.update);
router.delete('/', authLimiter, validate(schemas.deleteAccount), controller.destroy);

/**
 * @swagger
 * /me/password:
 *   put:
 *     tags: [Profile]
 *     summary: Change my password
 *     description: Logs out every other device and returns fresh tokens for this one.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string, example: Secret123 }
 *               newPassword: { type: string, example: NewSecret456 }
 *     responses:
 *       200:
 *         description: Password changed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     tokens: { $ref: '#/components/schemas/AuthTokens' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put('/password', authLimiter, validate(schemas.changePassword), controller.changePassword);

/**
 * @swagger
 * /me/fcm-token:
 *   put:
 *     tags: [Profile]
 *     summary: Save the device's push notification token
 *     description: Send `null` on logout to stop notifications to this device.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fcmToken]
 *             properties:
 *               fcmToken: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Saved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MessageResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put('/fcm-token', validate(schemas.fcmToken), controller.updateFcmToken);

module.exports = router;
