import express, { Router } from 'express';
import path from 'node:path';
import { config } from '../config.js';
import { escapeHtml, renderHomePage } from '../render.js';
import { getSettings, visibleProducts } from '../catalog.js';
import { PHOTO_KEY, isNetlify, photoStore } from '../netlify-store.js';

/** Public address of the site: SITE_URL when set, otherwise the address the visitor used. */
function siteUrlOf(req) {
  if (config.siteUrl) return config.siteUrl;
  return `${req.protocol}://${req.get('host')}`;
}

export function publicRouter({ db, enquiryLimiter }) {
  const router = Router();

  // The public home page is rendered on the server from the database.
  router.get('/', async (req, res, next) => {
    try {
      const [products, settings] = await Promise.all([visibleProducts(db), getSettings(db)]);
      res.type('html').send(renderHomePage({ products, settings, siteUrl: siteUrlOf(req) }));
    } catch (error) {
      next(error);
    }
  });

  // Anonymous, counted only: the WhatsApp button increments a number, no personal data is taken.
  router.post('/api/public/products/:code/enquiry', enquiryLimiter, async (req, res, next) => {
    try {
      const code = Number(req.params.code);
      if (!Number.isInteger(code) || code < 1) return res.status(404).end();
      await db.run('UPDATE products SET enquiry_count = enquiry_count + 1 WHERE code = ? AND deleted_at IS NULL AND visible = 1', [code]);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${siteUrlOf(req)}/sitemap.xml\n`);
  });

  router.get('/sitemap.xml', async (req, res, next) => {
    try {
      const row = await db.get('SELECT MAX(updated_at) AS t FROM products WHERE deleted_at IS NULL AND visible = 1');
      const lastmod = new Date(row?.t || Date.now()).toISOString().slice(0, 10);
      res.type('application/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
          `<url><loc>${escapeHtml(siteUrlOf(req))}/</loc><lastmod>${lastmod}</lastmod></url></urlset>\n`,
      );
    } catch (error) {
      next(error);
    }
  });

  // The shop logo doubles as the browser tab icon.
  router.get('/favicon.ico', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(config.publicDir, 'assets', 'brand-logo.jpg'));
  });

  // For uptime monitors: confirms the app and the database both answer.
  router.get('/api/health', async (req, res) => {
    try {
      await db.get('SELECT 1 AS ok');
      res.set('Cache-Control', 'no-store').json({ ok: true });
    } catch {
      res.status(503).set('Cache-Control', 'no-store').json({ ok: false });
    }
  });

  // Placeholder for <img> fallbacks in the template.
  router.get('/img/blank.gif', (req, res) => {
    res.type('gif').send(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  });

  // Photos stored in Netlify Blobs are served from the site itself, so the page's image rules stay strict.
  router.get(/^\/media\/(.+)$/, async (req, res, next) => {
    try {
      const key = req.params[0];
      if (!isNetlify() || !PHOTO_KEY.test(key)) return res.status(404).end();
      const bytes = await photoStore().get(key, { type: 'arrayBuffer' });
      if (!bytes) return res.status(404).end();
      res.set('Content-Type', 'image/webp');
      res.set('Cache-Control', 'public, max-age=2592000, immutable');
      res.send(Buffer.from(bytes));
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin', (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    // Served by the app (not as a static file) so the page always gets the security headers.
    res.sendFile(path.join(config.root, 'views', 'admin.html'));
  });

  return router;
}

/** Static assets: site scripts/styles, and local uploads when running without Vercel Blob. */
export function staticRouter(uploadsRoot) {
  const router = Router();
  router.use('/css', express.static(path.join(config.publicDir, 'css'), { maxAge: '1h', index: false, dotfiles: 'deny' }));
  router.use('/js', express.static(path.join(config.publicDir, 'js'), { maxAge: '1h', index: false, dotfiles: 'deny' }));
  router.use('/admin', express.static(path.join(config.publicDir, 'admin'), { maxAge: '1h', index: false, dotfiles: 'deny' }));
  router.use('/assets', express.static(path.join(config.publicDir, 'assets'), { maxAge: '1d', index: false, dotfiles: 'deny' }));
  router.use('/uploads', express.static(uploadsRoot, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
  return router;
}
