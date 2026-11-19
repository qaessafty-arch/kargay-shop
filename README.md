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

The public pages are rendered on the server in `src/views.js`, in Kurdish, Arabic or English.
Interface text for all three languages is in `src/i18n.js`. All colours, spacing and layout are in
`public/css/site.css`; the variables at the top of that file change the whole look at once.
The admin uses `public/admin/admin.css` with the same palette.

## Pages and languages

| Address | Page |
| --- | --- |
| `/`, `/ar/`, `/en/` | Home page in the default language, Arabic, English (the default language is set in Settings) |
| `/products/7`, `/ar/products/7`, `/en/products/7` | One page per product |
| `/gallery` (and `/ar/gallery`, `/en/gallery`) | Workshop photos and all product photos |

Every page has its own title, description, canonical link, hreflang links, Open Graph and X (Twitter)
preview tags and structured data (LocalBusiness, Product, BreadcrumbList), so Google and WhatsApp, Facebook
or Telegram previews show the right language without running JavaScript. A visitor who picks a language is
taken back to it next time. Old shared links like `/#tile-05` open the product page.

## Managing the site (admin)

- **Products**: number (suggested automatically), names and descriptions in three languages, category, size,
  price, stock, visibility, featured, several photos (the first is the main photo), preview of hidden products.
- **Availability** shown to visitors: *Out of stock* when stock is 0, *Contact for price* when there is no
  price, otherwise *Available*. Prices are never invented: a product without a price shows no price.
- **Categories** in three languages; they become the filter buttons in the showroom.
- **Gallery**: workshop photos with captions in three languages, reorder, featured photo for the About section.
- **Settings**: factory name, logo and main photo, WhatsApp number, phones, address, Google Maps link and
  optional coordinates (an embedded map appears only when coordinates are set), Facebook / Instagram / TikTok
  (hidden when empty), page titles and descriptions per language, default language.
- **Orders, users, audit log and My account** as before. Stock goes down when an order is confirmed or
  delivered and comes back if it is cancelled.

## AI Studio

Customers design their own courtyard at `/studio` (`/ar/studio`, `/en/studio`):

1. **Photo**: upload photos (or take one with the phone camera, or pick a frame from a video).
2. **Floor selection (AI)**: [SlimSAM-77](https://huggingface.co/nielsr/slimsam-77-uniform), a compact
   *Segment Anything* model (**Apache-2.0**, commercial use allowed), runs **in the customer's browser** with
   ONNX Runtime Web (files in `public/models` and `public/vendor`, about 14 MB, cached by the browser after the
   first use). It selects the floor from points across the lower part of the photo and finds its exact edges; the
   customer taps to add a missed area or to remove a plant, piece of furniture or wall. Photos are not uploaded for
   this, and no AI service, account or API key is needed. It does not name what it sees (walls, plants…); it finds
   the boundaries of the surface the customer points at.
   Models considered and not used: SegFormer (NVIDIA licence: non-commercial only) and a DETR panoptic export
   (too inaccurate in tests on the shop's photos).
3. **Correction**: tap to add/remove (AI), Add/Remove brush, undo/redo, back to the AI result, and four perspective corners placed on a
   real rectangle of the floor.
4. **Products**: suggestions ranked from colours and brightness measured in the photo and the floor size, with the
   reasons shown; "popular" uses only real enquiry and quote counts; or any product.
5. **Tile application**: the product's real texture is laid in perspective at its real size, with grout width and
   colour, straight or offset pattern, rotation, direction, shift and scale correction; the photo's light and
   shadows are kept, and tiles only appear inside the selected area.
6. **3D**: an exact *3D floor model* from the entered size, and an *estimated photo in 3D* reconstructed from one
   photo and the marked rectangle. The second is labelled as an approximation and is refused when the corners do
   not describe a believable camera. Multi-photo, video or LiDAR reconstruction is **not** implemented.
7. **Measurements**: length/width of the marked rectangle, total floor area, extra sections, cutting allowance;
   tiles per m² and total to order from the real tile size including grout; an approximate area measured in the
   photo. Labelled as entered by the customer / estimated from the photo / verified by the factory.
8. **Designs**: keep several designs and compare them with a before/after slider or side by side.
9. **Save, share, send**: saving needs explicit consent. Photos are stored privately in the database with their
   metadata (including GPS) removed; the customer gets an owner key (only its hash is stored), a share link that is
   signed and expires after 30 days, can delete the project, and can report a problem. Projects are deleted
   automatically after the retention period. "Send my design" opens WhatsApp with the product, size, area,
   quantity, project reference (KS-0001) and the share link.

**Textures**: a product appears in the Studio only when it has a texture (one straight-on photo of a single tile,
cropped to its edges) and *Customers can preview* is ticked. In the admin, open a product and use **AI Studio
texture**: upload one, or crop it from one of the product's photos. Six textures (#3, #9, #11, #12, #19, #22) were
cropped from the original photos and are attached when the original products are imported; check them.

The admin **AI Studio** tab has the settings (on/off, retention days, photo size limit, cutting allowance), usage
numbers, customer projects with their photos, "measurements verified" and problem reports.

## Monitoring

`GET /api/health` returns `{"ok":true}` when the site and database are working. Set `SITE_URL`
(for example `https://kargay-shop.vercel.app`) if you use a custom domain, so shared links use it.

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
| `src/views.js` | Public pages (home, product, gallery, 404) |
| `src/i18n.js`, `src/i18n-studio.js` | Kurdish, Arabic and English interface text |
| `src/studio.js`, `src/routes/studio.js` | AI Studio projects, privacy, share links |
| `public/js/studio*.js` | AI Studio in the browser (detection worker, renderer, 3D) |
| `public/admin/` | Admin interface |
| `scripts/create-admin.js` | Creates the owner account |
| `scripts/import-legacy.js` | Imports the original page's products (run once) |
| `scripts/legacy/` | Conversion script, manifest, and original photos for the import |
| `tests/api.test.js` | Automated tests for security and core flows |
