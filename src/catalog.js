import { config } from './config.js';

// One query shape used by both the public page and the admin list, so both show the same data.
const PRODUCT_SELECT = `
  SELECT p.id, p.code, p.name, p.description, p.category_id, p.width_cm, p.height_cm, p.price,
         p.stock, p.visible, p.featured, p.sort, p.enquiry_count, p.created_at, p.updated_at, p.deleted_at,
         c.name AS category_name,
         (SELECT file FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS main_file,
         (SELECT thumb FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1) AS main_thumb,
         (SELECT file FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort, i.id LIMIT 1 OFFSET 1) AS extra_file,
         (SELECT COUNT(*) FROM product_images i WHERE i.product_id = p.id) AS image_count
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
`;

/** Products shown on the public site, in shop order. */
export function visibleProducts(db) {
  return db.all(`${PRODUCT_SELECT} WHERE p.deleted_at IS NULL AND p.visible = 1 ORDER BY p.sort, p.code`);
}

export async function findProduct(db, id) {
  return db.get(`${PRODUCT_SELECT} WHERE p.id = ?`, [id]);
}

export async function findProductByCode(db, code) {
  return db.get(`${PRODUCT_SELECT} WHERE p.code = ?`, [code]);
}

/** Admin list with search, filters and paging. */
export async function listProducts(db, { q = '', categoryId = null, status = 'all', page = 1, limit = 50 } = {}) {
  const where = [];
  const params = [];
  if (status === 'deleted') where.push('p.deleted_at IS NOT NULL');
  else where.push('p.deleted_at IS NULL');
  if (status === 'visible') where.push('p.visible = 1');
  if (status === 'hidden') where.push('p.visible = 0');
  if (status === 'low-stock') where.push('p.stock IS NOT NULL AND p.stock <= 3');
  if (categoryId) {
    where.push('p.category_id = ?');
    params.push(categoryId);
  }
  if (q) {
    where.push('(p.name LIKE ? OR p.description LIKE ? OR CAST(p.code AS TEXT) = ?)');
    params.push(`%${q}%`, `%${q}%`, q);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = (await db.get(`SELECT COUNT(*) AS n FROM products p ${clause}`, params)).n;
  const offset = (page - 1) * limit;
  const items = await db.all(`${PRODUCT_SELECT} ${clause} ORDER BY p.sort, p.code LIMIT ? OFFSET ?`, [...params, limit, offset]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getSettings(db) {
  const rows = await db.all('SELECT key, value FROM settings');
  const settings = { ...config.shopDefaults };
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

/**
 * After any change to a product's images, keep `kind` consistent with the gallery:
 * the first image (lowest sort) is the main one, the second is shown in the lightbox as "extra".
 */
export async function renumberImages(db, productId) {
  const rows = await db.all('SELECT id FROM product_images WHERE product_id = ? ORDER BY sort, id', [productId]);
  for (const [index, row] of rows.entries()) {
    await db.run('UPDATE product_images SET sort = ?, kind = ? WHERE id = ?', [index, index === 0 ? 'main' : 'extra', row.id]);
  }
}
