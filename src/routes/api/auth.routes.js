const { Router } = require('express');
const controller = require('../../controllers/api/auth.controller');
const validate = require('../../middlewares/validate');
const { requireAuth } = require('../../middlewares/auth');
const { authLimiter } = require('../../middlewares/rateLimiters');
const schemas = require('../../validators/auth.validator');

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Register, login and token management
 *
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id: { type: integer, example: 12 }
 *         name: { type: string, example: Sita Sharma }
 *         email: { type: string, nullable: true, example: sita@example.com }
 *         phone: { type: string, nullable: true, example: '+9779812345678' }
 *         avatar_url: { type: string, nullable: true }
 *         role: { type: string, enum: [user, admin], example: user }
 *         is_blocked: { type: boolean, example: false }
 *         is_verified: { type: boolean, example: false }
 *         returned_count: { type: integer, example: 0 }
 *         last_login_at: { type: string, format: date-time, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     AuthTokens:
 *       type: object
 *       properties:
 *         accessToken: { type: string, description: 'Send as `Authorization: Bearer <token>`. Short-lived (15 min).' }
 *         accessTokenExpiresAt: { type: string, format: date-time }
 *         refreshToken: { type: string, description: 'Use with /auth/refresh to get new tokens. Each one works only once.' }
 *         refreshTokenExpiresAt: { type: string, format: date-time }
 *         tokenType: { type: string, example: Bearer }
 *     AuthResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string }
 *         data:
 *           type: object
 *           properties:
 *             user: { $ref: '#/components/schemas/User' }
 *             tokens: { $ref: '#/components/schemas/AuthTokens' }
 *     RefreshTokenBody:
 *       type: object
 *       required: [refreshToken]
 *       properties:
 *         refreshToken: { type: string }
 *     MessageResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string }
 *         data: { nullable: true, example: null }
 *   responses:
 *     ValidationError:
 *       description: Validation failed
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ErrorResponse' }
 *     Unauthorized:
 *       description: Missing, invalid or expired token / credentials
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ErrorResponse' }
 *     Forbidden:
 *       description: Account is blocked
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ErrorResponse' }
 */

/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Create an account
 *     description: Email **or** phone is required (both allowed). Password needs 8+ characters with a letter and a number.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, password]
 *             properties:
 *               name: { type: string, example: Sita Sharma }
 *               email: { type: string, example: sita@example.com }
 *               phone: { type: string, example: '+9779812345678' }
 *               password: { type: string, example: Secret123 }
 *     responses:
 *       201:
 *         description: Account created, user is logged in
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       409:
 *         description: Email or phone already registered
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/register', authLimiter, validate(schemas.register), controller.register);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email or phone
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier, password]
 *             properties:
 *               identifier: { type: string, description: Email or phone, example: sita@example.com }
 *               password: { type: string, example: Secret123 }
 *     responses:
 *       200:
 *         description: Logged in
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/login', authLimiter, validate(schemas.login), controller.login);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Get new tokens using a refresh token
 *     description: >
 *       Call this when the access token expires (401). Returns a **new** refresh token — save it and
 *       discard the old one. Re-using an old refresh token logs the user out of every device.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RefreshTokenBody' }
 *     responses:
 *       200:
 *         description: New tokens
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/refresh', authLimiter, validate(schemas.refreshToken), controller.refresh);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Log out this device
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RefreshTokenBody' }
 *     responses:
 *       200:
 *         description: Logged out
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MessageResponse' }
 */
router.post('/logout', validate(schemas.refreshToken), controller.logout);

/**
 * @swagger
 * /auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     summary: Log out from every device
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: All sessions revoked
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MessageResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/logout-all', requireAuth, controller.logoutAll);

module.exports = router;
