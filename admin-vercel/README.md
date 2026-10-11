# Admin website on Vercel

Serves the Lost & Found admin panel at the Vercel domain by proxying to the backend on Render
(`https://lost-found-api-7dfm.onrender.com`). No code or secrets live here — the admin pages,
login sessions and database stay in the backend; Vercel only forwards requests.

- `/` → redirects to `/admin`
- `/admin/*`, `/static/*`, `/uploads/*` → forwarded to Render
- Admin pages are never cached (`Cache-Control: private, no-store`)

Live: https://lost-found-admin-six.vercel.app (Vercel project `lost-found-admin`).

If the Render URL changes, update the four `destination` values in `vercel.json` and redeploy.
Free Render instances sleep after 15 idle minutes: the first visit can be slow — refresh once if it times out.
