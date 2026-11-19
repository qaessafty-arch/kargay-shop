import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { audit } from './audit.js';
import { renumberImages } from './catalog.js';
import { storeImage, storeProductImage } from './uploads.js';

// The original page's products and photos, extracted by scripts/legacy/convert-legacy.py.
const legacyDir = path.join(config.root, 'scripts', 'legacy');

export function loadManifest() {
  return JSON.parse(fs.readFileSync(path.join(legacyDir, 'manifest.json'), 'utf8'));
}

/** Category rules applied to the Kurdish product name (first match wins). */
function categoryFor(name) {
  if (name.includes('ڕەسیف')) return 'ڕەسیف';
  if (/گوڵدان|کورسی|پارچەکانی دەوری/.test(name)) return 'کەلوپەلی باخچە';
  return 'کاشی';
}

let namesCache = null;
/** Arabic and English names for the original products and categories (from the original page's translations). */
function legacyNames() {
  if (!namesCache) namesCache = JSON.parse(fs.readFileSync(path.join(legacyDir, 'names.json'), 'utf8'));
  return namesCache;
}

async function categoryId(db, name) {
  const [ar, en] = legacyNames().categories[name] || ['', ''];
  await db.run('INSERT INTO categories (name, name_ar, name_en, sort) VALUES (?, ?, ?, 0) ON CONFLICT (name) DO NOTHING', [name, ar, en]);
  // Fill translations for a category that existed before translations were added.
  await db.run("UPDATE categories SET name_ar = ?, name_en = ? WHERE name = ? AND name_ar = '' AND name_en = ''", [ar, en, name]);
  return (await db.get('SELECT id FROM categories WHERE name = ?', [name])).id;
}

/**
 * Imports up to `limit` original products that are not in the database yet.
 * Safe to call repeatedly: products whose code already exists (including deleted ones) are skipped.
 * Returns { imported, failed, remaining }.
 */
const textureFile = (code) => path.join(legacyDir, 'textures', `${code}.webp`);

/**
 * Prepared visualization textures (cropped from the product's own straight-on photo) for the AI Studio.
 * Attached once per product; a texture the owner later removes or replaces is left alone.
 */
async function attachLegacyTexture(db, productId, code) {
  if (!fs.existsSync(textureFile(code))) return false;
  const stored = await storeImage(fs.readFileSync(textureFile(code)), `products/${code}`);
  await db.run("UPDATE products SET texture_url = ?, texture_thumb = ?, viz_enabled = 1 WHERE id = ? AND texture_url = ''", [stored.file, stored.thumb, productId]);
  return true;
}

/** For shops that imported the products before textures existed: attach them once. */
async function backfillLegacyTextures(db) {
  const done = await db.get("SELECT value FROM settings WHERE key = 'legacy_textures_done'");
  if (done?.value === '1') return 0;
  let count = 0;
  for (const row of await db.all("SELECT id, code FROM products WHERE texture_url = '' AND deleted_at IS NULL")) {
    if (await attachLegacyTexture(db, row.id, row.code)) count++;
  }
  await db.run(
    "INSERT INTO settings (key, value, updated_at) VALUES ('legacy_textures_done', '1', ?) ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = excluded.updated_at",
    [Date.now()],
  );
  return count;
}

export async function importLegacyBatch(db, { limit = 6, userId = null } = {}) {
  const { products } = loadManifest();
  const existing = new Set((await db.all('SELECT code FROM products')).map((row) => row.code));
  const pending = products.filter((item) => !existing.has(item.number));
  const batch = pending.slice(0, limit);
  const failed = [];
  let imported = 0;

  for (const item of batch) {
    const stored = [];
    try {
      for (const file of [item.main_image, item.extra_image].filter(Boolean)) {
        stored.push(await storeProductImage(fs.readFileSync(path.join(legacyDir, 'images', file)), item.number));
      }
    } catch (error) {
      failed.push({ code: item.number, reason: error.message });
      continue;
    }

    await db.transaction(async (tx) => {
      const now = Date.now();
      const info = await tx.run(
        `INSERT INTO products (code, name, name_ar, name_en, description, category_id, width_cm, height_cm, price, stock, visible, featured, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, 0, ?, ?, ?) RETURNING id`,
        [
          item.number, item.name, ...(legacyNames().products[item.name] || ['', '']), item.description || '',
          await categoryId(tx, categoryFor(item.name)), item.width_cm, item.height_cm, item.number, now, now,
        ],
      );
      for (const [index, s] of stored.entries()) {
        await tx.run('INSERT INTO product_images (product_id, file, thumb, kind, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
          info.id, s.file, s.thumb, index === 0 ? 'main' : 'extra', index, now,
        ]);
      }
      await renumberImages(tx, info.id);
      await attachLegacyTexture(tx, info.id, item.number);
      await audit(tx, { userId, action: 'product.import', entity: 'product', entityId: info.id, detail: { code: item.number, source: 'legacy-page' } });
    });
    imported++;
  }

  // Failed products are still pending and will be retried on the next call.
  const remaining = pending.length - imported;
  const textures = remaining === 0 ? await backfillLegacyTextures(db) : 0;
  return { imported, failed, remaining, textures };
}
