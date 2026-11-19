import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { hashPassword, requireAuth, requireCsrf, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { allCategories, availability, findProduct, findProductByCode, galleryImages, getSettings, listProducts, renumberImages } from '../catalog.js';
import path from 'node:path';
import { removeUpload, storeImage, storeProductImage, uploadsRoot } from '../uploads.js';
import { importLegacyBatch, loadManifest } from '../legacy-import.js';
import { projectRef, projectWithViews, purgeExpiredProjects } from '../studio.js';
import { sendViewImage } from './studio.js';
import {
  categoryPatchSchema,
  categorySchema,
  galleryPatchSchema,
  idParam,
  newUserSchema,
  orderSchema,
  orderStatusSchema,
  parse,
  passwordResetSchema,
  productPatchSchema,
  productSchema,
  settingsSchema,
  userPatchSchema,
} from '../validation.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: config.maxUploadFiles },
  fileFilter: (req, file, cb) => {
    // The MIME type is only a first filter; uploads are decoded with sharp before being stored.
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
  },
});

const idOf = (value) => idParam.safeParse(value);

/** Maps a database row to the JSON shape the admin page uses. */
function productJson(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    description: row.description,
    descriptionAr: row.description_ar,
    descriptionEn: row.description_en,
    availability: availability(row),
    textureUrl: row.texture_url || '',
    textureThumb: row.texture_thumb || '',
    vizEnabled: !!row.viz_enabled,
    groutMm: row.grout_mm,
    groutColor: row.grout_color,
    categoryId: row.category_id,
    categoryName: row.category_name,
    widthCm: row.width_cm,
    heightCm: row.height_cm,
    price: row.price,
    stock: row.stock,
    visible: !!row.visible,
    featured: !!row.featured,
    sort: row.sort,
    enquiryCount: row.enquiry_count,
    imageCount: row.image_count,
    mainImage: row.main_thumb || row.main_file || null,
    deleted: !!row.deleted_at,
    updatedAt: row.updated_at,
  };
}

async function imagesFor(db, productId) {
  const rows = await db.all('SELECT id, file, thumb, kind, sort FROM product_images WHERE product_id = ? ORDER BY sort, id', [productId]);
  return rows.map((img) => ({ id: img.id, file: img.file, thumb: img.thumb, kind: img.kind, sort: img.sort }));
}

/** Start of the current month in the shop's time zone, as epoch milliseconds. */
export function monthStartMs(now, utcOffsetMinutes) {
  const local = new Date(now.getTime() + utcOffsetMinutes * 60000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - utcOffsetMinutes * 60000;
}

async function saveSetting(db, key, value) {
  await db.run(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, value, Date.now()],
  );
}

