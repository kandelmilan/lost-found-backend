const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const expressLayouts = require('express-ejs-layouts');

const env = require('./config/env');
const logger = require('./config/logger');
const { setupSwagger } = require('./config/swagger');
const { sequelize } = require('./models');
const { apiLimiter } = require('./middlewares/rateLimiters');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

const app = express();

// Behind Nginx / a hosting proxy in production, so req.ip and secure cookies work.
if (env.isProduction) app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---------- Global middleware ----------
app.use(
  helmet({
    contentSecurityPolicy: false,
    // Send only our origin (never full URLs) to other sites. OpenStreetMap's tile servers
    // refuse map tiles from pages that send no Referer at all ("no-referrer").
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

if (!env.isTest) {
  app.use(
    morgan(env.isProduction ? 'combined' : 'dev', {
      stream: { write: (msg) => logger.http(msg.trim()) },
    }),
  );
}

app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: env.isProduction ? '7d' : 0 }));
// Uploaded photos (local storage driver). File names are random UUIDs, so they can be cached forever.
app.use(
  '/uploads',
  (req, res, next) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(env.storage.uploadDir, { maxAge: '365d', immutable: true, index: false, dotfiles: 'deny' }),
);

// ---------- API docs ----------
setupSwagger(app);

// ---------- Mobile app API (JSON) ----------
app.use(
  '/api',
  cors({ origin: env.corsOrigins.includes('*') ? '*' : env.corsOrigins }),
  apiLimiter,
);
app.use('/api/v1', require('./routes/api'));

// ---------- Admin website (EJS) ----------
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'admin/layouts/main');
const adminLabels = require('./utils/adminLabels');

app.locals.actionLabel = adminLabels.actionLabel;
app.locals.targetLink = adminLabels.targetLink;
app.locals.formatDate = (date) => (date ? new Date(date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');

const sessionStore = new SequelizeStore({
  db: sequelize,
  table: 'Session',
  expiration: 8 * 60 * 60 * 1000,
});

app.use(
  '/admin',
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
  session({
    name: 'lf.admin.sid',
    secret: env.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProduction,
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
  require('./routes/admin'),
);

app.get('/', (req, res) => {
  res.json({ success: true, message: 'Lost & Found API', data: { docs: '/api-docs', admin: '/admin' } });
});

// ---------- Errors ----------
app.use(notFound);
app.use(errorHandler);

module.exports = app;
