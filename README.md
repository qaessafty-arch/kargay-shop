# کارگەی شرێ — shop website and management

A full-stack site for the tile workshop:

- **Public site** (`/`): the original design, with products loaded from the database. Visitors can
  filter, open photos in a lightbox, and contact the shop on WhatsApp. Each WhatsApp tap is counted
  (no personal data).
- **Admin** (`/admin`): sign-in, dashboard, product catalogue (photos, prices, stock, visibility,
  featured, ordering), categories, orders with totals and status, shop settings, staff accounts, and an audit log.
  CSV export of products.

Stack: Node.js 22 (built-in `node:sqlite`), Express 5, SQLite (file in `data/`), Sharp for images,
zod for validation, bcrypt for passwords. The admin is plain JavaScript (no build step).

## Run it on your PC (Windows, macOS or Linux)

Requires **Node.js 22.13 or newer** (LTS).

```bash
npm install
npm run import-legacy        # imports the 37 products and photos from the original page (run once)
```

Create the owner account. The password is read from an environment variable so it stays out of shell history.

```bash
# macOS / Linux
ADMIN_PASSWORD='choose-a-long-password' npm run create-admin -- you@example.com "Your Name"
```

```powershell
# Windows PowerShell
$env:ADMIN_PASSWORD='choose-a-long-password'; npm run create-admin -- you@example.com "Your Name"
```

Start the server and open the site:

```bash
npm start                    # http://localhost:3000  ·  admin at http://localhost:3000/admin
npm test                     # runs the automated tests
```

## Deploy

1. Use a host with HTTPS (a reverse proxy such as Caddy or nginx, or a platform that terminates TLS).
2. Set the environment variables from `.env.example`. At minimum: `NODE_ENV=production`, `DATA_DIR` pointing
   at persistent storage, and `TRUST_PROXY=1` if a proxy is in front.
3. Run `npm ci --omit=dev`, then `npm start`, and create the owner account on the server.
4. Keep the `DATA_DIR` folder on persistent disk. It holds `shop.db` and `uploads/`.

**Backups:** copy the whole `DATA_DIR` folder regularly. With the server stopped, or using SQLite's
`.backup` command, copy `shop.db` safely; copy `uploads/` as-is.

## First run in the browser

You don't need a computer to set up a fresh deployment:

1. Set a `SETUP_TOKEN` environment variable on the host (any long random string). It is a one-time code.
2. Open `/admin`. While the shop has no account, it shows **Set up your shop**: enter the setup code, your email,
   name and a password (12+ characters). After that first owner exists, setup is permanently closed.
3. On the dashboard, the owner sees **Import original products**. It loads the 37 original products and their
   photos in small batches, so each request stays within the host's time limit.
4. You can delete `SETUP_TOKEN` afterwards.

## Deploy on Netlify

The repo also works on Netlify. `netlify.toml` serves `public/` as static files and sends every other
request to one function (`netlify/functions/server.mjs`) that runs the same Express app.

1. In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repo.
   The build settings come from `netlify.toml`.
2. Create a free **Neon** Postgres database (neon.tech) and add its connection string as the
   `DATABASE_URL` environment variable in **Site configuration → Environment variables**.
   Also set `NODE_ENV=production`.
3. Deploy. Photos are stored in **Netlify Blobs** automatically (no setup needed) and served from `/media/...`.
4. Run the one-time setup from your computer with the same `DATABASE_URL`:
   `npm run create-admin` (see above). To import the original products with photos on Netlify, run the import
   inside the site with `netlify dev` or upload the photos from the admin, because Netlify Blobs only
   accepts writes from the site itself.

Rate limits are kept in memory per function instance, so they are weaker on serverless hosts.
Netlify's own rate limiting rules can add a stronger limit on `/api/auth/login`.

## Security model

- Passwords: bcrypt (cost 12), minimum 12 characters. There is no default password anywhere in the code.
- Login: generic error messages; an account locks for 15 minutes after 5 failed attempts; the IP is rate-limited
  (10 attempts / 15 min); unknown accounts take the same time to reject as wrong passwords.
- Sessions: random tokens stored only as hashes; httpOnly, SameSite=Strict cookies, Secure in production;
  2-hour idle and 12-hour absolute expiry; new session on each login; all sessions end when a user is disabled
  or their password is reset.
- Writes need a CSRF token (`X-CSRF-Token` header) that matches the session.
- Roles: **owner** manages settings, users, deletes/restores products and categories, and reads the audit log.
  **staff** manages products, photos, categories and orders.
- Uploads: JPEG, PNG or WebP only, up to 6 MB each, up to 8 per request. Each file is decoded and re-encoded
  to WebP (this removes EXIF and location data). Files are stored under random names.
- Deleting a product hides it (soft delete); the owner can restore it.
- Content-Security-Policy, `X-Frame-Options`/`frame-ancestors` none, `nosniff`, no `X-Powered-By`.
  The admin page is `noindex` and disallowed in `robots.txt`.
- Text from the database is escaped when the page is built and when the admin screens are drawn, so it is never run as HTML.
- The project has no third-party API keys. Nothing secret is sent to the browser.

## Changing the design

The public page is `views/index.template.html`, with placeholders (`{{SHOP_NAME}}`, `{{PHONE_1}}`,
`{{WA_NUMBER}}`, …) that the server fills from **Settings**. All colours and layout are in
`public/css/site.css`; the colour variables at the top of that file change the whole look at once.
The admin colours are in `public/admin/admin.css`. The gallery scripts are in `public/js/`.

## Shop features

- **Gallery filters** use the product categories from the admin, so a new category appears as a filter by itself.
- **Featured** products are shown first. Products with stock set to 0 show "نەماوە" (out of stock).
- **Stock** goes down when an order is confirmed or delivered, and comes back if it is cancelled or reopened.
  Products with no stock number are not tracked.
- **Orders** can be searched by customer name, phone number or order number.
- **My account** lets every user change their own password; their other devices are signed out.
- **Link previews**: sharing the site on WhatsApp or social media shows the shop name, description and photo.
  Set `SITE_URL` (for example `https://kargay-shop.vercel.app`) if you use a custom domain.
- **Monitoring**: `GET /api/health` returns `{"ok":true}` when the site and database are working.
- `sitemap.xml` and `robots.txt` are generated for search engines; the admin is never indexed.

## What is not included (yet)

- Online checkout and payments. Orders are taken through WhatsApp or in person and recorded in the admin.
- The admin interface is in English. Translating it is a contained change in `public/admin/app.js`.
- Prices are shown in the currency set in Settings (default IQD). Products without a price show the WhatsApp button only.

## Files

| Path | Purpose |
| --- | --- |
| `src/server.js` | Starts the server |
| `src/app.js` | Express app, security headers, rate limits, error handling |
| `src/routes/` | Public, auth, and admin API routes |
| `src/db.js` | Schema and transactions |
| `src/auth.js` | Passwords, sessions, roles, CSRF |
| `src/uploads.js` | Image validation and WebP conversion |
| `src/render.js` | Builds the public page from the template and database |
| `views/index.template.html` | Public page (original design) |
| `public/admin/` | Admin interface |
| `scripts/create-admin.js` | Creates the owner account |
| `scripts/import-legacy.js` | Imports the original page's products (run once) |
| `scripts/legacy/` | Conversion script, manifest, and original photos for the import |
| `tests/api.test.js` | Automated tests for security and core flows |
