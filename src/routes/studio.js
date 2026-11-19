import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { getSettings } from '../catalog.js';
import { uploadsRoot } from '../uploads.js';
import { PHOTO_KEY, isNetlify, photoStore } from '../netlify-store.js';
import { parse, studioProjectPatchSchema, studioProjectSchema, studioReportSchema } from '../validation.js';
import {
  MAX_VIEWS,
  asBuffer,
  cleanImage,
  createShareToken,
  imageType,
  newOwnerKey,
  projectForOwner,
  projectRef,
  projectWithViews,
  purgeExpiredProjects,
  recordEvent,
  retentionMs,
  safeData,
  verifyShareToken,
} from '../studio.js';

const EVENT_KINDS = new Set(['open', 'detect', 'apply', 'view3d', 'download', 'quote']);
const IMAGE_KINDS = { original: 'original', result: 'result', mask: 'mask' };

/** Customer-facing Studio API under /api/studio. */
export function studioApiRouter({ db, limiter }) {
  const router = Router();

  // Every request checks that the Studio is switched on in Settings.
  router.use(async (req, res, next) => {
    try {
      const settings = await getSettings(db);
      if (settings.studio_enabled === '0') return res.status(404).json({ error: 'The AI Studio is not available.' });
      req.studioSettings = settings;
      next();
    } catch (error) {
      next(error);
    }
  });

  const uploadFor = (req, res, next) => {
    const mb = Math.min(3, Math.max(1, Number(req.studioSettings.studio_max_upload_mb) || 3));
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: mb * 1024 * 1024, files: 3, fields: 4, fieldSize: 20_000 },
      fileFilter: (r, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
    }).fields([{ name: 'original', maxCount: 1 }, { name: 'result', maxCount: 1 }, { name: 'mask', maxCount: 1 }])(req, res, next);
  };

  const owned = async (req, res) => {
    const project = await projectForOwner(db, Number(req.params.id), req.get('x-project-key'));
    if (!project) res.status(404).json({ error: 'Project not found.' });
    return project;
  };

  // Anonymous usage counters (no personal data): how many people detect floors, open 3D, ask for quotes…
  router.post('/events', async (req, res) => {
    const kind = String(req.body?.kind || '');
    const productId = Number.isInteger(req.body?.productId) ? req.body.productId : null;
    if (EVENT_KINDS.has(kind)) await recordEvent(db, kind, productId);
    res.status(204).end();
  });

  // Product textures served from this site, so the browser can use them in WebGL without cross-origin limits.
  router.get('/textures/:code', async (req, res, next) => {
    try {
      const code = Number(req.params.code);
      const row = Number.isInteger(code)
        ? await db.get("SELECT texture_url FROM products WHERE code = ? AND deleted_at IS NULL AND visible = 1 AND viz_enabled = 1 AND texture_url <> ''", [code])
        : null;
      if (!row) return res.status(404).end();
      res.set('Cache-Control', 'public, max-age=86400');
      if (row.texture_url.startsWith('/uploads/')) {
        const file = path.resolve(uploadsRoot, row.texture_url.slice('/uploads/'.length));
        if (!file.startsWith(uploadsRoot + path.sep)) return res.status(404).end();
        return res.sendFile(file);
      }
      if (row.texture_url.startsWith('/media/')) {
        const key = row.texture_url.slice('/media/'.length);
        if (!isNetlify() || !PHOTO_KEY.test(key)) return res.status(404).end();
        const bytes = await photoStore().get(key, { type: 'arrayBuffer' });
        if (!bytes) return res.status(404).end();
        return res.type('image/webp').send(Buffer.from(bytes));
      }
      if (!/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//.test(row.texture_url)) return res.status(404).end();
      const upstream = await fetch(row.texture_url);
      if (!upstream.ok) return res.status(502).end();
      res.set({ 'Content-Type': upstream.headers.get('content-type') || 'image/webp', 'Cache-Control': 'public, max-age=86400' });
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects', limiter, async (req, res) => {
    const parsed = parse(studioProjectSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    let data;
    try {
      data = safeData(parsed.data.data);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    await purgeExpiredProjects(db);
    const { key, hash } = newOwnerKey();
    const now = Date.now();
    const info = await db.run(
      `INSERT INTO studio_projects (owner_hash, lang, description, data, consent_at, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [hash, parsed.data.lang, parsed.data.description, data, now, now, now, now + retentionMs(req.studioSettings)],
    );
    await recordEvent(db, 'save');
    res.status(201).json({ id: info.id, ref: projectRef(info.id), key, expiresAt: now + retentionMs(req.studioSettings) });
  });

  router.get('/projects/:id', async (req, res) => {
    const project = await owned(req, res);
    if (!project) return;
    res.set('Cache-Control', 'no-store').json(await projectWithViews(db, project));
  });

  router.put('/projects/:id', async (req, res) => {
    const project = await owned(req, res);
    if (!project) return;
    const parsed = parse(studioProjectPatchSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    let data = project.data;
    try {
      if (parsed.data.data) data = safeData(parsed.data.data);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    await db.run('UPDATE studio_projects SET description = ?, data = ?, updated_at = ? WHERE id = ?', [
      parsed.data.description ?? project.description, data, Date.now(), project.id,
    ]);
    res.json({ ok: true });
  });

  router.delete('/projects/:id', async (req, res) => {
    const project = await owned(req, res);
    if (!project) return;
    await db.run('DELETE FROM studio_projects WHERE id = ?', [project.id]);
    res.json({ ok: true });
  });

  // One photo of the space with its design result and floor selection (up to MAX_VIEWS per project).
  router.put('/projects/:id/views/:idx', limiter, uploadFor, async (req, res) => {
    const project = await owned(req, res);
    if (!project) return;
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_VIEWS) return res.status(400).json({ error: 'Invalid photo number.' });
    const files = req.files || {};
    if (!files.original?.[0]) return res.status(400).json({ error: 'The original photo is missing.' });
    let original;
    let result = null;
    let mask = null;
    let data;
    try {
      original = await cleanImage(files.original[0].buffer);
      if (files.result?.[0]) result = await cleanImage(files.result[0].buffer);
      if (files.mask?.[0]) mask = await cleanImage(files.mask[0].buffer, { format: 'png' });
      data = safeData(req.body?.data ? JSON.parse(req.body.data) : {});
    } catch (error) {
      return res.status(400).json({ error: error instanceof SyntaxError ? 'Invalid photo data.' : error.message });
    }
    await db.run(
      `INSERT INTO studio_views (project_id, idx, original, result, mask, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, idx) DO UPDATE SET original = excluded.original, result = excluded.result, mask = excluded.mask, data = excluded.data`,
      [project.id, idx, original, result, mask, data, Date.now()],
    );
    await db.run('UPDATE studio_projects SET updated_at = ? WHERE id = ?', [Date.now(), project.id]);
    res.json({ ok: true });
  });

  router.delete('/projects/:id/views/:idx', async (req, res) => {
    const project = await owned(req, res);
    if (!project) return;
    await db.run('DELETE FROM studio_views WHERE project_id = ? AND idx = ?', [project.id, Number(req.params.idx)]);
    res.json({ ok: true });
  });

  router.get('/projects/:id/views/:idx/:kind', async (req, res) => {
    const project = await owned(req, res);
    if (!project) return;
    await sendViewImage(db, res, project.id, req.params.idx, req.params.kind);
  });

  router.post('/projects/:id/share', async (req, res) => {
    const project = await owned(req, res);
    if (!project) return;
    const { token, expires } = await createShareToken(db, project.id);
    res.json({ path: `/studio/v/${token}`, expiresAt: Math.min(expires, project.expires_at) });
  });

  router.post('/projects/:id/report', limiter, async (req, res) => {
    const project = await owned(req, res);
    if (!project) return;
    const parsed = parse(studioReportSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    await db.run('INSERT INTO studio_reports (project_id, message, created_at) VALUES (?, ?, ?)', [project.id, parsed.data.message, Date.now()]);
    res.status(201).json({ ok: true });
  });

  return router;
}

/** Streams one stored image privately (never cached by shared caches). */
export async function sendViewImage(db, res, projectId, idxParam, kindParam) {
  const column = IMAGE_KINDS[kindParam];
  const idx = Number(idxParam);
  if (!column || !Number.isInteger(idx)) return res.status(404).end();
  const row = await db.get(`SELECT ${column} AS img FROM studio_views WHERE project_id = ? AND idx = ?`, [projectId, idx]);
  const img = asBuffer(row?.img);
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': imageType(img), 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.send(img);
}

/** Read-only shared design pages: /studio/v/<signed token>. */
export function studioShareRouter({ db, renderShare }) {
  const router = Router();

  router.get('/studio/v/:token', async (req, res, next) => {
    try {
      const id = await verifyShareToken(db, req.params.token);
      const project = id ? await db.get('SELECT * FROM studio_projects WHERE id = ? AND expires_at > ?', [id, Date.now()]) : null;
      res.set({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
      if (!project) return res.status(404).type('html').send(await renderShare(req, null));
      res.type('html').send(await renderShare(req, await projectWithViews(db, project), req.params.token));
    } catch (error) {
      next(error);
    }
  });

  router.get('/studio/v/:token/img/:idx/:kind', async (req, res, next) => {
    try {
      const id = await verifyShareToken(db, req.params.token);
      if (!id || !(await db.get('SELECT id FROM studio_projects WHERE id = ? AND expires_at > ?', [id, Date.now()]))) return res.status(404).end();
      await sendViewImage(db, res, id, req.params.idx, req.params.kind);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
