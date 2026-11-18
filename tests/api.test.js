import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep test uploads out of the real data folder. Must be set before the app modules load.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kargay-test-'));
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.DATABASE_URL;

const { PGlite } = await import('@electric-sql/pglite');
const { createApp } = await import('../src/app.js');
const { Database } = await import('../src/database.js');
const { hashPassword } = await import('../src/auth.js');
const { removeUpload } = await import('../src/uploads.js');
const sharp = (await import('sharp')).default;

let server;
let base;
let db;
const PASSWORD = 'correct-horse-battery';

const owner = { email: 'owner@test.local', password: PASSWORD, role: 'owner' };
const staff = { email: 'staff@test.local', password: PASSWORD, role: 'staff' };

async function call(method, url, { body, cookie, csrf, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie') || '';
  const text = res.status === 204 ? '' : await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json, cookie: setCookie.split(';')[0], setCookie };
}

async function login(account) {
  const res = await call('POST', '/api/auth/login', { body: { email: account.email, password: account.password } });
  assert.equal(res.status, 200, 'login should succeed');
  return { cookie: res.cookie, csrf: res.json.csrfToken };
}

before(async () => {
  db = new Database(new PGlite());
  await db.ready;
  const hash = await hashPassword(PASSWORD);
  const now = Date.now();
  await db.run('INSERT INTO users (email, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', [owner.email, 'Owner', hash, 'owner', now]);
  await db.run('INSERT INTO users (email, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', [staff.email, 'Staff', hash, 'staff', now]);
  await db.run(
    "INSERT INTO products (code, name, description, width_cm, height_cm, visible, sort, created_at, updated_at) VALUES (1, 'کاشیی تاقیکردنەوە', 'test tile', 40, 40, 1, 1, ?, ?)",
    [now, now],
  );
  await db.run("INSERT INTO products (code, name, description, visible, sort, created_at, updated_at) VALUES (2, 'Hidden tile', '', 0, 2, ?, ?)", [now, now]);
  server = createApp({ db, loginLimit: 1000 }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await db?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('public site', () => {
  test('home page renders visible products only, with no placeholders left', async () => {
    const res = await call('GET', '/');
    assert.equal(res.status, 200);
    assert.match(res.text, /id="tile-01"/);
    assert.doesNotMatch(res.text, /tile-02/, 'hidden products must not be published');
    assert.doesNotMatch(res.text, /\{\{[A-Z_0-9]+\}\}/, 'all placeholders are filled');
    assert.doesNotMatch(res.text, /<!--GALLERY-->/);
    assert.match(res.text, /wa\.me\/9647504251661/);
  });

  test('responses carry a strict Content Security Policy and framing protection', async () => {
    const res = await call('GET', '/');
    const csp = res.headers.get('content-security-policy') || '';
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /public\.blob\.vercel-storage\.com/);
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  test('admin page is not indexed', async () => {
    const res = await call('GET', '/admin');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('x-robots-tag') || '', /noindex/);
    assert.match(res.text, /Shop admin/);
  });

  test('enquiry counter increments for a visible product and ignores hidden ones', async () => {
    const before = (await db.get('SELECT enquiry_count AS n FROM products WHERE code = 1')).n;
    assert.equal((await call('POST', '/api/public/products/1/enquiry')).status, 204);
    assert.equal((await db.get('SELECT enquiry_count AS n FROM products WHERE code = 1')).n, before + 1);
    assert.equal((await call('POST', '/api/public/products/2/enquiry')).status, 204);
    assert.equal((await db.get('SELECT enquiry_count AS n FROM products WHERE code = 2')).n, 0);
  });

  test('uploads folder never serves dotfiles', async () => {
    const res = await call('GET', '/uploads/.env');
    assert.equal(res.status, 404);
  });
});

describe('authentication', () => {
  test('wrong password and unknown email return the same generic message', async () => {
    const wrong = await call('POST', '/api/auth/login', { body: { email: owner.email, password: 'wrong-password-here' } });
    const unknown = await call('POST', '/api/auth/login', { body: { email: 'nobody@test.local', password: 'wrong-password-here' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.json.error, unknown.json.error);
  });

  test('login sets an HttpOnly, SameSite=Strict session cookie and returns a CSRF token', async () => {
    const res = await call('POST', '/api/auth/login', { body: { email: owner.email, password: PASSWORD } });
    assert.equal(res.status, 200);
    assert.match(res.setCookie, /kgs_sid=/);
    assert.match(res.setCookie, /HttpOnly/);
    assert.match(res.setCookie, /SameSite=Strict/i);
    assert.ok(res.json.csrfToken.length > 20);
    assert.equal(res.json.user.password_hash, undefined);
  });

  test('account locks after repeated failures, even with the right password', async () => {
    const email = 'lock@test.local';
    await db.run('INSERT INTO users (email, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', [
      email, 'Lock', await hashPassword(PASSWORD), 'staff', Date.now(),
    ]);
    for (let i = 0; i < 5; i++) {
      await call('POST', '/api/auth/login', { body: { email, password: 'bad-password-xx' } });
    }
    const blocked = await call('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(blocked.status, 401);
  });

  test('admin API rejects anonymous requests', async () => {
    assert.equal((await call('GET', '/api/admin/products')).status, 401);
    assert.equal((await call('GET', '/api/admin/stats')).status, 401);
  });

  test('logout ends the session', async () => {
    const session = await login(staff);
    assert.equal((await call('GET', '/api/auth/me', { cookie: session.cookie })).status, 200);
    await call('POST', '/api/auth/logout', { cookie: session.cookie, csrf: session.csrf });
    assert.equal((await call('GET', '/api/auth/me', { cookie: session.cookie })).status, 401);
  });
});

describe('authorisation and CSRF', () => {
  test('writes without the CSRF header are refused', async () => {
    const session = await login(owner);
    const res = await call('POST', '/api/admin/products', { cookie: session.cookie, body: { name: 'No token' } });
    assert.equal(res.status, 403);
  });

  test('writes with a wrong CSRF token are refused', async () => {
    const session = await login(owner);
    const res = await call('POST', '/api/admin/products', { cookie: session.cookie, csrf: 'not-the-token', body: { name: 'Wrong token' } });
    assert.equal(res.status, 403);
  });

  test('staff can create products but cannot delete them or manage users', async () => {
    const session = await login(staff);
    const created = await call('POST', '/api/admin/products', {
      cookie: session.cookie, csrf: session.csrf, body: { name: 'Staff tile', widthCm: 30, heightCm: 30, visible: true },
    });
    assert.equal(created.status, 201);
    const del = await call('DELETE', `/api/admin/products/${created.json.id}`, { cookie: session.cookie, csrf: session.csrf });
    assert.equal(del.status, 403);
    assert.equal((await call('GET', '/api/admin/users', { cookie: session.cookie })).status, 403);
    assert.equal((await call('GET', '/api/admin/audit', { cookie: session.cookie })).status, 403);
  });

  test('owner can soft-delete and restore a product, and deletes are audited', async () => {
    const session = await login(owner);
    const created = await call('POST', '/api/admin/products', { cookie: session.cookie, csrf: session.csrf, body: { name: 'To delete' } });
    const id = created.json.id;
    assert.equal((await call('DELETE', `/api/admin/products/${id}`, { cookie: session.cookie, csrf: session.csrf })).status, 200);
    assert.equal((await db.get('SELECT deleted_at IS NOT NULL AS gone FROM products WHERE id = ?', [id])).gone, true);
    assert.equal((await call('POST', `/api/admin/products/${id}/restore`, { cookie: session.cookie, csrf: session.csrf })).status, 200);
    const audit = await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'product.delete' AND entity_id = ?", [String(id)]);
    assert.equal(audit.n, 1);
  });

  test('a user cannot demote or disable their own account', async () => {
    const session = await login(owner);
    const me = (await db.get('SELECT id FROM users WHERE email = ?', [owner.email])).id;
    const res = await call('PATCH', `/api/admin/users/${me}`, { cookie: session.cookie, csrf: session.csrf, body: { active: false } });
    assert.equal(res.status, 400);
  });
});

describe('validation and uploads', () => {
  test('bad input is rejected with a clear message', async () => {
    const session = await login(owner);
    const res = await call('POST', '/api/admin/products', { cookie: session.cookie, csrf: session.csrf, body: { name: '', widthCm: 9999 } });
    assert.equal(res.status, 400);
    assert.ok(res.json.error);
  });

  test('duplicate product codes are refused', async () => {
    const session = await login(owner);
    const res = await call('POST', '/api/admin/products', { cookie: session.cookie, csrf: session.csrf, body: { code: 1, name: 'Duplicate code' } });
    assert.equal(res.status, 409);
  });

  test('a file that is not an image is rejected even if it claims to be one', async () => {
    const session = await login(owner);
    const product = await call('POST', '/api/admin/products', { cookie: session.cookie, csrf: session.csrf, body: { name: 'Upload test' } });
    const form = new FormData();
    form.append('files', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'evil.png');
    const res = await call('POST', `/api/admin/products/${product.json.id}/images`, { cookie: session.cookie, csrf: session.csrf, form });
    assert.equal(res.status, 400);
  });

  test('a real PNG is accepted, re-encoded to WebP, and appears in the product', async () => {
    const session = await login(owner);
    const product = await call('POST', '/api/admin/products', { cookie: session.cookie, csrf: session.csrf, body: { name: 'Photo test', visible: true } });
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#14306b' } }).png().toBuffer();
    const form = new FormData();
    form.append('files', new Blob([png], { type: 'image/png' }), 'tile.png');
    const res = await call('POST', `/api/admin/products/${product.json.id}/images`, { cookie: session.cookie, csrf: session.csrf, form });
    assert.equal(res.status, 201, res.text);
    const image = res.json.images[0];
    assert.match(image.file, /^\/uploads\/products\/\d+\/[a-f0-9]+\.webp$/);
    assert.ok(fs.existsSync(path.join(tmp, image.file.replace('/uploads/', 'uploads/'))));
    assert.equal((await call('GET', image.file)).status, 200);
  });

  test('removeUpload refuses paths that leave the uploads folder', async () => {
    const outside = path.join(tmp, 'keep-me.txt');
    fs.writeFileSync(outside, 'secret');
    await removeUpload('/uploads/../keep-me.txt');
    await removeUpload('../../keep-me.txt');
    assert.ok(fs.existsSync(outside));
  });
});

describe('orders and settings', () => {
  test('order totals are computed on the server, not trusted from the client', async () => {
    const session = await login(staff);
    const res = await call('POST', '/api/admin/orders', {
      cookie: session.cookie,
      csrf: session.csrf,
      body: {
        customerName: 'Test customer',
        phone: '0750 111 2222',
        items: [{ productName: 'Tile', unitPrice: 5000, qty: 3 }, { productName: 'Paver', unitPrice: 2000, qty: 2 }],
      },
    });
    assert.equal(res.status, 201);
    const order = await call('GET', `/api/admin/orders/${res.json.id}`, { cookie: session.cookie });
    assert.equal(order.json.total, 19000);
  });

  test('only the owner can change settings, and bad values are refused', async () => {
    const staffSession = await login(staff);
    const denied = await call('PUT', '/api/admin/settings', { cookie: staffSession.cookie, csrf: staffSession.csrf, body: { shop_name: 'x' } });
    assert.equal(denied.status, 403);

    const ownerSession = await login(owner);
    const bad = await call('PUT', '/api/admin/settings', { cookie: ownerSession.cookie, csrf: ownerSession.csrf, body: { whatsapp_number: 'not-a-number' } });
    assert.equal(bad.status, 400);
    const ok = await call('PUT', '/api/admin/settings', { cookie: ownerSession.cookie, csrf: ownerSession.csrf, body: { phone_primary: '0750 999 9999' } });
    assert.equal(ok.status, 200);
  });

  test('CSV export neutralises spreadsheet formulas', async () => {
    const session = await login(owner);
    await db.run("INSERT INTO products (code, name, description, visible, sort, created_at, updated_at) VALUES (77, '=HYPERLINK(\"http://x\")', '', 1, 77, ?, ?)", [Date.now(), Date.now()]);
    const res = await call('GET', '/api/admin/products.csv', { cookie: session.cookie });
    assert.equal(res.status, 200);
    assert.match(res.text, /"'=HYPERLINK/);
  });
});

describe('product ordering', () => {
  test('a new product without a sort value is placed after the existing ones', async () => {
    const session = await login(owner);
    const res = await call('POST', '/api/admin/products', { cookie: session.cookie, csrf: session.csrf, body: { name: 'Last one' } });
    assert.equal(res.status, 201);
    const row = await db.get('SELECT code, sort FROM products WHERE id = ?', [res.json.id]);
    assert.equal(row.sort, row.code);
    assert.ok(row.sort > 2);
  });
});
