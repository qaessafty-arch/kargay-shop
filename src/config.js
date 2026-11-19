import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProduction = process.env.NODE_ENV === 'production';

/**
 * The pg driver already treats sslmode=require as verify-full (certificate checked) and logs a warning about it.
 * Spell that out so the behaviour stays the same and the log stays clean.
 */
function normalizeSslMode(url) {
  return url.replace(/([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/, '$1verify-full');
}

export const config = {
  root,
  port: Number(process.env.PORT || 3000),
  isProduction,
  // Cookies are Secure in production (HTTPS only). Set COOKIE_SECURE=false only for plain-HTTP local testing.
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== 'false' : isProduction,
  // Set TRUST_PROXY=1 when running behind one reverse proxy (needed for correct client IPs in rate limits).
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  // Neon Postgres connection string (Vercel sets it when you add Neon). Local dev can leave it empty.
  databaseUrl: normalizeSslMode(process.env.DATABASE_URL || ''),
  // Public address used in links shared on social media; defaults to the address the visitor used.
  // Iraq is UTC+3 all year (no daylight saving); used for "this month" totals.
  shopUtcOffsetMinutes: Number(process.env.SHOP_UTC_OFFSET_MINUTES ?? 180),
  siteUrl: (process.env.SITE_URL || '').replace(/\/+$/, ''),
  localDatabaseDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data'), 'pglite'),
  // Vercel Blob token (set by Vercel when you add Blob). Without it, photos are saved to the data folder.
  blobToken: process.env.BLOB_READ_WRITE_TOKEN || '',
  publicDir: path.join(root, 'public'),
  sessionIdleMs: 2 * 60 * 60 * 1000,
  sessionMaxMs: 12 * 60 * 60 * 1000,
  maxLoginFailures: 5,
  loginLockMs: 15 * 60 * 1000,
  maxUploadBytes: 6 * 1024 * 1024,
  maxUploadFiles: 8,
  // Shop defaults, used only when the settings table is empty (first run).
  shopDefaults: {
    shop_name: 'کارگەی شرێ',
    phone_primary: '0750 425 1661',
    phone_secondary: '0750 704 1661',
    whatsapp_number: '9647504251661',
    tiktok_handle: '@kargay.barzan.shree',
    address: 'بارزان شرێ',
    founded_year: '2013',
    currency: 'IQD',
  },
};
