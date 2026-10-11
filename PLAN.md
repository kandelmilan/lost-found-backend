# Lost & Found — Project Plan

Users post lost or found items → the app suggests matches → the owner proves ownership with a secret
question → both chat in-app → they meet and mark the item as returned. Admins moderate through a web panel.

## Stack
| Layer | Tech |
|---|---|
| Mobile app | Flutter (Dart) + GetX |
| Backend | Node.js + Express 5 |
| Database | MySQL + Sequelize (migrations) |
| Auth | JWT access + refresh tokens (app), sessions + CSRF (admin) |
| Chat | Socket.io |
| Images | Multer → Cloudinary |
| Push | Firebase Cloud Messaging |
| Docs | Swagger (OpenAPI 3) |
| Admin website | EJS + Bootstrap 5 (served by the same Express app) |
| Tests | Jest + Supertest |

## Progress

### ✅ Phase 0 — Setup
- [x] Node.js, MySQL installed; MySQL running as a service
- [x] Databases `lost_found` + `lost_found_test`, dedicated DB user
- [x] Backend project + Git

### ✅ Phase 1 — Backend foundation + admin shell
- [x] Folder structure, `.env` config, logger, error handling
- [x] Security: Helmet, CORS, rate limiting, CSP on admin
- [x] Migrations: users, refresh_tokens, categories, admin_logs, sessions
- [x] Seeders: 10 categories + first admin
- [x] Swagger at `/api-docs`
- [x] APIs: `GET /health`, `GET /categories`
- [x] Admin: login (CSRF, rate-limited, session in MySQL), logout, dashboard, activity log
- [x] Tests (8 passing)

### ✅ Phase 2 — Auth API + admin Users page
- [x] Register (email or phone), login, refresh (rotation + reuse detection), logout, logout-all
- [x] Profile: get / update, change password (signs out other devices), FCM token, delete account
- [x] Joi validation, rate limits on auth endpoints, timing-safe login
- [x] Admin: users list (search, status filter, pagination), detail, block (with reason) / unblock, history
- [x] `npm run seed:demo` for 30 demo users
- [x] Tests (34 passing)
- [ ] Later: OTP verification of phone / email (needs an SMS provider)

### ✅ Phase 3 — Items + admin Items & Categories
- [x] Tables: items, item_images
- [x] Post item with up to 5 photos (resized, converted to WebP, GPS/EXIF stripped)
- [x] Feed: filters (type, category, search, dates), nearby search with distance, pagination
- [x] Privacy: approximate location + rounded distance for non-owners, secret answer hashed
- [x] Edit, add/remove photos, close, delete, my items, matching with score
- [x] Blocked users' items hidden; account deletion removes photo files
- [x] Admin: items list/filters/detail, hide (reason shown to owner) / unhide / delete, categories CRUD, dashboard counts
- [x] Demo items in `npm run seed:demo`
- [x] Tests (65 passing)
- [ ] Before launch: switch photo storage to Cloudinary (`STORAGE_DRIVER=cloudinary`)

### ✅ Admin UI redesign
- [x] CRM-style layout: navy sidebar with signed-in admin, collapsible menu, top bar with Post Item + user menu
- [x] Tables: search, rows per page, filters dropdown, sortable columns, CSV export, print, status pills
- [x] Admin "Post Item" form with map location picker, photo previews, secret question for found items
- [x] Tests (74 passing)

### ✅ Phase 4 — Claims & handover + admin Claims
- [x] Table: claims (one claim = request + handover; replaces the planned separate `exchanges` table)
- [x] "This is mine" on found items (secret answer checked automatically, 3 attempts per item)
- [x] "I found this" on lost items (message required)
- [x] Poster accepts (item → claimed, other pending claims auto-rejected) or rejects with a reason
- [x] Meeting place / time / notes; both confirm → completed, item → returned, finder's returned count +1
- [x] Withdraw / cancel (accepted handover cancelled → item back in the feed)
- [x] Row locking so two claims can't be accepted at once
- [x] Closing an item rejects pending claims; blocking / deleting a user releases their claims
- [x] Item detail shows `my_claim`, `claim_attempts_left` (others) or `pending_claims` (poster)
- [x] Admin: claims list (filters, sort, CSV), detail with progress timeline, cancel with reason; claims on item page; dashboard counts
- [x] Demo claims in `npm run seed:demo`
- [x] Tests (97 passing)

### ✅ Phase 5 — Chat, notifications, reports
- [x] Tables: messages, notifications, reports (each claim is one conversation — no separate chats table)
- [x] Chat: REST + Socket.io (JWT), typing, read receipts, conversation list with unread counts, paging
- [x] Chat open while a claim is pending/accepted, read-only afterwards; admins cannot read chats
- [x] Notifications at every claim step + when an admin hides a post: saved, live over socket, push via FCM
- [x] Push is optional (`FIREBASE_SERVICE_ACCOUNT_PATH`); dead device tokens are cleaned up; chat pushes only when offline
- [x] Reports: post or person, one open report per target per user, rate limited
- [x] Admin: Reports (resolve with hide / block, dismiss, related reports close together), Activity Logs (search, filters, CSV), Settings (change password, signs out other sessions)
- [x] Blocking / deleting a user disconnects their sockets
- [x] Tests (118 passing)
- [ ] Before launch: add Firebase credentials for real push notifications

### ⬜ Phase 6 — Flutter app
- [ ] Project structure, Dio client with token refresh, secure storage
- [ ] All screens connected to the API, maps, image picker

### ⬜ Phase 7 — Testing & polish
### ⬜ Phase 8 — Deployment (server, managed MySQL, domain, HTTPS, backups)
### ⬜ Phase 9 — Play Store + App Store release




admin@lostfound.local
