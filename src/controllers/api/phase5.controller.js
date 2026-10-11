// Chat, notifications and reports for the mobile app.
const chatService = require('../../services/chat.service');
const notificationService = require('../../services/notification.service');
const reportService = require('../../services/report.service');
const { ok, created } = require('../../utils/response');
const { pageMeta } = require('../../utils/pagination');

// ---------- Chat ----------

async function conversations(req, res) {
  const { page, limit } = req.validated.query;
  const { conversations: rows, total } = await chatService.listConversations(req.user, { page, limit });
  return ok(res, rows, 'OK', pageMeta({ page, limit, total }));
}

async function unreadMessages(req, res) {
  return ok(res, { unread: await chatService.unreadTotal(req.user) });
}

async function messages(req, res) {
  const { messages: rows, has_more: hasMore, next_before: nextBefore } = await chatService.listMessages(
    req.user,
    Number(req.params.id),
    req.validated.query,
  );
  return ok(res, rows, 'OK', { has_more: hasMore, next_before: nextBefore });
}

async function sendMessage(req, res) {
  return created(res, await chatService.sendMessage(req.user, Number(req.params.id), req.body.body), 'Sent');
}

async function readMessages(req, res) {
  return ok(res, { updated: await chatService.markRead(req.user, Number(req.params.id)) }, 'Marked as read');
}

// ---------- Notifications ----------

async function notifications(req, res) {
  const filters = req.validated.query;
  const { notifications: rows, total } = await notificationService.list(req.user, filters);
  return ok(res, rows, 'OK', pageMeta({ page: filters.page, limit: filters.limit, total }));
}

async function unreadNotifications(req, res) {
  return ok(res, { unread: await notificationService.unreadCount(req.user) });
}

async function readNotification(req, res) {
  return ok(res, await notificationService.markRead(req.user, Number(req.params.id)), 'Marked as read');
}

async function readAllNotifications(req, res) {
  return ok(res, { updated: await notificationService.markAllRead(req.user) }, 'All marked as read');
}

// ---------- Reports ----------

async function report(req, res) {
  return created(res, await reportService.createReport(req.user, req.body), 'Thanks — our team will review this.');
}

module.exports = {
  conversations,
  unreadMessages,
  messages,
  sendMessage,
  readMessages,
  notifications,
  unreadNotifications,
  readNotification,
  readAllNotifications,
  report,
};
