import express, { Router } from 'express';
import path from 'node:path';
import { config } from '../config.js';
import { LANGS, clientStrings, isLang, langPrefix } from '../i18n.js';
import { SESSION_COOKIE, loadSession } from '../auth.js';
import { allCategories, findProductByCode, galleryImages, getSettings, productImages, visibleProducts } from '../catalog.js';
import { e, galleryPage, homePage, makeContext, notFoundPage, productPage, sharePage, studioPage } from '../views.js';
import { recordEvent } from '../studio.js';
import { PHOTO_KEY, isNetlify, photoStore } from '../netlify-store.js';

/** Public address of the site: SITE_URL when set, otherwise the address the visitor used. */
function siteUrlOf(req) {
  if (config.siteUrl) return config.siteUrl;
  return `${req.protocol}://${req.get('host')}`;
}

const defaultLangOf = (settings) => (isLang(settings.default_language) ? settings.default_language : 'ku');

/** Works out the language from the URL prefix. Returns null after redirecting /<default>/... to the root. */
function resolveLang(req, res, prefixLang, settings) {
  const defaultLang = defaultLangOf(settings);
  if (!prefixLang) return defaultLang;
  if (prefixLang === defaultLang) {
    const rest = req.originalUrl.slice(prefixLang.length + 1) || '/';
    res.redirect(301, rest.startsWith('/') ? rest : `/${rest}`);
    return null;
  }
  return prefixLang;
}

const html = (res, page, status = 200) => res.status(status).type('html').set('Cache-Control', 'no-cache').send(page);

