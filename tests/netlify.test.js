import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Run the Netlify function handler with a throwaway local database.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kargay-netlify-'));
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.NETLIFY;

const { handler } = await import('../netlify/functions/server.mjs');
const { getDatabase } = await import('../src/database.js');

after(async () => {
  await getDatabase().close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function event(urlPath, method = 'GET') {
  return {
    httpMethod: method,
    path: urlPath,
    headers: { host: 'example.netlify.app' },
    multiValueHeaders: {},
    queryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  };
}

test('the function serves the home page through the redirected path', async () => {
  const res = await handler(event('/.netlify/functions/server/'), {});
  assert.equal(res.statusCode, 200);
  const body = res.isBase64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
  assert.match(body, /id="products"/);
});

test('admin API calls keep their auth checks behind the function', async () => {
  const res = await handler(event('/.netlify/functions/server/api/auth/me'), {});
  assert.equal(res.statusCode, 401);
});

test('the media route refuses requests outside a Netlify deploy', async () => {
  const res = await handler(event('/.netlify/functions/server/media/products/1/abcdef0123456789abcdef01.webp'), {});
  assert.equal(res.statusCode, 404);
});
