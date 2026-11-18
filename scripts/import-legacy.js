// Imports the products from the original single-file page (see scripts/legacy/convert-legacy.py).
// Safe to run more than once: products whose code already exists are skipped.
// For Neon + Vercel Blob, set DATABASE_URL and BLOB_READ_WRITE_TOKEN first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase } from '../src/database.js';
import { storeProductImage } from '../src/uploads.js';
import { audit } from '../src/audit.js';
import { renumberImages } from '../src/catalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'legacy', 'manifest.json'), 'utf8'));
const imagesDir = path.join(here, 'legacy', 'images');
const db = getDatabase();

/** Category rules applied to the Kurdish product name (first match wins). */
function categoryFor(name) {
  if (name.includes('ڕەسیف')) return 'ڕەسیف';
  if (/گوڵدان|کورسی|پارچەکانی دەوری/.test(name)) return 'کەلوپەلی باخچە';
  return 'کاشی';
}

const categoryIds = new Map();
async function getCategory(name, sort) {
  if (categoryIds.has(name)) return categoryIds.get(name);
  await db.run('INSERT INTO categories (name, sort) VALUES (?, ?) ON CONFLICT (name) DO NOTHING', [name, sort]);
  const row = await db.get('SELECT id FROM categories WHERE name = ?', [name]);
  categoryIds.set(name, row.id);
  return row.id;
}

let imported = 0;
let skipped = 0;
const failures = [];

for (const item of manifest.products) {
  if (await db.get('SELECT id FROM products WHERE code = ?', [item.number])) {
    skipped++;
    continue;
  }
  const images = [item.main_image, item.extra_image].filter(Boolean).map((file) => path.join(imagesDir, file));
  const stored = [];
  try {
    for (const file of images) {
      stored.push(await storeProductImage(fs.readFileSync(file), item.number));
    }
  } catch (error) {
    failures.push({ code: item.number, reason: error.message });
    continue;
  }

  await db.transaction(async (tx) => {
    const now = Date.now();
    const categoryId = await getCategory(categoryFor(item.name), 0);
    const info = await tx.run(
      `INSERT INTO products (code, name, description, category_id, width_cm, height_cm, price, stock, visible, featured, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 1, 0, ?, ?, ?) RETURNING id`,
      [item.number, item.name, item.description || '', categoryId, item.width_cm, item.height_cm, item.number, now, now],
    );
    for (const [index, s] of stored.entries()) {
      await tx.run('INSERT INTO product_images (product_id, file, thumb, kind, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        info.id, s.file, s.thumb, index === 0 ? 'main' : 'extra', index, now,
      ]);
    }
    await renumberImages(tx, info.id);
    await audit(tx, { action: 'product.import', entity: 'product', entityId: info.id, detail: { code: item.number, source: 'legacy-page' } });
  });
  imported++;
}

console.log(`Imported ${imported} products, skipped ${skipped} already present, failed ${failures.length}.`);
for (const f of failures) console.log(`  failed code ${f.code}: ${f.reason}`);
await db.close();
