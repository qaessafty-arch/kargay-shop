// AI Studio: customer design projects.
// Privacy model:
// - A project is created only after the customer ticks the consent box.
// - The browser gets a random owner key once; the server stores only its SHA-256 hash.
// - Photos are kept in the database (not on a public file host) and are served only to the owner key,
//   to a signed share link that expires, or to signed-in shop staff.
// - Projects are deleted automatically after the retention period, or at any time by the owner.
import crypto from 'node:crypto';
import sharp from 'sharp';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const DAY = 24 * 60 * 60 * 1000;
export const SHARE_DAYS = 30;
export const MAX_VIEWS = 4;

export const projectRef = (id) => `KS-${String(id).padStart(4, '0')}`;

/** The HMAC key for share links: created once at random and kept in the database, never in code. */
async function shareSecret(db) {
  const row = await db.get("SELECT value FROM app_secrets WHERE key = 'studio_share'");
  if (row) return row.value;
  const value = crypto.randomBytes(32).toString('base64url');
  await db.run("INSERT INTO app_secrets (key, value) VALUES ('studio_share', ?) ON CONFLICT (key) DO NOTHING", [value]);
  return (await db.get("SELECT value FROM app_secrets WHERE key = 'studio_share'")).value;
}

export async function createShareToken(db, projectId, days = SHARE_DAYS) {
  const expires = Date.now() + days * DAY;
  const payload = `${projectId}.${expires}`;
  const sig = crypto.createHmac('sha256', await shareSecret(db)).update(payload).digest('base64url').slice(0, 32);
  return { token: `${payload}.${sig}`, expires };
}

/** Returns the project id for a valid, unexpired share token, otherwise null. */
export async function verifyShareToken(db, token) {
  const match = /^(\d{1,9})\.(\d{13})\.([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
  if (!match) return null;
  const [, id, expires, sig] = match;
  if (Number(expires) < Date.now()) return null;
  const expected = crypto.createHmac('sha256', await shareSecret(db)).update(`${id}.${expires}`).digest('base64url').slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return Number(id);
}

export function newOwnerKey() {
  const key = crypto.randomBytes(24).toString('base64url');
  return { key, hash: sha256(key) };
}

/** Constant-time check of the owner key sent in the X-Project-Key header. */
export async function projectForOwner(db, id, key) {
  if (!Number.isInteger(id) || id < 1 || typeof key !== 'string' || key.length < 20 || key.length > 64) return null;
  const project = await db.get('SELECT * FROM studio_projects WHERE id = ? AND expires_at > ?', [id, Date.now()]);
  if (!project) return null;
  const a = Buffer.from(project.owner_hash);
  const b = Buffer.from(sha256(key));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? project : null;
}

export async function purgeExpiredProjects(db) {
  await db.run('DELETE FROM studio_projects WHERE expires_at < ?', [Date.now()]);
}

export function retentionMs(settings) {
  const days = Math.min(365, Math.max(1, Number(settings.studio_retention_days) || 90));
  return days * DAY;
}

/**
 * Re-encodes an uploaded image: proves it is a real image, removes all metadata (including phone GPS
 * location), limits its size, and returns compact bytes.
 */
export async function cleanImage(buffer, { maxSide = 1600, format = 'jpeg' } = {}) {
  const meta = await sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('Only JPEG, PNG or WebP images are allowed.');
  const pipeline = sharp(buffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  return format === 'png' ? pipeline.png({ compressionLevel: 9 }).toBuffer() : pipeline.jpeg({ quality: 84, mozjpeg: true }).toBuffer();
}

/** JSON stored with a project is limited in size and depth so it cannot be abused as storage. */
export function safeData(data) {
  const text = JSON.stringify(data ?? {});
  if (text.length > 20_000) throw new Error('Project data is too large.');
  return text;
}

export const asBuffer = (value) => (value == null ? null : Buffer.isBuffer(value) ? value : Buffer.from(value));

export function imageType(buffer) {
  if (!buffer) return 'application/octet-stream';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  return 'image/jpeg';
}

export async function recordEvent(db, kind, productId = null) {
  await db.run('INSERT INTO studio_events (kind, product_id, at) VALUES (?, ?, ?)', [kind, productId, Date.now()]);
}

export async function projectWithViews(db, project) {
  const views = await db.all(
    'SELECT idx, data, (result IS NOT NULL) AS has_result, (mask IS NOT NULL) AS has_mask FROM studio_views WHERE project_id = ? ORDER BY idx',
    [project.id],
  );
  return {
    id: project.id,
    ref: projectRef(project.id),
    lang: project.lang,
    description: project.description,
    data: JSON.parse(project.data || '{}'),
    measurementStatus: project.measurement_status,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    expiresAt: project.expires_at,
    views: views.map((v) => ({ idx: v.idx, data: JSON.parse(v.data || '{}'), hasResult: !!v.has_result, hasMask: !!v.has_mask })),
  };
}
