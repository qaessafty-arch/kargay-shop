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
    assert.match(res.text, /data-code="1"/);
    assert.doesNotMatch(res.text, /data-code="2"/, 'hidden products must not be published');
    assert.match(res.text, /href="\/products\/1"/);
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

describe('first-run setup', () => {
  test('setup is off unless the server has a setup code', async () => {
    delete process.env.SETUP_TOKEN;
    const status = await call('GET', '/api/setup/status');
    assert.equal(status.json.setupEnabled, false);
    const res = await call('POST', '/api/setup/owner', { body: { token: 'x', email: 'new@test.local', displayName: 'New', password: PASSWORD } });
    assert.equal(res.status, 404);
  });

  test('a wrong setup code is refused', async () => {
    process.env.SETUP_TOKEN = 'correct-setup-code-1234567890';
    const res = await call('POST', '/api/setup/owner', { body: { token: 'wrong-code', email: 'new@test.local', displayName: 'New', password: PASSWORD } });
    assert.equal(res.status, 403);
    delete process.env.SETUP_TOKEN;
  });

  test('setup cannot create a second owner once the shop has an account', async () => {
    process.env.SETUP_TOKEN = 'correct-setup-code-1234567890';
    const status = await call('GET', '/api/setup/status');
    assert.equal(status.json.needsOwner, false);
    const res = await call('POST', '/api/setup/owner', {
      body: { token: 'correct-setup-code-1234567890', email: 'intruder@test.local', displayName: 'Intruder', password: PASSWORD },
    });
    assert.equal(res.status, 409);
    assert.equal(await db.get('SELECT id FROM users WHERE email = ?', ['intruder@test.local']), undefined);
    delete process.env.SETUP_TOKEN;
  });
});

describe('original products import', () => {
  test('staff cannot run the import', async () => {
    const session = await login(staff);
    const res = await call('POST', '/api/admin/import-legacy', { cookie: session.cookie, csrf: session.csrf });
    assert.equal(res.status, 403);
  });

  test('the owner imports a batch with photos, and repeating it does not duplicate products', async () => {
    const session = await login(owner);
    const before = await call('GET', '/api/admin/import-legacy', { cookie: session.cookie });
    assert.equal(before.json.total, 37);
    const first = await call('POST', '/api/admin/import-legacy', { cookie: session.cookie, csrf: session.csrf });
    assert.equal(first.status, 200, first.text);
    assert.ok(first.json.imported > 0);
    assert.equal(first.json.failed.length, 0);
    const after = await call('GET', '/api/admin/import-legacy', { cookie: session.cookie });
    assert.equal(after.json.remaining, before.json.remaining - first.json.imported);
    const photos = await db.get('SELECT COUNT(*) AS n FROM product_images');
    assert.ok(photos.n >= first.json.imported);
    const dupes = await db.get('SELECT COUNT(*) AS n FROM (SELECT code FROM products GROUP BY code HAVING COUNT(*) > 1) d');
    assert.equal(dupes.n, 0);
  });
});

describe('page sources', () => {
  test('the unrendered template and admin page are not inside the static folder', () => {
    assert.equal(fs.existsSync(path.join(process.cwd(), 'public', 'index.template.html')), false);
    assert.equal(fs.existsSync(path.join(process.cwd(), 'public', 'admin', 'index.html')), false);
  });

  test('the admin page is served with the security headers', async () => {
    const res = await call('GET', '/admin');
    assert.match(res.headers.get('content-security-policy') || '', /script-src 'self'/);
  });
});

describe('database setup', () => {
  test('schema setup can run again safely on an existing database', async () => {
    await db.migrate();
    await db.migrate();
    assert.ok((await db.get('SELECT COUNT(*) AS n FROM settings')).n >= 8);
  });
});

