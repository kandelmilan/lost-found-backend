/**
 * Real-time layer (Socket.io).
 *
 * Connect with the same access token as the REST API:
 *   io('https://api.example.com', { auth: { token: '<accessToken>' } })
 *
 * Every socket joins the room `user:<id>`, so the server can reach all of a user's devices.
 *
 * Client → server
 *   claim:join     { claimId }            (ack)  start receiving typing events for a conversation
 *   claim:leave    { claimId }
 *   typing         { claimId, isTyping }
 *   message:send   { claimId, body }      (ack)  same as POST /claims/:id/messages
 *   message:read   { claimId }            (ack)  same as POST /claims/:id/messages/read
 *
 * Server → client
 *   message:new        a message (also sent to the sender's other devices)
 *   message:read       { claim_id, reader_id, read_at }
 *   typing             { claim_id, user_id, is_typing }
 *   claim:updated      { claim_id, status }  — refresh that claim
 *   notification:new   a notification
 */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../config/logger');
const { User } = require('../models');
const { verifyAccessToken } = require('../services/token.service');

let io = null;

const userRoom = (id) => `user:${id}`;
const claimRoom = (id) => `claim:${id}`;

// Small per-socket flood guard: at most 20 events per 10 seconds.
function rateGuard() {
  let windowStart = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart > 10000) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= 20;
  };
}

async function authenticate(socket, next) {
  try {
    const header = socket.handshake.headers?.authorization || '';
    const token = socket.handshake.auth?.token || (header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) return next(new Error('Missing access token'));

    const payload = verifyAccessToken(token);
    const user = await User.findByPk(payload.sub);
    if (!user) return next(new Error('Account no longer exists'));
    if (user.is_blocked) return next(new Error('Account blocked'));

    socket.data.user = user;
    return next();
  } catch (err) {
    return next(new Error(err instanceof jwt.TokenExpiredError ? 'Access token has expired' : 'Invalid access token'));
  }
}

function respond(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

const errorPayload = (err) => ({ ok: false, message: err.statusCode && err.statusCode < 500 ? err.message : 'Something went wrong' });

function initSocket(server) {
  // Required here (not at the top) because chat.service emits through this module.
  const chatService = require('../services/chat.service');

  io = new Server(server, {
    cors: { origin: env.corsOrigins.includes('*') ? '*' : env.corsOrigins },
    maxHttpBufferSize: 64 * 1024,
  });

  io.use(authenticate);

  io.on('connection', (socket) => {
    const { user } = socket.data;
    const allowed = rateGuard();
    socket.join(userRoom(user.id));

    socket.on('claim:join', async (payload, ack) => {
      try {
        const claimId = Number(payload?.claimId);
        await chatService.assertParticipant(user, claimId);
        socket.join(claimRoom(claimId));
        respond(ack, { ok: true });
      } catch (err) {
        respond(ack, errorPayload(err));
      }
    });

    socket.on('claim:leave', (payload) => {
      socket.leave(claimRoom(Number(payload?.claimId)));
    });

    socket.on('typing', (payload) => {
      const claimId = Number(payload?.claimId);
      if (!allowed() || !socket.rooms.has(claimRoom(claimId))) return;
      socket.to(claimRoom(claimId)).emit('typing', { claim_id: claimId, user_id: user.id, is_typing: Boolean(payload.isTyping) });
    });

    socket.on('message:send', async (payload, ack) => {
      if (!allowed()) return respond(ack, { ok: false, message: 'You are sending messages too fast' });
      try {
        const message = await chatService.sendMessage(user, Number(payload?.claimId), payload?.body);
        return respond(ack, { ok: true, data: message });
      } catch (err) {
        return respond(ack, errorPayload(err));
      }
    });

    socket.on('message:read', async (payload, ack) => {
      try {
        const updated = await chatService.markRead(user, Number(payload?.claimId));
        respond(ack, { ok: true, data: { updated } });
      } catch (err) {
        respond(ack, errorPayload(err));
      }
    });
  });

  logger.info('Socket.io ready');
  return io;
}

// No-ops when sockets aren't running (tests, scripts).
function emitToUser(userId, event, payload) {
  if (io) io.to(userRoom(userId)).emit(event, payload);
}

function isOnline(userId) {
  return Boolean(io && io.sockets.adapter.rooms.get(userRoom(userId))?.size);
}

// Used when a user is blocked or deleted.
function disconnectUser(userId) {
  if (io) io.in(userRoom(userId)).disconnectSockets(true);
}

async function closeSocket() {
  if (io) await io.close();
  io = null;
}

module.exports = { initSocket, emitToUser, isOnline, disconnectUser, closeSocket };
