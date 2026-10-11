# Lost & Found — Backend

REST API for the Lost & Found mobile app, plus the admin website.

**Stack:** Node.js · Express 5 · MySQL · Sequelize · JWT · Swagger · EJS + Bootstrap (admin)

## Requirements
- Node.js 20+
- MySQL 8+

## Deploy
Free hosting on Render (+ Aiven MySQL + Cloudinary photos): see **[DEPLOY.md](DEPLOY.md)**.

## Setup
```bash
npm install
cp .env.example .env        # then fill in DB_PASSWORD, secrets, ADMIN_* values
npm run db:migrate          # create tables
npm run db:seed             # categories + first admin user
npm run dev                 # start with auto-reload
```

| URL | What |
|---|---|
| http://localhost:5050/api/v1 | Mobile app API |
| http://localhost:5050/api-docs | Swagger API docs |
| http://localhost:5050/admin | Admin website |

> Port 5000 is used by macOS AirPlay Receiver, so this project uses **5050**.

## Scripts
| Command | Description |
|---|---|
| `npm run dev` | Start dev server (nodemon) |
| `npm start` | Start in production mode |
| `npm run db:migrate` | Run pending migrations |
| `npm run db:migrate:undo` | Undo last migration |
| `npm run db:seed` | Run seeders |
| `npm run db:reset` | Drop all tables, migrate and seed again (**deletes data**) |
| `npm run seed:demo` | Add 30 demo users (password `Demo1234`) + 24 demo items (dev only) |
| `npm run test:db` | Migrate the test database |
| `npm test` | Run tests |

## Project structure
```
src/
├── config/          env, database, logger, swagger
├── models/          Sequelize models
├── migrations/      database schema changes (never edit a migration that has run in production — add a new one)
├── seeders/         starting data
├── controllers/
│   ├── api/         JSON handlers for the mobile app
│   └── admin/       admin website pages
├── routes/
│   ├── api/         /api/v1/* (documented with @swagger comments)
│   └── admin/       /admin/*
├── services/        business logic shared by api + admin
├── middlewares/     auth, validation, CSRF, rate limits, errors
├── validators/      Joi schemas
├── views/admin/     EJS templates
├── public/          static files (/static)
└── socket/          Socket.io chat (Phase 5)
```

## API response format
```json
{ "success": true,  "message": "OK", "data": {} }
{ "success": false, "message": "Validation failed", "errors": [{ "field": "email", "message": "email is required" }] }
```

## Authentication (mobile app)
1. `POST /auth/register` or `POST /auth/login` → returns `accessToken` (15 min) + `refreshToken` (30 days).
2. Send `Authorization: Bearer <accessToken>` on protected endpoints.
3. On a `401`, call `POST /auth/refresh` with the refresh token. You get a **new** refresh token — store it and drop the old one.
   Re-using an old refresh token logs the user out everywhere (theft protection).
4. On logout, call `POST /auth/logout` with the refresh token and `PUT /me/fcm-token` with `null`.

In Swagger: run login, copy `accessToken`, click **Authorize**, paste it.

## Real-time (Socket.io)
Connect to the API host with the access token: `io(API_URL, { auth: { token } })`.
Server events: `message:new`, `message:read`, `typing`, `claim:updated`, `notification:new`.
Client events: `claim:join`, `claim:leave`, `typing`, `message:send` (ack), `message:read` (ack).
Details are in Swagger under **Chat**.

## Push notifications
Off until Firebase credentials are set (`FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON` in `.env`).
In-app notifications and live socket events work without them.

## Photos
Uploaded with multipart field `images` (max 5, JPG/PNG/WEBP, 8 MB each). Every photo is resized to max 1600px,
converted to WebP and stripped of metadata (phone photos contain GPS). Storage lives in
`src/services/storage.service.js` — `STORAGE_DRIVER=local` saves to `./uploads` and serves them at `/uploads/...`.

## Adding a new API
1. Model + migration (`npx sequelize-cli migration:generate --name create-xyz`)
2. Joi schema in `src/validators/`
3. Logic in `src/services/`, handler in `src/controllers/api/`
4. Route in `src/routes/api/` with a `@swagger` comment, then register it in `src/routes/api/index.js`
5. Test in `tests/`
