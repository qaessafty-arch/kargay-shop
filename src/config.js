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
  // Iraq is UTC+3 all year (no daylight saving); used for "this month" totals.
  shopUtcOffsetMinutes: Number(process.env.SHOP_UTC_OFFSET_MINUTES ?? 180),
  // Public address used in links shared on social media; defaults to the address the visitor used.
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
  // Shop defaults, used for any setting the owner has not saved yet.
  // Empty social links and map coordinates mean "not set": the site hides them instead of guessing.
  shopDefaults: {
    shop_name: 'کارگەی شرێ',
    shop_name_ar: 'كارگە شري',
    shop_name_en: 'Kargay Shre',
    phone_primary: '0750 425 1661',
    phone_secondary: '0750 704 1661',
    whatsapp_number: '9647504251661',
    tiktok_handle: '@kargay.barzan.shree',
    facebook_url: '',
    instagram_url: '',
    address: 'بارزان شرێ',
    address_ar: 'بارزان شري',
    address_en: 'Barzan Shre',
    map_url: 'https://maps.app.goo.gl/K9aP98xdT16n9Cbf8',
    map_lat: '',
    map_lng: '',
    founded_year: '2013',
    currency: 'IQD',
    default_language: 'ku',
    logo_url: '',
    hero_url: '',
    seo_title_ku: 'کارگەی شرێ · کاشیی باخچە و حەوشە',
    seo_title_ar: 'كارگە شري | بلاط الحدائق والساحات',
    seo_title_en: 'Kargay Shre | Garden & Courtyard Tiles',
    seo_description_ku: 'کارگەی کاشیی باخچە و حەوشە لە بارزان شرێ، هەر لە ساڵی 2013. وێنە و قەبارەی کاشییەکان ببینە و لە واتسئاپ پرسیار بکە.',
    seo_description_ar: 'مصنع بلاط الحدائق والساحات في بارزان شري منذ عام 2013. تصفح صور ومقاسات البلاط واسأل عبر واتساب.',
    seo_description_en: 'Explore garden and courtyard tiles manufactured in Barzan Shre since 2013. See photos and sizes, and ask for prices on WhatsApp.',
  },
};