describe('shop features', () => {
  test('the page uses real categories, marks sold-out items, and shows featured items first', async () => {
    const { cookie, csrf } = await login(owner);
    const cat = await call('POST', '/api/admin/categories', { cookie, csrf, body: { name: 'ڕەسیف', nameAr: 'رصيف', nameEn: 'Curbs' } });
    assert.equal(cat.status, 201);
    const created = await call('POST', '/api/admin/products', {
      cookie, csrf,
      body: { code: 70, name: 'Featured curb', nameEn: 'Featured curb EN', categoryId: cat.json.id, stock: 0, visible: true, featured: true, sort: 999 },
    });
    assert.equal(created.status, 201, created.text);
    const page = (await call('GET', '/')).text;
    assert.match(page, new RegExp(`data-code="70" data-cat="${cat.json.id}"`));
    assert.match(page, /class="status status-out"/);
    assert.ok(page.indexOf('data-code="70"') < page.indexOf('data-code="1"'), 'featured products come first');
    assert.match(page, /<html lang="ku" dir="rtl"/);
    assert.match(page, /<meta property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/assets\/hero\.jpg">/);
    assert.equal((page.match(/<\/body>/g) || []).length, 1, 'the page has one body');
    const english = (await call('GET', '/en/')).text;
    assert.match(english, />Curbs</, 'categories are translated');
    assert.match(english, /Featured curb EN/);
  });

  test('sitemap, robots, favicon and health check answer', async () => {
    const sitemap = await call('GET', '/sitemap.xml');
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.text, /<loc>http:\/\/127\.0\.0\.1:\d+\/<\/loc>/);
    assert.match((await call('GET', '/robots.txt')).text, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
    const icon = await call('GET', '/favicon.ico');
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get('content-type'), /image\//);
    const health = await call('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.json, { ok: true });
  });

  test('confirming an order takes stock, cancelling gives it back, once each', async () => {
    const { cookie, csrf } = await login(staff);
    const p = await call('POST', '/api/admin/products', { cookie, csrf, body: { code: 71, name: 'Stocked tile', stock: 10 } });
    const order = await call('POST', '/api/admin/orders', {
      cookie, csrf,
      body: { customerName: 'Stock Test', phone: '0750 111 2233', items: [{ productId: p.json.id, productName: 'Stocked tile', qty: 4, unitPrice: 1000 }] },
    });
    assert.equal(order.status, 201, order.text);
    const stock = async () => (await call('GET', `/api/admin/products/${p.json.id}`, { cookie })).json.stock;
    const setStatus = (status) => call('PATCH', `/api/admin/orders/${order.json.id}/status`, { cookie, csrf, body: { status } });

    assert.equal(await stock(), 10, 'a pending order does not touch stock');
    assert.equal((await setStatus('confirmed')).status, 200);
    assert.equal(await stock(), 6);
    await setStatus('delivered');
    assert.equal(await stock(), 6, 'confirmed then delivered takes stock only once');
    await setStatus('cancelled');
    assert.equal(await stock(), 10);
    await setStatus('cancelled');
    assert.equal(await stock(), 10, 'cancelling twice does not add stock twice');
  });

  test('orders can be found by name, phone digits or number', async () => {
    const { cookie } = await login(staff);
    const byPhone = await call('GET', '/api/admin/orders?q=7501112233', { cookie });
    assert.ok(byPhone.json.items.some((o) => o.customer_name === 'Stock Test'));
    const byName = await call('GET', '/api/admin/orders?q=stock%20te', { cookie });
    assert.ok(byName.json.items.some((o) => o.customer_name === 'Stock Test'));
    const none = await call('GET', '/api/admin/orders?q=nobody-here', { cookie });
    assert.equal(none.json.items.length, 0);
  });

  test('a user changes their own password; the old one stops working and other sessions end', async () => {
    const account = { email: 'changer@test.local', password: PASSWORD };
    await db.run('INSERT INTO users (email, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)', [
      account.email, 'Changer', await hashPassword(PASSWORD), 'staff', Date.now(),
    ]);
    const first = await login(account);
    const second = await login(account);
    const wrong = await call('POST', '/api/auth/password', { ...first, body: { currentPassword: 'nope', newPassword: 'a-brand-new-password' } });
    assert.equal(wrong.status, 400);
    const short = await call('POST', '/api/auth/password', { ...first, body: { currentPassword: PASSWORD, newPassword: 'short' } });
    assert.equal(short.status, 400);
    const noCsrf = await call('POST', '/api/auth/password', { cookie: first.cookie, body: { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' } });
    assert.equal(noCsrf.status, 403);
    const ok = await call('POST', '/api/auth/password', { ...first, body: { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await call('GET', '/api/auth/me', { cookie: first.cookie })).status, 200, 'the current session stays signed in');
    assert.equal((await call('GET', '/api/auth/me', { cookie: second.cookie })).status, 401, 'other sessions are signed out');
    const old = await call('POST', '/api/auth/login', { body: { email: account.email, password: PASSWORD } });
    assert.equal(old.status, 401);
    await login({ email: account.email, password: 'a-brand-new-password' });
  });

  test('"this month" starts at midnight on the 1st in Iraq time', async () => {
    const { monthStartMs } = await import('../src/routes/admin.js');
    // 22:30 UTC on 31 Jan is already 1 Feb in Baghdad (UTC+3).
    const start = monthStartMs(new Date(Date.UTC(2026, 0, 31, 22, 30)), 180);
    assert.equal(new Date(start).toISOString(), '2026-01-31T21:00:00.000Z');
  });
});

describe('multilingual showroom', () => {
  const png = () => sharp({ create: { width: 80, height: 60, channels: 3, background: '#777777' } }).png().toBuffer();

  test('each language has its own address, direction, title, description and hreflang links', async () => {
    const ku = (await call('GET', '/')).text;
    const ar = (await call('GET', '/ar/')).text;
    const en = (await call('GET', '/en/')).text;
    assert.match(ku, /<html lang="ku" dir="rtl"/);
    assert.match(ar, /<html lang="ar" dir="rtl"/);
    assert.match(en, /<html lang="en" dir="ltr"/);
    assert.match(ku, /<title>کارگەی شرێ · کاشیی باخچە و حەوشە<\/title>/);
    assert.match(ar, /<title>كارگە شري \| بلاط الحدائق والساحات<\/title>/);
    assert.match(en, /<title>Kargay Shre \| Garden &amp; Courtyard Tiles<\/title>/);
    assert.match(en, /<meta property="og:title" content="Kargay Shre \| Garden &amp; Courtyard Tiles">/);
    assert.match(en, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/en\/">/);
    for (const page of [ku, ar, en]) {
      assert.match(page, /hreflang="ku" href="http:\/\/127\.0\.0\.1:\d+\/"/);
      assert.match(page, /hreflang="ar" href="http:\/\/127\.0\.0\.1:\d+\/ar\/"/);
      assert.match(page, /hreflang="en" href="http:\/\/127\.0\.0\.1:\d+\/en\/"/);
      assert.match(page, /"@type":"LocalBusiness"/);
    }
    assert.match(en, /Contact us on WhatsApp/);
    assert.match(ar, /تواصل معنا عبر واتساب/);
  });

  test('the default language lives at the root; /ku/ redirects there; a remembered language is restored', async () => {
    const res = await call('GET', '/ku/products/1');
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), '/products/1');
    const remembered = await call('GET', '/', { cookie: 'lang=en' });
    assert.equal(remembered.status, 302);
    assert.equal(remembered.headers.get('location'), '/en/');
  });

  test('every product has its own page with structured data and a prefilled WhatsApp message', async () => {
    const page = await call('GET', '/en/products/1');
    assert.equal(page.status, 200);
    assert.match(page.text, /"@type":"Product"/);
    assert.match(page.text, /"@type":"BreadcrumbList"/);
    assert.match(page.text, /<meta property="og:type" content="product">/);
    const wa = page.text.match(/href="(https:\/\/wa\.me\/[^"]+)"[^>]*data-enquiry="1"/);
    assert.ok(wa, 'product WhatsApp link');
    const message = decodeURIComponent(wa[1].split('?text=')[1].replace(/&amp;/g, '&'));
    assert.match(message, /product #001/);
    assert.match(message, /size 40 × 40 cm/);
    assert.match(message, /\/en\/products\/1$/);
    assert.equal((await call('GET', '/products/0001')).headers.get('location'), '/products/1');
  });

  test('hidden products are 404 for visitors and previewable for signed-in staff only', async () => {
    assert.equal((await call('GET', '/products/2')).status, 404);
    assert.equal((await call('GET', '/products/2?preview')).status, 404);
    const { cookie } = await login(staff);
    const preview = await call('GET', '/products/2?preview', { cookie });
    assert.equal(preview.status, 200);
    assert.match(preview.text, /<meta name="robots" content="noindex,nofollow">/);
    assert.equal(preview.headers.get('x-robots-tag'), 'noindex, nofollow');
  });

  test('unknown pages get a friendly page in the right language', async () => {
    const res = await call('GET', '/en/nothing-here');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.text, /Page not found/);
  });

  test('the sitemap lists every page in every language with alternates', async () => {
    const xml = (await call('GET', '/sitemap.xml')).text;
    assert.match(xml, /<loc>http:\/\/127\.0\.0\.1:\d+\/en\/products\/1<\/loc>/);
    assert.match(xml, /<loc>http:\/\/127\.0\.0\.1:\d+\/ar\/gallery<\/loc>/);
    assert.match(xml, /xhtml:link rel="alternate" hreflang="ar"/);
    assert.doesNotMatch(xml, /\/products\/2</, 'hidden products are not listed');
  });

  test('settings refuse unsafe links; social links appear only when set', async () => {
    const { cookie, csrf } = await login(owner);
    const bad = await call('PUT', '/api/admin/settings', { cookie, csrf, body: { facebook_url: 'javascript:alert(1)' } });
    assert.equal(bad.status, 400);
    const halfMap = await call('PUT', '/api/admin/settings', { cookie, csrf, body: { map_lat: '36.9', map_lng: '' } });
    assert.equal(halfMap.status, 400);
    assert.doesNotMatch((await call('GET', '/')).text, /facebook\.com/);
    const ok = await call('PUT', '/api/admin/settings', { cookie, csrf, body: { facebook_url: 'https://www.facebook.com/kargay.test', seo_title_en: 'Custom English title' } });
    assert.equal(ok.status, 200, ok.text);
    const page = (await call('GET', '/en/')).text;
    assert.match(page, /https:\/\/www\.facebook\.com\/kargay\.test/);
    assert.match(page, /<title>Custom English title<\/title>/);
    await call('PUT', '/api/admin/settings', { cookie, csrf, body: { facebook_url: '', seo_title_en: 'Kargay Shre | Garden & Courtyard Tiles' } });
  });

  test('workshop gallery: upload, caption in three languages, reorder, delete', async () => {
    const { cookie, csrf } = await login(staff);
    const form = new FormData();
    form.append('files', new Blob([await png()], { type: 'image/png' }), 'a.png');
    form.append('files', new Blob([await png()], { type: 'image/png' }), 'b.png');
    const up = await call('POST', '/api/admin/gallery', { cookie, csrf, form });
    assert.equal(up.status, 201, up.text);
    assert.equal(up.json.items.length, 2);
    const [first, second] = up.json.items;
    assert.match(first.file, /^\/uploads\/gallery\/[a-f0-9]{24}\.webp$/);
    const patched = await call('PATCH', `/api/admin/gallery/${second.id}`, { cookie, csrf, body: { caption: 'وێنە', captionEn: 'Workshop', featured: true } });
    assert.equal(patched.status, 200);
    const ordered = await call('PUT', '/api/admin/gallery/order', { cookie, csrf, body: { ids: [second.id, first.id] } });
    assert.deepEqual(ordered.json.items.map((g) => g.id), [second.id, first.id]);
    const galleryPage = (await call('GET', '/en/gallery')).text;
    assert.match(galleryPage, /data-caption="Workshop"/);
    assert.match((await call('GET', '/en/')).text, /id="gallery"/, 'the home page shows a gallery section once photos exist');
    const removed = await call('DELETE', `/api/admin/gallery/${first.id}`, { cookie, csrf });
    assert.equal(removed.json.items.length, 1);
    assert.equal((await call('PUT', '/api/admin/gallery/order', { cookie, csrf, body: { ids: [999] } })).status, 400);
  });

  test('only the owner can replace the logo; the page uses the new one', async () => {
    const staffSession = await login(staff);
    const form = () => {
      const f = new FormData();
      return png().then((buf) => { f.append('file', new Blob([buf], { type: 'image/png' }), 'logo.png'); return f; });
    };
    assert.equal((await call('POST', '/api/admin/settings/images/logo', { ...staffSession, form: await form() })).status, 403);
    const { cookie, csrf } = await login(owner);
    const res = await call('POST', '/api/admin/settings/images/logo', { cookie, csrf, form: await form() });
    assert.equal(res.status, 200, res.text);
    assert.match(res.json.logo_url, /^\/uploads\/site\/[a-f0-9]{24}-thumb\.webp$/);
    assert.match((await call('GET', '/')).text, new RegExp(`src="${res.json.logo_url}"`));
    const reset = await call('DELETE', '/api/admin/settings/images/logo', { cookie, csrf });
    assert.equal(reset.json.logo_url, '');
  });

  test('the dashboard reports availability, categories, recent products and activity', async () => {
    const { cookie } = await login(owner);
    const stats = (await call('GET', '/api/admin/stats', { cookie })).json;
    for (const key of ['products', 'available', 'outOfStock', 'categories']) assert.equal(typeof stats[key], 'number', key);
    assert.ok(stats.recentProducts.length > 0);
    assert.ok(stats.activity.length > 0);
    const staffStats = (await call('GET', '/api/admin/stats', await login(staff))).json;
    assert.deepEqual(staffStats.activity, [], 'staff do not see the audit trail');
  });

  test('a product can be saved with names in three languages and only changed fields are updated', async () => {
    const { cookie, csrf } = await login(staff);
    const created = await call('POST', '/api/admin/products', { cookie, csrf, body: { code: 80, name: 'ناو', nameAr: 'اسم', nameEn: 'Name', description: 'وەسف' } });
    assert.equal(created.status, 201);
    await call('PATCH', `/api/admin/products/${created.json.id}`, { cookie, csrf, body: { price: 9000 } });
    const p = (await call('GET', `/api/admin/products/${created.json.id}`, { cookie })).json;
    assert.equal(p.nameAr, 'اسم');
    assert.equal(p.description, 'وەسف', 'a partial update keeps the other fields');
    assert.equal(p.availability, 'available');
  });
});

describe('AI Studio', () => {
  const png = (w = 120, h = 90) => sharp({ create: { width: w, height: h, channels: 3, background: '#808080' } }).png().toBuffer();
  const json = (method, url, body, key) => {
    const headers = { 'content-type': 'application/json' };
    if (key) headers['x-project-key'] = key;
    return fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  };

  test('the Studio page renders in each language with its data, and the product needs a texture to be offered', async () => {
    for (const [path, lang] of [['/studio', 'ku'], ['/ar/studio', 'ar'], ['/en/studio', 'en']]) {
      const res = await call('GET', path);
      assert.equal(res.status, 200, path);
      const data = JSON.parse(res.text.match(/<script type="application\/json" id="studio-data">([\s\S]*?)<\/script>/)[1]);
      assert.equal(data.lang, lang);
      assert.ok(data.strings['st.title']);
      assert.ok(Array.isArray(data.products));
    }
    const { cookie, csrf } = await login(owner);
    const p = await call('POST', '/api/admin/products', { cookie, csrf, body: { code: 90, name: 'Studio tile', widthCm: 40, heightCm: 40, vizEnabled: true } });
    const form = new FormData();
    form.append('file', new Blob([await png(256, 256)], { type: 'image/png' }), 't.png');
    const tex = await call('POST', `/api/admin/products/${p.json.id}/texture`, { cookie, csrf, form });
    assert.equal(tex.status, 200, tex.text);
    assert.match(tex.json.textureUrl, /^\/uploads\/products\/90\/[a-f0-9]{24}\.webp$/);
    const texture = await call('GET', '/api/studio/textures/90');
    assert.equal(texture.status, 200);
    assert.match(texture.headers.get('content-type'), /image\/webp/);
    assert.equal((await call('GET', '/api/studio/textures/1')).status, 404, 'no texture, no preview');
    assert.match((await call('GET', '/en/products/90')).text, /href="\/en\/studio\?product=90"/);
  });

  test('projects need consent; the owner key is required for every read and change', async () => {
    const refused = await json('POST', '/api/studio/projects', { consent: false });
    assert.equal(refused.status, 400);
    const created = await (await json('POST', '/api/studio/projects', { consent: true, lang: 'en', description: 'Front yard', data: { productCode: 90 } })).json();
    assert.match(created.ref, /^KS-\d{4}$/);
    assert.ok(created.key.length >= 30);
    assert.equal((await json('GET', `/api/studio/projects/${created.id}`)).status, 404, 'no key');
    assert.equal((await json('GET', `/api/studio/projects/${created.id}`, null, 'x'.repeat(32))).status, 404, 'wrong key');
    const ok = await json('GET', `/api/studio/projects/${created.id}`, null, created.key);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).description, 'Front yard');
    const row = await db.get('SELECT owner_hash FROM studio_projects WHERE id = ?', [created.id]);
    assert.notEqual(row.owner_hash, created.key, 'only a hash of the key is stored');
  });

  test('saved photos are re-encoded with location metadata removed and served only with the key', async () => {
    const created = await (await json('POST', '/api/studio/projects', { consent: true })).json();
    const withGps = await sharp({ create: { width: 200, height: 150, channels: 3, background: '#a0a0a0' } })
      .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '36/1 50/1 0/1' } })
      .jpeg().toBuffer();
    assert.ok((await sharp(withGps).metadata()).exif, 'test photo starts with EXIF');
    const form = new FormData();
    form.append('original', new Blob([withGps], { type: 'image/jpeg' }), 'o.jpg');
    form.append('result', new Blob([await png()], { type: 'image/png' }), 'r.png');
    form.append('mask', new Blob([await png()], { type: 'image/png' }), 'm.png');
    form.append('data', JSON.stringify({ rect: { length: 4, width: 3 } }));
    const put = await fetch(`${base}/api/studio/projects/${created.id}/views/0`, { method: 'PUT', headers: { 'x-project-key': created.key }, body: form });
    assert.equal(put.status, 200, await put.text());
    const noKey = await fetch(`${base}/api/studio/projects/${created.id}/views/0/original`);
    assert.equal(noKey.status, 404);
    const img = await fetch(`${base}/api/studio/projects/${created.id}/views/0/original`, { headers: { 'x-project-key': created.key } });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('cache-control'), 'private, no-store');
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    assert.equal(meta.exif, undefined, 'EXIF (including GPS) is removed');
    const tooMany = await fetch(`${base}/api/studio/projects/${created.id}/views/9`, { method: 'PUT', headers: { 'x-project-key': created.key }, body: form });
    assert.equal(tooMany.status, 400);
  });

  test('share links are signed, expire, and show a private noindex page', async () => {
    const created = await (await json('POST', '/api/studio/projects', { consent: true, lang: 'ar' })).json();
    const share = await (await json('POST', `/api/studio/projects/${created.id}/share`, null, created.key)).json();
    assert.match(share.path, /^\/studio\/v\/\d+\.\d{13}\.[A-Za-z0-9_-]{32}$/);
    const page = await call('GET', share.path);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(page.text, /<html lang="ar"/);
    assert.match(page.text, new RegExp(created.ref));
    const tampered = share.path.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    assert.equal((await call('GET', tampered)).status, 404);
    const otherProject = share.path.replace(/\/v\/\d+\./, `/v/${created.id + 1000}.`);
    assert.equal((await call('GET', otherProject)).status, 404, 'the signature covers the project id');
    const { createShareToken, verifyShareToken } = await import('../src/studio.js');
    const expired = await createShareToken(db, created.id, -1);
    assert.equal(await verifyShareToken(db, expired.token), null);
  });

  test('customers can report a problem and delete their project; expired projects are purged', async () => {
    const created = await (await json('POST', '/api/studio/projects', { consent: true })).json();
    assert.equal((await json('POST', `/api/studio/projects/${created.id}/report`, { message: 'The pool was tiled' }, created.key)).status, 201);
    const { cookie } = await login(staff);
    const reports = await call('GET', '/api/admin/studio/reports', { cookie });
    assert.ok(reports.json.items.some((r) => r.message === 'The pool was tiled'));
    assert.equal((await json('DELETE', `/api/studio/projects/${created.id}`, null, created.key)).status, 200);
    assert.equal(await db.get('SELECT id FROM studio_projects WHERE id = ?', [created.id]), undefined);
    const old = await (await json('POST', '/api/studio/projects', { consent: true })).json();
    await db.run('UPDATE studio_projects SET expires_at = ? WHERE id = ?', [Date.now() - 1000, old.id]);
    await json('POST', '/api/studio/projects', { consent: true });
    assert.equal(await db.get('SELECT id FROM studio_projects WHERE id = ?', [old.id]), undefined);
  });

  test('shop staff see projects and can verify measurements; only the owner deletes', async () => {
    const created = await (await json('POST', '/api/studio/projects', { consent: true, data: { productCode: 90, area: 24, tiles: 163 } })).json();
    const staffSession = await login(staff);
    const list = await call('GET', '/api/admin/studio/projects', { cookie: staffSession.cookie });
    const item = list.json.items.find((p) => p.id === created.id);
    assert.equal(item.area, 24);
    const verify = await call('PATCH', `/api/admin/studio/projects/${created.id}`, { ...staffSession, body: { measurementStatus: 'verified' } });
    assert.equal(verify.status, 200);
    assert.equal((await call('DELETE', `/api/admin/studio/projects/${created.id}`, staffSession)).status, 403);
    assert.equal((await call('GET', `/api/admin/studio/projects/${created.id}`)).status, 401, 'anonymous');
    const ownerSession = await login(owner);
    assert.equal((await call('DELETE', `/api/admin/studio/projects/${created.id}`, ownerSession)).status, 200);
  });

  test('usage events accept only known kinds; turning the Studio off hides it everywhere', async () => {
    await json('POST', '/api/studio/events', { kind: 'quote', productId: 1 });
    await json('POST', '/api/studio/events', { kind: 'drop table' });
    const kinds = (await db.all('SELECT DISTINCT kind FROM studio_events')).map((r) => r.kind);
    assert.ok(kinds.includes('quote'));
    assert.ok(!kinds.includes('drop table'));
    const { cookie, csrf } = await login(owner);
    assert.equal((await call('PUT', '/api/admin/settings', { cookie, csrf, body: { studio_enabled: '0' } })).status, 200);
    assert.equal((await call('GET', '/en/studio')).status, 404);
    assert.doesNotMatch((await call('GET', '/en/')).text, /\/en\/studio/);
    assert.equal((await json('POST', '/api/studio/projects', { consent: true })).status, 404);
    await call('PUT', '/api/admin/settings', { cookie, csrf, body: { studio_enabled: '1' } });
  });
});
