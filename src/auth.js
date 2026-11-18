import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

export const SESSION_COOKIE = 'kgs_sid';
const BCRYPT_COST = 12;

// A real bcrypt hash of a random string, compared against when the email is unknown,
// so response time does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), BCRYPT_COST);

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function verifyAgainstDummy(password) {
  return bcrypt.compare(password, DUMMY_HASH).then(() => false);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Creates a session row and returns the raw token (only ever sent to the browser as a cookie). */
export async function createSession(db, userId) {
  const token = randomToken();
  const csrf = randomToken(24);
  const now = Date.now();
  await db.run(
    'INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [sha256(token), userId, csrf, now, now, now + config.sessionMaxMs],
  );
  return { token, csrf };
}

export async function destroySession(db, token) {
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
}

/** Looks up a live session. Expired or idle sessions are removed. Returns { user, csrf } or null. */
export async function loadSession(db, token) {
  if (!token) return null;
  const row = await db.get(
    `SELECT s.token_hash, s.csrf_token, s.last_seen_at, s.expires_at,
            u.id AS user_id, u.email, u.display_name, u.role, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [sha256(token)],
  );
  if (!row) return null;

  const now = Date.now();
  const idle = now - row.last_seen_at > config.sessionIdleMs;
  if (idle || now > row.expires_at || !row.active) {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', [row.token_hash]);
    return null;
  }
  await db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [now, row.token_hash]);
  return {
    user: { id: row.user_id, email: row.email, displayName: row.display_name, role: row.role },
    csrf: row.csrf_token,
    tokenHash: row.token_hash,
  };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionMaxMs,
  };
}

/** Requires a logged-in user. Attaches req.auth = { user, csrf, tokenHash }. */
export function requireAuth(db) {
  return async (req, res, next) => {
    try {
      const session = await loadSession(db, req.cookies?.[SESSION_COOKIE]);
      if (!session) {
        return res.status(401).json({ error: 'Please sign in.' });
      }
      req.auth = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Requires one of the given roles. Must run after requireAuth. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.user.role)) {
      return res.status(403).json({ error: 'You do not have permission for this action.' });
    }
    next();
  };
}

/** Double-submit style CSRF check: the X-CSRF-Token header must match the token stored with the session. */
export function requireCsrf() {
  return (req, res, next) => {
    const sent = req.get('x-csrf-token') || '';
    const expected = req.auth?.csrf || '';
    const ok =
      sent.length > 0 &&
      sent.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
    if (!ok) {
      return res.status(403).json({ error: 'Security check failed. Reload the page and try again.' });
    }
    next();
  };
}