export function adminRouter({ db, writeLimiter }) {
  const router = Router();
  const owner = requireRole('owner');
  const any = requireRole('owner', 'staff');

  router.use(requireAuth(db));
  // Every write below also needs the CSRF header.
  const write = [writeLimiter, requireCsrf()];

  // ---------- Dashboard ----------
  router.get('/stats', any, async (req, res) => {
    const count = async (sql, params = []) => (await db.get(sql, params)).n;
    const since = monthStartMs(new Date(), config.shopUtcOffsetMinutes);
    const live = 'deleted_at IS NULL';
    const [products, visible, available, outOfStock, categories, featured, lowStock, pendingOrders, deliveredThisMonth, revenue, enquiries, recent] =
      await Promise.all([
        count(`SELECT COUNT(*) AS n FROM products WHERE ${live}`),
        count(`SELECT COUNT(*) AS n FROM products WHERE ${live} AND visible = 1`),
        count(`SELECT COUNT(*) AS n FROM products WHERE ${live} AND visible = 1 AND (stock IS NULL OR stock > 0)`),
        count(`SELECT COUNT(*) AS n FROM products WHERE ${live} AND stock = 0`),
        count('SELECT COUNT(*) AS n FROM categories'),
        count(`SELECT COUNT(*) AS n FROM products WHERE ${live} AND featured = 1`),
        count(`SELECT COUNT(*) AS n FROM products WHERE ${live} AND stock IS NOT NULL AND stock > 0 AND stock <= 3`),
        count("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'"),
        count("SELECT COUNT(*) AS n FROM orders WHERE status = 'delivered' AND updated_at >= ?", [since]),
        db.get("SELECT COALESCE(SUM(total), 0)::bigint AS total FROM orders WHERE status = 'delivered' AND updated_at >= ?", [since]),
        db.get('SELECT COALESCE(SUM(enquiry_count), 0)::bigint AS total FROM products'),
        listProducts(db, { status: 'all', limit: 5, order: 'newest' }),
      ]);
    // Recent activity comes from the audit log, which only the owner may read.
    const activity =
      req.auth.user.role === 'owner'
        ? await db.all(
            `SELECT a.action, a.entity, a.entity_id, a.at, u.display_name AS user_name
               FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
              WHERE a.action NOT IN ('login', 'login.failed')
              ORDER BY a.at DESC, a.id DESC LIMIT 8`,
          )
        : [];
    res.json({
      products, visible, available, outOfStock, categories, featured, lowStock, pendingOrders, deliveredThisMonth,
      revenueThisMonth: revenue.total,
      enquiriesTotal: enquiries.total,
      recentProducts: recent.items.map(productJson),
      activity: activity.map((a) => ({ action: a.action, entity: a.entity, entityId: a.entity_id, at: a.at, user: a.user_name })),
    });
  });

  // ---------- Products ----------
  router.get('/products', any, async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const status = ['all', 'visible', 'hidden', 'low-stock', 'deleted'].includes(req.query.status) ? req.query.status : 'all';
    const categoryId = idOf(req.query.category).success ? Number(req.query.category) : null;
    const q = String(req.query.q || '').slice(0, 100);
    const result = await listProducts(db, { q, categoryId, status, page });
    res.json({ ...result, items: result.items.map(productJson) });
  });

  router.get('/products.csv', any, async (req, res) => {
    const { items } = await listProducts(db, { status: 'all', limit: 100000 });
    // Cells starting with = + - @ are prefixed so spreadsheets never run them as formulas.
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const header = ['code', 'name_ku', 'name_ar', 'name_en', 'category', 'width_cm', 'height_cm', 'price', 'stock', 'availability', 'visible', 'enquiries'];
    const lines = items.map((p) =>
      [p.code, p.name, p.name_ar, p.name_en, p.category_name, p.width_cm, p.height_cm, p.price, p.stock, availability(p), p.visible ? 'yes' : 'no', p.enquiry_count]
        .map(cell)
        .join(','),
    );
    res.type('text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    res.send('﻿' + [header.join(','), ...lines].join('\n'));
  });

  // Suggests the next free product number for the "new product" form.
  router.get('/products/next-code', any, async (req, res) => {
    res.json({ code: (await db.get('SELECT COALESCE(MAX(code), 0) + 1 AS next FROM products')).next });
  });

  router.get('/products/:id', any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const row = await findProduct(db, id.data);
    if (!row) return res.status(404).json({ error: 'Product not found.' });
    res.json({ ...productJson(row), images: await imagesFor(db, row.id) });
  });

  router.post('/products', ...write, any, async (req, res) => {
    const parsed = parse(productSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;
    const now = Date.now();

    const result = await db.transaction(async (tx) => {
      const code = d.code ?? (await tx.get('SELECT COALESCE(MAX(code), 0) + 1 AS next FROM products')).next;
      if (await findProductByCode(tx, code)) return { error: 'That product code is already used.' };
      const info = await tx.run(
        `INSERT INTO products (code, name, name_ar, name_en, description, description_ar, description_en, category_id,
           width_cm, height_cm, price, stock, visible, featured, sort, viz_enabled, grout_mm, grout_color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          code,
          d.name,
          d.nameAr,
          d.nameEn,
          d.description,
          d.descriptionAr,
          d.descriptionEn,
          d.categoryId ?? null,
          d.widthCm ?? null,
          d.heightCm ?? null,
          d.price ?? null,
          d.stock ?? null,
          d.visible ? 1 : 0,
          d.featured ? 1 : 0,
          d.sort ?? code,
          d.vizEnabled ? 1 : 0,
          d.groutMm,
          d.groutColor,
          now,
          now,
        ],
      );
      await audit(tx, { userId: req.auth.user.id, action: 'product.create', entity: 'product', entityId: info.id, detail: { code, name: d.name } });
      return { id: info.id };
    });
    if (result.error) return res.status(409).json({ error: result.error });
    res.status(201).json(result);
  });

  router.patch('/products/:id', ...write, any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const parsed = parse(productPatchSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const existing = await findProduct(db, id.data);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'Product not found.' });

    const d = parsed.data;
    const map = {
      code: 'code', name: 'name', nameAr: 'name_ar', nameEn: 'name_en', description: 'description',
      descriptionAr: 'description_ar', descriptionEn: 'description_en', categoryId: 'category_id', widthCm: 'width_cm',
      heightCm: 'height_cm', price: 'price', stock: 'stock', visible: 'visible', featured: 'featured', sort: 'sort',
      vizEnabled: 'viz_enabled', groutMm: 'grout_mm', groutColor: 'grout_color',
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (d[key] === undefined) continue;
      let value = d[key];
      if (typeof value === 'boolean') value = value ? 1 : 0;
      sets.push(`${column} = ?`);
      values.push(value ?? null);
    }
    if (!sets.length) return res.json({ ok: true });

    const conflict = await db.transaction(async (tx) => {
      if (d.code !== undefined && d.code !== existing.code && (await findProductByCode(tx, d.code))) {
        return 'That product code is already used.';
      }
      await tx.run(`UPDATE products SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...values, Date.now(), id.data]);
      await audit(tx, { userId: req.auth.user.id, action: 'product.update', entity: 'product', entityId: id.data, detail: { fields: Object.keys(d) } });
      return null;
    });
    if (conflict) return res.status(409).json({ error: conflict });
    res.json({ ok: true });
  });

  // Deleting only hides a product (soft delete). Only the owner can do it, and it can be restored.
  router.delete('/products/:id', ...write, owner, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const now = Date.now();
    const info = await db.run('UPDATE products SET deleted_at = ?, visible = 0, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id.data]);
    if (!info.changes) return res.status(404).json({ error: 'Product not found.' });
    await audit(db, { userId: req.auth.user.id, action: 'product.delete', entity: 'product', entityId: id.data });
    res.json({ ok: true });
  });

  router.post('/products/:id/restore', ...write, owner, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const info = await db.run('UPDATE products SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL', [Date.now(), id.data]);
    if (!info.changes) return res.status(404).json({ error: 'Deleted product not found.' });
    await audit(db, { userId: req.auth.user.id, action: 'product.restore', entity: 'product', entityId: id.data });
    res.json({ ok: true });
  });

  // ---------- Product images ----------
  router.post('/products/:id/images', ...write, any, upload.array('files', config.maxUploadFiles), async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const product = await findProduct(db, id.data);
    if (!product || product.deleted_at) return res.status(404).json({ error: 'Product not found.' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Choose at least one JPEG, PNG or WebP image (up to 6 MB each).' });

    const stored = [];
    try {
      for (const file of files) {
        stored.push(await storeProductImage(file.buffer, product.code));
      }
    } catch (error) {
      // Remove whatever was stored before the failure so no orphan files stay behind.
      for (const s of stored) {
        await removeUpload(s.file);
        await removeUpload(s.thumb);
      }
      const message = error.message || 'One of the images could not be read.';
      return res.status(error.status || 400).json({ error: message });
    }

    await db.transaction(async (tx) => {
      const next = (await tx.get('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM product_images WHERE product_id = ?', [id.data])).next;
      for (const [i, s] of stored.entries()) {
        await tx.run('INSERT INTO product_images (product_id, file, thumb, kind, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
          id.data, s.file, s.thumb, 'extra', next + i, Date.now(),
        ]);
      }
      await renumberImages(tx, id.data);
      await audit(tx, { userId: req.auth.user.id, action: 'product.images.add', entity: 'product', entityId: id.data, detail: { count: stored.length } });
    });
    res.status(201).json({ images: await imagesFor(db, id.data) });
  });

  // Reorder: the first id becomes the main photo.
  router.put('/products/:id/images/order', ...write, any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
    if (!ids || ids.length > 100 || ids.some((n) => !Number.isInteger(n))) return res.status(400).json({ error: 'Invalid order.' });
    const owned = new Set((await imagesFor(db, id.data)).map((img) => img.id));
    if (ids.length !== owned.size || ids.some((n) => !owned.has(n))) {
      return res.status(400).json({ error: 'Order does not match the product images.' });
    }
    await db.transaction(async (tx) => {
      for (const [index, imageId] of ids.entries()) {
        await tx.run('UPDATE product_images SET sort = ? WHERE id = ?', [index, imageId]);
      }
      await renumberImages(tx, id.data);
    });
    res.json({ images: await imagesFor(db, id.data) });
  });

  router.delete('/images/:imageId', ...write, any, async (req, res) => {
    const imageId = idOf(req.params.imageId);
    if (!imageId.success) return res.status(400).json({ error: 'Invalid id.' });
    const row = await db.get('SELECT id, product_id, file, thumb FROM product_images WHERE id = ?', [imageId.data]);
    if (!row) return res.status(404).json({ error: 'Image not found.' });
    await db.run('DELETE FROM product_images WHERE id = ?', [row.id]);
    await renumberImages(db, row.product_id);
    await removeUpload(row.file);
    await removeUpload(row.thumb);
    await audit(db, { userId: req.auth.user.id, action: 'product.image.delete', entity: 'product', entityId: row.product_id });
    res.json({ images: await imagesFor(db, row.product_id) });
  });

  // ---------- Visualization texture (AI Studio) ----------
  // One flat, straight-on photo of a single tile face, cropped to its edges. Used as the real tile surface in the Studio.
  router.post('/products/:id/texture', ...write, any, upload.single('file'), async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const product = await findProduct(db, id.data);
    if (!product || product.deleted_at) return res.status(404).json({ error: 'Product not found.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a JPEG, PNG or WebP image (up to 6 MB).' });
    let stored;
    try {
      stored = await storeImage(req.file.buffer, `products/${product.code}`);
    } catch (error) {
      return res.status(400).json({ error: error.message || 'The image could not be read.' });
    }
    await db.run('UPDATE products SET texture_url = ?, texture_thumb = ?, updated_at = ? WHERE id = ?', [stored.file, stored.thumb, Date.now(), id.data]);
    await removeUpload(product.texture_url);
    await removeUpload(product.texture_thumb);
    await audit(db, { userId: req.auth.user.id, action: 'product.texture', entity: 'product', entityId: id.data });
    res.json(productJson(await findProduct(db, id.data)));
  });

  // A product photo served from this site, so the crop tool can read its pixels (photos may live on another domain).
  router.get('/images/:imageId/raw', any, async (req, res) => {
    const imageId = idOf(req.params.imageId);
    if (!imageId.success) return res.status(400).end();
    const row = await db.get('SELECT file FROM product_images WHERE id = ?', [imageId.data]);
    if (!row) return res.status(404).end();
    if (row.file.startsWith('/uploads/')) {
      const file = path.resolve(uploadsRoot, row.file.slice('/uploads/'.length));
      return file.startsWith(uploadsRoot + path.sep) ? res.sendFile(file) : res.status(404).end();
    }
    if (row.file.startsWith('/')) return res.redirect(302, row.file);
    if (!/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//.test(row.file)) return res.status(404).end();
    const upstream = await fetch(row.file);
    if (!upstream.ok) return res.status(502).end();
    res.set({ 'Content-Type': upstream.headers.get('content-type') || 'image/webp', 'Cache-Control': 'private, max-age=600' });
    res.send(Buffer.from(await upstream.arrayBuffer()));
  });

  router.delete('/products/:id/texture', ...write, any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const product = await findProduct(db, id.data);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    await db.run("UPDATE products SET texture_url = '', texture_thumb = '', viz_enabled = 0, updated_at = ? WHERE id = ?", [Date.now(), id.data]);
    await removeUpload(product.texture_url);
    await removeUpload(product.texture_thumb);
    await audit(db, { userId: req.auth.user.id, action: 'product.texture.remove', entity: 'product', entityId: id.data });
    res.json(productJson(await findProduct(db, id.data)));
  });

  // ---------- Categories ----------
  router.get('/categories', any, async (req, res) => {
    const rows = await allCategories(db);
    const counts = await db.all('SELECT category_id, COUNT(*) AS n FROM products WHERE deleted_at IS NULL GROUP BY category_id');
    const byId = new Map(counts.map((r) => [r.category_id, r.n]));
    res.json({ items: rows.map((c) => ({ id: c.id, name: c.name, nameAr: c.name_ar, nameEn: c.name_en, sort: c.sort, products: byId.get(c.id) || 0 })) });
  });

  router.post('/categories', ...write, any, async (req, res) => {
    const parsed = parse(categorySchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;
    if (await db.get('SELECT id FROM categories WHERE name = ?', [d.name])) {
      return res.status(409).json({ error: 'A category with that name already exists.' });
    }
    const info = await db.run('INSERT INTO categories (name, name_ar, name_en, sort) VALUES (?, ?, ?, ?) RETURNING id', [d.name, d.nameAr, d.nameEn, d.sort]);
    await audit(db, { userId: req.auth.user.id, action: 'category.create', entity: 'category', entityId: info.id });
    res.status(201).json({ id: info.id });
  });

  router.patch('/categories/:id', ...write, any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const parsed = parse(categoryPatchSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;
    if (d.name !== undefined && (await db.get('SELECT id FROM categories WHERE name = ? AND id <> ?', [d.name, id.data]))) {
      return res.status(409).json({ error: 'A category with that name already exists.' });
    }
    const info = await db.run(
      'UPDATE categories SET name = COALESCE(?, name), name_ar = COALESCE(?, name_ar), name_en = COALESCE(?, name_en), sort = COALESCE(?, sort) WHERE id = ?',
      [d.name ?? null, d.nameAr ?? null, d.nameEn ?? null, d.sort ?? null, id.data],
    );
    if (!info.changes) return res.status(404).json({ error: 'Category not found.' });
    await audit(db, { userId: req.auth.user.id, action: 'category.update', entity: 'category', entityId: id.data });
    res.json({ ok: true });
  });

  router.delete('/categories/:id', ...write, owner, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    await db.run('DELETE FROM categories WHERE id = ?', [id.data]);
    await audit(db, { userId: req.auth.user.id, action: 'category.delete', entity: 'category', entityId: id.data });
    res.json({ ok: true });
  });

  // ---------- Gallery (workshop photos) ----------
  const galleryJson = (g) => ({
    id: g.id, file: g.file, thumb: g.thumb, caption: g.caption, captionAr: g.caption_ar, captionEn: g.caption_en, featured: !!g.featured, sort: g.sort,
  });

  router.get('/gallery', any, async (req, res) => {
    res.json({ items: (await galleryImages(db)).map(galleryJson) });
  });

  router.post('/gallery', ...write, any, upload.array('files', config.maxUploadFiles), async (req, res) => {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Choose at least one JPEG, PNG or WebP image (up to 6 MB each).' });
    const stored = [];
    try {
      for (const file of files) stored.push(await storeImage(file.buffer, 'gallery'));
    } catch (error) {
      for (const item of stored) {
        await removeUpload(item.file);
        await removeUpload(item.thumb);
      }
      return res.status(400).json({ error: error.message || 'One of the images could not be read.' });
    }
    await db.transaction(async (tx) => {
      const next = (await tx.get('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM gallery_images')).next;
      for (const [i, item] of stored.entries()) {
        await tx.run('INSERT INTO gallery_images (file, thumb, sort, created_at) VALUES (?, ?, ?, ?)', [item.file, item.thumb, next + i, Date.now()]);
      }
      await audit(tx, { userId: req.auth.user.id, action: 'gallery.add', entity: 'gallery', detail: { count: stored.length } });
    });
    res.status(201).json({ items: (await galleryImages(db)).map(galleryJson) });
  });

  router.patch('/gallery/:id', ...write, any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const parsed = parse(galleryPatchSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;
    const info = await db.run(
      `UPDATE gallery_images SET caption = COALESCE(?, caption), caption_ar = COALESCE(?, caption_ar), caption_en = COALESCE(?, caption_en),
         featured = COALESCE(?, featured) WHERE id = ?`,
      [d.caption ?? null, d.captionAr ?? null, d.captionEn ?? null, d.featured === undefined ? null : d.featured ? 1 : 0, id.data],
    );
    if (!info.changes) return res.status(404).json({ error: 'Photo not found.' });
    await audit(db, { userId: req.auth.user.id, action: 'gallery.update', entity: 'gallery', entityId: id.data });
    res.json({ items: (await galleryImages(db)).map(galleryJson) });
  });

  router.put('/gallery/order', ...write, any, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
    const existing = new Set((await galleryImages(db)).map((g) => g.id));
    if (!ids || ids.length !== existing.size || ids.some((n) => !existing.has(n))) return res.status(400).json({ error: 'Order does not match the gallery.' });
    await db.transaction(async (tx) => {
      for (const [index, imageId] of ids.entries()) await tx.run('UPDATE gallery_images SET sort = ? WHERE id = ?', [index, imageId]);
    });
    res.json({ items: (await galleryImages(db)).map(galleryJson) });
  });

  router.delete('/gallery/:id', ...write, any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const row = await db.get('SELECT id, file, thumb FROM gallery_images WHERE id = ?', [id.data]);
    if (!row) return res.status(404).json({ error: 'Photo not found.' });
    await db.run('DELETE FROM gallery_images WHERE id = ?', [row.id]);
    await removeUpload(row.file);
    await removeUpload(row.thumb);
    await audit(db, { userId: req.auth.user.id, action: 'gallery.delete', entity: 'gallery', entityId: row.id });
    res.json({ items: (await galleryImages(db)).map(galleryJson) });
  });

  // ---------- Logo and hero photo (owner) ----------
  router.post('/settings/images/:kind', ...write, owner, upload.single('file'), async (req, res) => {
    const key = { logo: 'logo_url', hero: 'hero_url' }[req.params.kind];
    if (!key) return res.status(404).json({ error: 'Not found.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a JPEG, PNG or WebP image (up to 6 MB).' });
    let stored;
    try {
      stored = await storeImage(req.file.buffer, 'site');
    } catch (error) {
      return res.status(400).json({ error: error.message || 'The image could not be read.' });
    }
    const before = (await getSettings(db))[key];
    // The logo is small, so the thumbnail is enough; the hero uses the full-size version.
    const url = key === 'logo_url' ? stored.thumb : stored.file;
    await saveSetting(db, key, url);
    if (key === 'logo_url') await removeUpload(stored.file);
    else await removeUpload(stored.thumb);
    if (before) await removeUpload(before);
    await audit(db, { userId: req.auth.user.id, action: 'settings.image', entity: 'settings', detail: { kind: req.params.kind } });
    res.json(await getSettings(db));
  });

  router.delete('/settings/images/:kind', ...write, owner, async (req, res) => {
    const key = { logo: 'logo_url', hero: 'hero_url' }[req.params.kind];
    if (!key) return res.status(404).json({ error: 'Not found.' });
    const before = (await getSettings(db))[key];
    await saveSetting(db, key, '');
    if (before) await removeUpload(before);
    await audit(db, { userId: req.auth.user.id, action: 'settings.image.reset', entity: 'settings', detail: { kind: req.params.kind } });
    res.json(await getSettings(db));
  });

  // ---------- Orders ----------
  router.get('/orders', any, async (req, res) => {
    const status = ['pending', 'confirmed', 'delivered', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 50;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const conditions = [];
    const params = [];
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (q) {
      // Search by customer name, phone (digits only, so spacing does not matter) or order number.
      const digits = q.replace(/\D/g, '');
      const parts = ['customer_name ILIKE ?'];
      params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      if (digits) {
        parts.push("regexp_replace(phone, '[^0-9]', '', 'g') LIKE ?");
        params.push(`%${digits}%`);
        if (digits.length <= 9) {
          parts.push('id = ?');
          params.push(Number(digits));
        }
      }
      conditions.push(`(${parts.join(' OR ')})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (await db.get(`SELECT COUNT(*) AS n FROM orders ${where}`, params)).n;
    const items = await db.all(
      `SELECT id, customer_name, phone, status, total, created_at, updated_at FROM orders ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    );
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  });

  router.get('/orders/:id', any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [id.data]);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const items = await db.all('SELECT id, product_id, product_name, qty, unit_price FROM order_items WHERE order_id = ? ORDER BY id', [id.data]);
    res.json({ ...order, items });
  });

  router.post('/orders', ...write, any, async (req, res) => {
    const parsed = parse(orderSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;
    const now = Date.now();
    const id = await db.transaction(async (tx) => {
      // Each line keeps the name and price entered at the time of sale, so later product edits do not change old orders.
      const lines = d.items.map((item) => ({
        productId: item.productId ?? null,
        productName: item.productName,
        qty: item.qty,
        unitPrice: item.unitPrice,
      }));
      const total = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
      const order = await tx.run(
        `INSERT INTO orders (customer_name, phone, address, note, status, total, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?) RETURNING id`,
        [d.customerName, d.phone, d.address, d.note, total, req.auth.user.id, now, now],
      );
      for (const line of lines) {
        await tx.run('INSERT INTO order_items (order_id, product_id, product_name, qty, unit_price) VALUES (?, ?, ?, ?, ?)', [
          order.id, line.productId, line.productName, line.qty, line.unitPrice,
        ]);
      }
      await audit(tx, { userId: req.auth.user.id, action: 'order.create', entity: 'order', entityId: order.id, detail: { total, items: lines.length } });
      return order.id;
    });
    res.status(201).json({ id });
  });

  router.patch('/orders/:id/status', ...write, any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const parsed = parse(orderStatusSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: 'Invalid status.' });
    const status = parsed.data.status;
    const result = await db.transaction(async (tx) => {
      const order = await tx.get('SELECT id, status, stock_applied FROM orders WHERE id = ? FOR UPDATE', [id.data]);
      if (!order) return null;
      // Stock is taken when an order is confirmed or delivered, and given back if it is cancelled or reopened.
      const shouldApply = status === 'confirmed' || status === 'delivered' ? 1 : 0;
      if (shouldApply !== order.stock_applied) {
        const sign = shouldApply ? -1 : 1;
        const lines = await tx.all('SELECT product_id, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL', [id.data]);
        for (const line of lines) {
          await tx.run('UPDATE products SET stock = GREATEST(stock + ?, 0), updated_at = ? WHERE id = ? AND stock IS NOT NULL', [
            sign * line.qty, Date.now(), line.product_id,
          ]);
        }
      }
      await tx.run('UPDATE orders SET status = ?, stock_applied = ?, updated_at = ? WHERE id = ?', [status, shouldApply, Date.now(), id.data]);
      await audit(tx, { userId: req.auth.user.id, action: 'order.status', entity: 'order', entityId: id.data, detail: { from: order.status, status } });
      return true;
    });
    if (!result) return res.status(404).json({ error: 'Order not found.' });
    res.json({ ok: true });
  });

  // ---------- Settings (owner) ----------
  router.get('/settings', any, async (req, res) => {
    res.json(await getSettings(db));
  });

  router.put('/settings', ...write, owner, async (req, res) => {
    const parsed = parse(settingsSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const now = Date.now();
    await db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(parsed.data)) {
        await tx.run(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
          [key, value, now],
        );
      }
      await audit(tx, { userId: req.auth.user.id, action: 'settings.update', entity: 'settings', detail: { keys: Object.keys(parsed.data) } });
    });
    res.json(await getSettings(db));
  });

  // ---------- Users (owner) ----------
  router.get('/users', owner, async (req, res) => {
    res.json({
      items: await db.all('SELECT id, email, display_name AS "displayName", role, active, last_login_at AS "lastLoginAt" FROM users ORDER BY id'),
    });
  });

  router.post('/users', ...write, owner, async (req, res) => {
    const parsed = parse(newUserSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;
    if (await db.get('SELECT id FROM users WHERE email = ?', [d.email])) {
      return res.status(409).json({ error: 'That email already has an account.' });
    }
    const hash = await hashPassword(d.password);
    const info = await db.run(
      'INSERT INTO users (email, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [d.email, d.displayName, hash, d.role, Date.now()],
    );
    await audit(db, { userId: req.auth.user.id, action: 'user.create', entity: 'user', entityId: info.id, detail: { role: d.role } });
    res.status(201).json({ id: info.id });
  });

  router.patch('/users/:id', ...write, owner, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const parsed = parse(userPatchSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;
    const target = await db.get('SELECT id, role, active FROM users WHERE id = ?', [id.data]);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const isSelf = target.id === req.auth.user.id;
    const demotes = d.role === 'staff' && target.role === 'owner';
    const deactivates = d.active === false;
    if (isSelf && (demotes || deactivates)) {
      return res.status(400).json({ error: 'You cannot demote or deactivate your own account.' });
    }
    if (demotes || deactivates) {
      const owners = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1")).n;
      if (target.role === 'owner' && owners <= 1) {
        return res.status(400).json({ error: 'At least one active owner must remain.' });
      }
    }
    await db.run('UPDATE users SET role = COALESCE(?, role), active = COALESCE(?, active), display_name = COALESCE(?, display_name) WHERE id = ?', [
      d.role ?? null,
      d.active === undefined ? null : d.active ? 1 : 0,
      d.displayName ?? null,
      id.data,
    ]);
    if (deactivates) {
      // Ending access immediately: drop every live session for that user.
      await db.run('DELETE FROM sessions WHERE user_id = ?', [id.data]);
    }
    await audit(db, { userId: req.auth.user.id, action: 'user.update', entity: 'user', entityId: id.data, detail: { fields: Object.keys(d) } });
    res.json({ ok: true });
  });

  router.post('/users/:id/password', ...write, owner, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const parsed = parse(passwordResetSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const hash = await hashPassword(parsed.data.password);
    const info = await db.run('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', [hash, id.data]);
    if (!info.changes) return res.status(404).json({ error: 'User not found.' });
    await db.run('DELETE FROM sessions WHERE user_id = ?', [id.data]);
    await audit(db, { userId: req.auth.user.id, action: 'user.password_reset', entity: 'user', entityId: id.data });
    res.json({ ok: true });
  });

  // ---------- AI Studio (projects, reports, usage) ----------
  router.get('/studio/projects', any, async (req, res) => {
    await purgeExpiredProjects(db);
    const rows = await db.all(
      `SELECT p.id, p.lang, p.description, p.data, p.measurement_status, p.created_at, p.expires_at,
              (SELECT COUNT(*) FROM studio_views v WHERE v.project_id = p.id) AS views,
              (SELECT COUNT(*) FROM studio_reports r WHERE r.project_id = p.id AND r.resolved_at IS NULL) AS open_reports
         FROM studio_projects p ORDER BY p.created_at DESC LIMIT 200`,
    );
    res.json({
      items: rows.map((r) => {
        const data = JSON.parse(r.data || '{}');
        return {
          id: r.id, ref: projectRef(r.id), lang: r.lang, description: r.description, views: r.views, openReports: r.open_reports,
          productCode: data.productCode ?? null, productName: data.productName ?? '', area: data.area ?? null, tiles: data.tiles ?? null,
          measurementStatus: r.measurement_status, createdAt: r.created_at, expiresAt: r.expires_at,
        };
      }),
    });
  });

  router.get('/studio/projects/:id', any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const project = await db.get('SELECT * FROM studio_projects WHERE id = ?', [id.data]);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const reports = await db.all('SELECT id, message, created_at, resolved_at FROM studio_reports WHERE project_id = ? ORDER BY created_at DESC', [id.data]);
    res.set('Cache-Control', 'no-store').json({ ...(await projectWithViews(db, project)), reports });
  });

  router.get('/studio/projects/:id/views/:idx/:kind', any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).end();
    await sendViewImage(db, res, id.data, req.params.idx, req.params.kind);
  });

  // The factory can mark a customer's measurements as checked on site.
  router.patch('/studio/projects/:id', ...write, any, async (req, res) => {
    const id = idOf(req.params.id);
    const status = req.body?.measurementStatus;
    if (!id.success || !['customer', 'verified'].includes(status)) return res.status(400).json({ error: 'Invalid request.' });
    const info = await db.run('UPDATE studio_projects SET measurement_status = ? WHERE id = ?', [status, id.data]);
    if (!info.changes) return res.status(404).json({ error: 'Project not found.' });
    await audit(db, { userId: req.auth.user.id, action: 'studio.measurements', entity: 'studio_project', entityId: id.data, detail: { status } });
    res.json({ ok: true });
  });

  router.delete('/studio/projects/:id', ...write, owner, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const info = await db.run('DELETE FROM studio_projects WHERE id = ?', [id.data]);
    if (!info.changes) return res.status(404).json({ error: 'Project not found.' });
    await audit(db, { userId: req.auth.user.id, action: 'studio.delete', entity: 'studio_project', entityId: id.data });
    res.json({ ok: true });
  });

  router.get('/studio/reports', any, async (req, res) => {
    const rows = await db.all(
      'SELECT id, project_id, message, created_at, resolved_at FROM studio_reports ORDER BY resolved_at IS NOT NULL, created_at DESC LIMIT 200',
    );
    res.json({ items: rows.map((r) => ({ ...r, ref: r.project_id ? projectRef(r.project_id) : null })) });
  });

  router.post('/studio/reports/:id/resolve', ...write, any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    await db.run('UPDATE studio_reports SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL', [Date.now(), id.data]);
    res.json({ ok: true });
  });

  router.get('/studio/stats', any, async (req, res) => {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const events = await db.all('SELECT kind, COUNT(*) AS n FROM studio_events WHERE at >= ? GROUP BY kind', [since]);
    const byKind = Object.fromEntries(events.map((e) => [e.kind, e.n]));
    const [projects, openReports, vizProducts] = await Promise.all([
      db.get('SELECT COUNT(*) AS n FROM studio_projects WHERE expires_at > ?', [Date.now()]),
      db.get('SELECT COUNT(*) AS n FROM studio_reports WHERE resolved_at IS NULL'),
      db.get("SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NULL AND viz_enabled = 1 AND texture_url <> ''"),
    ]);
    res.json({ last30Days: byKind, savedProjects: projects.n, openReports: openReports.n, vizProducts: vizProducts.n });
  });

  // ---------- Original products import (owner) ----------
  // Imports the products from the original page in small batches, so each request stays within serverless time limits.
  router.get('/import-legacy', owner, async (req, res) => {
    const total = loadManifest().products.length;
    const codes = new Set((await db.all('SELECT code FROM products')).map((row) => row.code));
    const remaining = loadManifest().products.filter((item) => !codes.has(item.number)).length;
    res.json({ total, remaining });
  });

  router.post('/import-legacy', ...write, owner, async (req, res) => {
    const result = await importLegacyBatch(db, { limit: 4, userId: req.auth.user.id });
    res.json(result);
  });

  // ---------- Audit log (owner) ----------
  router.get('/audit', owner, async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 100;
    const total = (await db.get('SELECT COUNT(*) AS n FROM audit_log')).n;
    const rows = await db.all(
      `SELECT a.id, a.action, a.entity, a.entity_id AS "entityId", a.detail, a.at, u.email AS "userEmail"
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.at DESC, a.id DESC LIMIT ? OFFSET ?`,
      [limit, (page - 1) * limit],
    );
    const items = rows.map((row) => ({ ...row, detail: row.detail ? JSON.parse(row.detail) : null }));
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  });

  return router;
}
