import express, { Router } from 'express';
import path from 'node:path';
import { config } from '../config.js';
import { renderHomePage } from '../render.js';
import { getSettings, visibleProducts } from '../catalog.js';
import { PHOTO_KEY, isNetlify, photoStore } from '../netlify-store.js';

export function publicRouter({ db, enquiryLimiter }) {
  const router = Router();

  // The public home page is rendered on the server from the database.
  router.get('/', async (req, res, next) => {
    try {
      const [products, settings] = await Promise.all([visibleProducts(db), getSettings(db)]);
      res.type('html').send(renderHomePage({ products, settings }));
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
    res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /api/\n');
  });

  // Browsers ask for this automatically; there is no separate icon file yet.
  router.get('/favicon.ico', (req, res) => res.status(204).end());

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
    res.sendFile(path.join(config.publicDir, 'admin', 'index.html'));
  });

  return router;
}

/** Static assets: site scripts/styles, and local uploads when running without Vercel Blob. */
export function staticRouter(uploadsRoot) {
  const router = Router();
  router.use('/js', express.static(path.join(config.publicDir, 'js'), { maxAge: '1h', index: false, dotfiles: 'deny' }));
  router.use('/admin', express.static(path.join(config.publicDir, 'admin'), { maxAge: '1h', index: false, dotfiles: 'deny' }));
  router.use('/assets', express.static(path.join(config.publicDir, 'assets'), { maxAge: '1d', index: false, dotfiles: 'deny' }));
  router.use('/uploads', express.static(uploadsRoot, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
  return router;
}
