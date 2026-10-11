/**
 * Push notifications through Firebase Cloud Messaging.
 *
 * Disabled until Firebase credentials are configured — set ONE of:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
 *   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
 * (Firebase console → Project settings → Service accounts → Generate new private key.)
 */
const fs = require('fs');
const env = require('../config/env');
const logger = require('../config/logger');
const { User } = require('../models');

let messaging = null;
let initialised = false;

function getMessaging() {
  if (initialised) return messaging;
  initialised = true;
  if (env.isTest) return null;

  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      || (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
    if (!raw) {
      logger.info('Push notifications are off (no Firebase credentials configured)');
      return null;
    }
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getMessaging: firebaseMessaging } = require('firebase-admin/messaging');
    const app = initializeApp({ credential: cert(JSON.parse(raw)) }, 'lost-found');
    messaging = firebaseMessaging(app);
    logger.info('Push notifications are on (Firebase)');
  } catch (err) {
    logger.error(`Could not start Firebase push: ${err.message}`);
    messaging = null;
  }
  return messaging;
}

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Sends a push to one user's device. Never throws — a failed push must not fail the request.
 * `collapseKey` groups pushes (e.g. all messages of one chat) so the phone shows only the latest.
 */
async function sendPush(userId, { title, body, data = {}, collapseKey }) {
  const fcm = getMessaging();
  if (!fcm) return false;

  const user = await User.findByPk(userId, { attributes: ['id', 'fcm_token'] });
  if (!user?.fcm_token) return false;

  // FCM data values must be strings.
  const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
  try {
    await fcm.send({
      token: user.fcm_token,
      notification: { title, body },
      data: stringData,
      android: { priority: 'high', ...(collapseKey && { collapseKey }) },
      apns: { headers: collapseKey ? { 'apns-collapse-id': collapseKey } : {}, payload: { aps: { sound: 'default' } } },
    });
    return true;
  } catch (err) {
    if (DEAD_TOKEN_CODES.has(err.code)) {
      await user.update({ fcm_token: null }); // app was uninstalled or token rotated
    } else {
      logger.warn(`Push to user ${userId} failed: ${err.message}`);
    }
    return false;
  }
}

module.exports = { sendPush };
