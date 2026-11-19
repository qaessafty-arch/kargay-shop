import crypto from 'node:crypto';
import { Router } from 'express';
import { hashPassword } from '../auth.js';
import { audit } from '../audit.js';
import { emailSchema, passwordSchema, parse } from '../validation.js';
import { z } from 'zod';

const ownerSchema = z.object({
  token: z.string().min(1).max(200),
  email: emailSchema,
  displayName: z.string().trim().min(1).max(80),
  password: passwordSchema,
});

function tokenMatches(sent, expected) {
  const a = Buffer.from(String(sent));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * First-run setup: creates the first owner account from the browser.
 * Works only while no account exists AND with the SETUP_TOKEN from the server environment,
 * so nobody else can claim the shop. Once an account exists, these routes do nothing.
 */
export function setupRouter({ db, limiter }) {
  const router = Router();

  router.get('/status', async (req, res) => {
    const users = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
    res.json({ needsOwner: users === 0, setupEnabled: Boolean(process.env.SETUP_TOKEN) });
  });

  router.post('/owner', limiter, async (req, res) => {
    const expected = process.env.SETUP_TOKEN;
    if (!expected) return res.status(404).json({ error: 'Setup is not enabled.' });

    const parsed = parse(ownerSchema, req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!tokenMatches(parsed.data.token, expected)) {
      return res.status(403).json({ error: 'The setup code is not correct.' });
    }

    const hash = await hashPassword(parsed.data.password);
    // Check and insert in one transaction so two people cannot both become the first owner.
    const created = await db.transaction(async (tx) => {
      await tx.run('LOCK TABLE users IN EXCLUSIVE MODE');
      if ((await tx.get('SELECT COUNT(*) AS n FROM users')).n > 0) return null;
      const info = await tx.run(
        "INSERT INTO users (email, display_name, password_hash, role, created_at) VALUES (?, ?, ?, 'owner', ?) RETURNING id",
        [parsed.data.email, parsed.data.displayName, hash, Date.now()],
      );
      await audit(tx, { userId: info.id, action: 'user.create', entity: 'user', entityId: info.id, detail: { role: 'owner', source: 'setup' } });
      return info.id;
    });

    if (!created) return res.status(409).json({ error: 'The shop already has an owner. Sign in instead.' });
    res.status(201).json({ ok: true });
  });

  return router;
}
