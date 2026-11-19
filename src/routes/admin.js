import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { hashPassword, requireAuth, requireCsrf, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { findProduct, findProductByCode, getSettings, listProducts, renumberImages } from '../catalog.js';
import { removeUpload, storeProductImage } from '../uploads.js';
import { importLegacyBatch, loadManifest } from '../legacy-import.js';
import {
  categorySchema,
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
    description: row.description,
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
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const since = monthStart.getTime();
    res.json({
      products: await count('SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NULL'),
      visible: await count('SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NULL AND visible = 1'),
      featured: await count('SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NULL AND featured = 1'),
      lowStock: await count('SELECT COUNT(*) AS n FROM products WHERE deleted_at IS NULL AND stock IS NOT NULL AND stock <= 3'),
      pendingOrders: await count("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'"),
      deliveredThisMonth: await count("SELECT COUNT(*) AS n FROM orders WHERE status = 'delivered' AND updated_at >= ?", [since]),
      revenueThisMonth: (
        await db.get("SELECT COALESCE(SUM(total), 0)::bigint AS total FROM orders WHERE status = 'delivered' AND updated_at >= ?", [since])
      ).total,
      enquiriesTotal: (await db.get('SELECT COALESCE(SUM(enquiry_count), 0)::bigint AS total FROM products')).total,
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
    const header = ['code', 'name', 'category', 'width_cm', 'height_cm', 'price', 'stock', 'visible', 'enquiries'];
    const lines = items.map((p) =>
      [p.code, p.name, p.category_name, p.width_cm, p.height_cm, p.price, p.stock, p.visible ? 'yes' : 'no', p.enquiry_count]
        .map(cell)
        .join(','),
    );
    res.type('text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    res.send('﻿' + [header.join(','), ...lines].join('\n'));
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
        `INSERT INTO products (code, name, description, category_id, width_cm, height_cm, price, stock,
           visible, featured, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          code,
          d.name,
          d.description,
          d.categoryId ?? null,
          d.widthCm ?? null,
          d.heightCm ?? null,
          d.price ?? null,
          d.stock ?? null,
          d.visible ? 1 : 0,
          d.featured ? 1 : 0,
          d.sort ?? code,
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
      code: 'code', name: 'name', description: 'description', categoryId: 'category_id', widthCm: 'width_cm',
      heightCm: 'height_cm', price: 'price', stock: 'stock', visible: 'visible', featured: 'featured', sort: 'sort',
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

  // ---------- Categories ----------
  router.get('/categories', any, async (req, res) => {
    res.json({ items: await db.all('SELECT id, name, sort FROM categories ORDER BY sort, name') });
  });

  router.post('/categories', ...write, any, async (req, res) => {
    const parsed = parse(categorySchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (await db.get('SELECT id FROM categories WHERE name = ?', [parsed.data.name])) {
      return res.status(409).json({ error: 'A category with that name already exists.' });
    }
    const info = await db.run('INSERT INTO categories (name, sort) VALUES (?, ?) RETURNING id', [parsed.data.name, parsed.data.sort]);
    await audit(db, { userId: req.auth.user.id, action: 'category.create', entity: 'category', entityId: info.id });
    res.status(201).json({ id: info.id });
  });

  router.patch('/categories/:id', ...write, any, async (req, res) => {
    const id = idOf(req.params.id);
    if (!id.success) return res.status(400).json({ error: 'Invalid id.' });
    const parsed = parse(categorySchema.partial(), req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;
    if (d.name !== undefined && (await db.get('SELECT id FROM categories WHERE name = ? AND id <> ?', [d.name, id.data]))) {
      return res.status(409).json({ error: 'A category with that name already exists.' });
    }
    await db.run('UPDATE categories SET name = COALESCE(?, name), sort = COALESCE(?, sort) WHERE id = ?', [d.name ?? null, d.sort ?? null, id.data]);
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

  // ---------- Orders ----------
  router.get('/orders', any, async (req, res) => {
    const status = ['pending', 'confirmed', 'delivered', 'cancelled'].includes(req.query.status) ? req.query.status : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 50;
    const params = status ? [status] : [];
    const where = status ? 'WHERE status = ?' : '';
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
    const info = await db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [parsed.data.status, Date.now(), id.data]);
    if (!info.changes) return res.status(404).json({ error: 'Order not found.' });
    await audit(db, { userId: req.auth.user.id, action: 'order.status', entity: 'order', entityId: id.data, detail: { status: parsed.data.status } });
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
