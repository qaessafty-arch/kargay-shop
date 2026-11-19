import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { del, put } from '@vercel/blob';
import { config } from './config.js';
import { PHOTO_KEY, isNetlify, photoStore } from './netlify-store.js';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAIN_MAX_SIDE = 1600;
const THUMB_WIDTH = 830;
const MAX_INPUT_PIXELS = 40_000_000;

export const uploadsRoot = path.join(config.dataDir, 'uploads');

/**
 * Validates an uploaded image by decoding it (not by trusting the file name or MIME type),
 * strips metadata, and stores a full-size WebP and a thumbnail.
 * On Vercel the files go to Vercel Blob (public URLs). Locally they go to the data folder.
 * Returns { file, thumb } as URLs.
 */
export function storeProductImage(buffer, productCode) {
  return storeImage(buffer, `products/${Number(productCode)}`);
}

/** Same as storeProductImage, for a fixed folder: `products/<code>`, `gallery` or `site`. */
export async function storeImage(buffer, folder) {
  if (!/^(products\/\d+|gallery|site)$/.test(folder)) throw new Error('Invalid photo folder.');
  const meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).metadata();
  if (!ALLOWED_FORMATS.has(meta.format)) {
    throw new Error('Only JPEG, PNG or WebP images are allowed.');
  }

  const main = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: MAIN_MAX_SIDE, height: MAIN_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();
  const thumb = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: THUMB_WIDTH, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const id = crypto.randomBytes(12).toString('hex');
  const mainName = `${id}.webp`;
  const thumbName = `${id}-thumb.webp`;

  if (config.blobToken) {
    const mainBlob = await put(`${folder}/${mainName}`, main, {
      access: 'public',
      contentType: 'image/webp',
      addRandomSuffix: false,
      token: config.blobToken,
    });
    const thumbBlob = await put(`${folder}/${thumbName}`, thumb, {
      access: 'public',
      contentType: 'image/webp',
      addRandomSuffix: false,
      token: config.blobToken,
    });
    return { file: mainBlob.url, thumb: thumbBlob.url };
  }

  if (isNetlify()) {
    const toBytes = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const store = photoStore();
    await store.set(`${folder}/${mainName}`, toBytes(main), { metadata: { contentType: 'image/webp' } });
    await store.set(`${folder}/${thumbName}`, toBytes(thumb), { metadata: { contentType: 'image/webp' } });
    return { file: `/media/${folder}/${mainName}`, thumb: `/media/${folder}/${thumbName}` };
  }

  if (config.isProduction) {
    throw new Error('Photo storage is not configured. Add the Vercel Blob or Netlify Blobs store to the project.');
  }

  const dir = path.join(uploadsRoot, ...folder.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, mainName), main);
  fs.writeFileSync(path.join(dir, thumbName), thumb);
  const base = `/uploads/${folder}`;
  return { file: `${base}/${mainName}`, thumb: `${base}/${thumbName}` };
}

/** Removes a stored photo. Local files must stay inside the uploads folder; Blob URLs are deleted via the SDK. */
export async function removeUpload(url) {
  if (!url) return;
  if (url.startsWith('https://') && config.blobToken) {
    await del(url, { token: config.blobToken }).catch(() => {});
    return;
  }
  if (url.startsWith('/media/') && isNetlify()) {
    const key = url.slice('/media/'.length);
    if (PHOTO_KEY.test(key)) await photoStore().delete(key).catch(() => {});
    return;
  }
  if (!url.startsWith('/uploads/')) return;
  const absolute = path.resolve(config.dataDir, url.replace(/^\/uploads\//, 'uploads/'));
  if (!absolute.startsWith(uploadsRoot + path.sep)) return;
  fs.rm(absolute, { force: true }, () => {});
}