export function publicRouter({ db, enquiryLimiter }) {
  const router = Router();

  async function context(req, res, prefixLang, pagePath) {
    const settings = await getSettings(db);
    const lang = resolveLang(req, res, prefixLang, settings);
    if (!lang) return null;
    return makeContext({ lang, settings, siteUrl: siteUrlOf(req), path: pagePath });
  }

  for (const prefixLang of ['', ...LANGS]) {
    const p = prefixLang ? `/${prefixLang}` : '';

    router.get(p || '/', async (req, res, next) => {
      try {
        // Someone who chose another language before is sent back to it when they open the plain address.
        if (!prefixLang) {
          const settings = await getSettings(db);
          const chosen = req.cookies?.lang;
          if (isLang(chosen) && chosen !== defaultLangOf(settings)) return res.redirect(302, `/${chosen}/`);
        }
        const ctx = await context(req, res, prefixLang, '/');
        if (!ctx) return;
        const [products, categories, gallery] = await Promise.all([visibleProducts(db), allCategories(db), galleryImages(db)]);
        html(res, homePage(ctx, { products, categories, gallery }));
      } catch (error) {
        next(error);
      }
    });

    router.get(`${p}/products/:code`, async (req, res, next) => {
      try {
        const code = Number(req.params.code);
        const ctx = await context(req, res, prefixLang, `/products/${req.params.code}`);
        if (!ctx) return;
        const product = Number.isInteger(code) && code > 0 ? await findProductByCode(db, code) : null;
        let preview = false;
        if (product && !product.deleted_at && !product.visible && req.query.preview !== undefined) {
          // Hidden products can be previewed by a signed-in shop user only.
          preview = Boolean(await loadSession(db, req.cookies?.[SESSION_COOKIE]));
        }
        if (!product || product.deleted_at || (!product.visible && !preview)) return html(res, notFoundPage(ctx), 404);
        if (String(code) !== req.params.code) return res.redirect(301, `${ctx.prefix}/products/${code}`);
        ctx.path = `/products/${code}`;

        const [images, all, categories] = await Promise.all([productImages(db, product.id), visibleProducts(db), allCategories(db)]);
        const others = all.filter((x) => x.id !== product.id);
        const sameCategory = others.filter((x) => product.category_id && x.category_id === product.category_id);
        const related = [...sameCategory, ...others.filter((x) => !sameCategory.includes(x))].slice(0, 4);
        if (preview) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        html(res, productPage(ctx, { product, images, related, categories, preview }));
      } catch (error) {
        next(error);
      }
    });

    router.get(`${p}/studio`, async (req, res, next) => {
      try {
        const ctx = await context(req, res, prefixLang, '/studio');
        if (!ctx) return;
        if (!ctx.studioOn) return html(res, notFoundPage(ctx), 404);
        const [products, categories, quotes] = await Promise.all([
          visibleProducts(db),
          allCategories(db),
          db.all("SELECT product_id, COUNT(*) AS n FROM studio_events WHERE kind = 'quote' AND product_id IS NOT NULL GROUP BY product_id"),
        ]);
        // Popularity uses real counts only: WhatsApp enquiry clicks plus Studio quote requests.
        const quoteMap = new Map(quotes.map((q) => [q.product_id, q.n]));
        const popularity = new Map(products.map((p) => [p.id, (p.enquiry_count || 0) + (quoteMap.get(p.id) || 0)]));
        const preselect = Number.isInteger(Number(req.query.product)) ? Number(req.query.product) : null;
        await recordEvent(db, 'open');
        html(res, studioPage(ctx, { products, categories, popularity, preselect, strings: clientStrings(ctx.lang) }));
      } catch (error) {
        next(error);
      }
    });

    router.get(`${p}/gallery`, async (req, res, next) => {
      try {
        const ctx = await context(req, res, prefixLang, '/gallery');
        if (!ctx) return;
        const [gallery, products] = await Promise.all([galleryImages(db), visibleProducts(db)]);
        html(res, galleryPage(ctx, { gallery, products }));
      } catch (error) {
        next(error);
      }
    });
  }

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

  // Every page in every language, with hreflang links between the language versions.
  router.get('/sitemap.xml', async (req, res, next) => {
    try {
      const [settings, products] = await Promise.all([getSettings(db), visibleProducts(db)]);
      const base = siteUrlOf(req);
      const defaultLang = defaultLangOf(settings);
      const url = (lang, pagePath) => `${base}${langPrefix(lang, defaultLang)}${pagePath}`;
      const day = (ms) => new Date(ms || Date.now()).toISOString().slice(0, 10);
      const newest = products.reduce((max, p) => Math.max(max, p.updated_at || 0), 0);
      const pages = [
        ['/', newest],
        ['/gallery', newest],
        ...(settings.studio_enabled !== '0' ? [['/studio', newest]] : []),
        ...products.map((p) => [`/products/${p.code}`, p.updated_at]),
      ];
      const entries = pages.flatMap(([pagePath, updated]) =>
        LANGS.map(
          (lang) =>
            `<url><loc>${e(url(lang, pagePath))}</loc><lastmod>${day(updated)}</lastmod>${LANGS.map(
              (alt) => `<xhtml:link rel="alternate" hreflang="${alt}" href="${e(url(alt, pagePath))}"/>`,
            ).join('')}</url>`,
        ),
      );
      res
        .type('application/xml')
        .send(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`,
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

  // Placeholder for <img> fallbacks.
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

/** Shared design page, in the language the customer used when saving it. */
export async function renderSharePage(db, req, project, token) {
  const settings = await getSettings(db);
  const lang = project && isLang(project.lang) ? project.lang : defaultLangOf(settings);
  const ctx = makeContext({ lang, settings, siteUrl: siteUrlOf(req), path: '/studio' });
  const product = project?.data?.productId ? await db.get('SELECT * FROM products WHERE id = ?', [Number(project.data.productId)]) : null;
  return sharePage(ctx, { project, token, product });
}

/** Friendly 404 page in the language of the URL, for anything that is not a page, a file or the API. */
export function notFoundHandler({ db }) {
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    try {
      const settings = await getSettings(db);
      const first = req.path.split('/')[1];
      const lang = isLang(first) ? first : defaultLangOf(settings);
      const ctx = makeContext({ lang, settings, siteUrl: siteUrlOf(req), path: '/' });
      html(res, notFoundPage(ctx), 404);
    } catch (error) {
      next(error);
    }
  };
}

/** Static assets: site scripts/styles, and local uploads when running without Vercel Blob. */
export function staticRouter(uploadsRoot) {
  const router = Router();
  router.use('/css', express.static(path.join(config.publicDir, 'css'), { maxAge: '1h', index: false, dotfiles: 'deny' }));
  router.use('/js', express.static(path.join(config.publicDir, 'js'), { maxAge: '1h', index: false, dotfiles: 'deny' }));
  router.use('/admin', express.static(path.join(config.publicDir, 'admin'), { maxAge: '1h', index: false, dotfiles: 'deny' }));
  // Self-hosted 3D and AI runtime libraries and the floor-detection model: long cache, never change in place.
  router.use('/vendor', express.static(path.join(config.publicDir, 'vendor'), { maxAge: '30d', index: false, dotfiles: 'deny' }));
  router.use('/models', express.static(path.join(config.publicDir, 'models'), { maxAge: '30d', index: false, dotfiles: 'deny' }));
  router.use('/assets', express.static(path.join(config.publicDir, 'assets'), { maxAge: '1d', index: false, dotfiles: 'deny' }));
  router.use('/uploads', express.static(uploadsRoot, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
  return router;
}
