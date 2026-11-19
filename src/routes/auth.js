import { Router } from 'express';
import { config } from '../config.js';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  requireAuth,
  requireCsrf,
  sessionCookieOptions,
  verifyAgainstDummy,
  verifyPassword,
  hashPassword,
} from '../auth.js';
import { audit } from '../audit.js';
import { loginSchema, parse, passwordChangeSchema } from '../validation.js';

export function authRouter({ db, loginLimiter, passwordLimiter = (req, res, next) => next() }) {
  const router = Router();

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const parsed = parse(loginSchema, req.body);
      // The same generic message is returned for every failure, so attackers learn nothing about accounts.
      const fail = () => res.status(401).json({ error: 'Email or password is incorrect.' });
      if (parsed.error) return fail();

      const { email, password } = parsed.data;
      const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);

      if (!user) {
        await verifyAgainstDummy(password);
        return fail();
      }

      const now = Date.now();
      if (!user.active || (user.locked_until && user.locked_until > now)) {
        await verifyAgainstDummy(password);
        return fail();
      }

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        const failures = user.failed_logins + 1;
        const lockedUntil = failures >= config.maxLoginFailures ? now + config.loginLockMs : null;
        await db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [
          lockedUntil ? 0 : failures,
          lockedUntil,
          user.id,
        ]);
        await audit(db, { userId: user.id, action: 'login.failed', entity: 'user', entityId: user.id });
        return fail();
      }

      // Rotate the session on every successful login (prevents session fixation).
      await destroySession(db, req.cookies?.[SESSION_COOKIE]);
      await db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [now, user.id]);
      const session = await createSession(db, user.id);
      res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions());
      await audit(db, { userId: user.id, action: 'login', entity: 'user', entityId: user.id });

      res.json({
        user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
        csrfToken: session.csrf,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      await destroySession(db, req.cookies?.[SESSION_COOKIE]);
      res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(), maxAge: undefined });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // Returns the current user and the CSRF token the page uses on writes.
  router.get('/me', requireAuth(db), (req, res) => {
    res.json({ user: req.auth.user, csrfToken: req.auth.csrf });
  });

  // Any signed-in user can change their own password. Other sessions of that user are signed out.
  router.post('/password', requireAuth(db), requireCsrf(), passwordLimiter, async (req, res, next) => {
    try {
      const parsed = parse(passwordChangeSchema, req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const userId = req.auth.user.id;
      const row = await db.get('SELECT password_hash FROM users WHERE id = ?', [userId]);
      if (!row || !(await verifyPassword(parsed.data.currentPassword, row.password_hash))) {
        await audit(db, { userId, action: 'password.change_failed', entity: 'user', entityId: userId });
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
      if (parsed.data.currentPassword === parsed.data.newPassword) {
        return res.status(400).json({ error: 'Choose a password different from the current one.' });
      }
      const hash = await hashPassword(parsed.data.newPassword);
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
      await db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [userId, req.auth.tokenHash]);
      await audit(db, { userId, action: 'password.change', entity: 'user', entityId: userId });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post('/ping', requireAuth(db), requireCsrf(), (req, res) => res.json({ ok: true }));

  return router;
}
