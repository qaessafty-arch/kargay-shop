// Server-rendered public pages. Every value from the database or settings goes through e() (HTML escaping).
import { LANGS, LANG_META, langPrefix, localized, productNo, settingFor, t } from './i18n.js';
import { availability } from './catalog.js';

export const e = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const DEFAULT_LOGO = '/assets/brand-logo.jpg';
const DEFAULT_HERO = '/assets/hero.jpg';

/** Everything a page needs to know about the request: language, URLs and shop settings. */
export function makeContext({ lang, settings, siteUrl, path }) {
  const defaultLang = LANGS.includes(settings.default_language) ? settings.default_language : 'ku';
  const prefix = langPrefix(lang, defaultLang);
  return {
    lang,
    dir: LANG_META[lang].dir,
    settings,
    siteUrl,
    defaultLang,
    prefix,
    path, // path without the language prefix, e.g. "/", "/products/7", "/gallery"
    home: prefix ? `${prefix}/` : '/',
    shopName: settingFor(settings, 'shop_name', lang),
    logo: settings.logo_url || DEFAULT_LOGO,
    hero: settings.hero_url || DEFAULT_HERO,
    tr: (key, vars) => t(lang, key, vars),
  };
}

const abs = (ctx, url) => (/^https?:\/\//.test(url) ? url : `${ctx.siteUrl}${url}`);
const urlFor = (ctx, lang, path) => `${langPrefix(lang, ctx.defaultLang)}${path}` || '/';

export function waLink(ctx, message) {
  return `https://wa.me/${ctx.settings.whatsapp_number}?text=${encodeURIComponent(message)}`;
}

function sizeText(ctx, p) {
  return p.width_cm && p.height_cm ? `${p.width_cm} × ${p.height_cm}` : '';
}

function productUrl(ctx, p) {
  return `${ctx.prefix}/products/${p.code}`;
}

function productMessage(ctx, p) {
  const size = sizeText(ctx, p);
  const text = ctx.tr('wa.product', {
    name: ctx.shopName,
    code: productNo(p.code),
    product: localized(p, 'name', ctx.lang),
    size: size ? ctx.tr('wa.size', { size: `${size} ${ctx.tr('cm')}` }) : '',
  });
  return `${text}\n${abs(ctx, productUrl(ctx, p))}`;
}

function money(ctx, value) {
  return `${Number(value).toLocaleString('en-US')} ${ctx.settings.currency}`;
}

// ---------- Icons (one inline sprite per page, referenced with <use>) ----------
const ICONS = {
  wa: '<path fill="currentColor" stroke="none" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.59-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.18-1.41-.08-.13-.28-.2-.58-.35M12.05 21.78h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88a9.82 9.82 0 0 1 6.99 2.9 9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.43 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.16-3.48-8.41z"/>',
  tt: '<path fill="currentColor" stroke="none" d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03a10.7 10.7 0 0 1-5.82-1.9c-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>',
  fb: '<path fill="currentColor" stroke="none" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.62 23.1 24 18.1 24 12.07"/>',
  ig: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.6" cy="6.4" r="1" fill="currentColor" stroke="none"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  factory: '<path d="M2 21V10l6 4V10l6 4V6l8 5v10z"/><path d="M2 21h20"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

const icon = (name, cls = '') => `<svg class="ic${cls ? ` ${cls}` : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

const sprite = () =>
  `<svg width="0" height="0" class="sprite" aria-hidden="true"><defs>${Object.entries(ICONS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`)
    .join('')}</defs></svg>`;

// ---------- Structured data ----------
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

function businessLd(ctx) {
  const s = ctx.settings;
  const sameAs = [s.facebook_url, s.instagram_url, tiktokUrl(s)].filter(Boolean);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${ctx.siteUrl}/#business`,
    name: ctx.shopName,
    alternateName: [s.shop_name, s.shop_name_ar, s.shop_name_en].filter((n) => n && n !== ctx.shopName),
    url: abs(ctx, ctx.home),
    logo: abs(ctx, ctx.logo),
    image: abs(ctx, ctx.hero),
    description: s[`seo_description_${ctx.lang}`],
    foundingDate: s.founded_year,
    telephone: phoneHref(s.phone_primary).replace('tel:', ''),
    address: {
      '@type': 'PostalAddress',
      addressLocality: settingFor(s, 'address', ctx.lang),
      addressRegion: ctx.tr('location.region'),
      addressCountry: 'IQ',
    },
  };
  if (s.map_lat && s.map_lng) data.geo = { '@type': 'GeoCoordinates', latitude: Number(s.map_lat), longitude: Number(s.map_lng) };
  if (sameAs.length) data.sameAs = sameAs;
  return data;
}

function tiktokUrl(s) {
  const handle = (s.tiktok_handle || '').trim().replace(/^@/, '');
  return handle ? `https://www.tiktok.com/@${encodeURIComponent(handle)}` : '';
}

/** Iraqi numbers like 0750 425 1661 become tel:+9647504251661. */
function phoneHref(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('964')) return `tel:+${digits}`;
  if (digits.startsWith('0')) return `tel:+964${digits.slice(1)}`;
  return `tel:+${digits}`;
}

// ---------- Layout ----------
function head(ctx, { title, description, image, type = 'website', noindex = false, ld = [] }) {
  const canonical = abs(ctx, urlFor(ctx, ctx.lang, ctx.path));
  const alternates = LANGS.map((l) => `<link rel="alternate" hreflang="${LANG_META[l].hreflang}" href="${e(abs(ctx, urlFor(ctx, l, ctx.path)))}">`).join('');
  const ogAlt = LANGS.filter((l) => l !== ctx.lang).map((l) => `<meta property="og:locale:alternate" content="${LANG_META[l].ogLocale}">`).join('');
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<link rel="canonical" href="${e(canonical)}">
${alternates}<link rel="alternate" hreflang="x-default" href="${e(abs(ctx, urlFor(ctx, ctx.defaultLang, ctx.path)))}">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${e(ctx.shopName)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(canonical)}">
<meta property="og:image" content="${e(abs(ctx, image))}">
<meta property="og:locale" content="${LANG_META[ctx.lang].ogLocale}">${ogAlt}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">
<meta name="twitter:image" content="${e(abs(ctx, image))}">
<meta name="theme-color" content="#141414">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="${e(ctx.logo)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/css/site.css?v=3">
${[businessLd(ctx), ...ld].map(jsonLd).join('\n')}`;
}

function langSwitch(ctx, cls) {
  return `<nav class="${cls}" aria-label="${e(ctx.tr('nav.language'))}">${LANGS.map((l) => {
    const current = l === ctx.lang;
    return `<a href="${e(urlFor(ctx, l, ctx.path))}" hreflang="${LANG_META[l].hreflang}" lang="${LANG_META[l].html}" data-set-lang="${l}"${current ? ' aria-current="true"' : ''}>${e(LANG_META[l].label)}</a>`;
  }).join('')}</nav>`;
}

function siteHeader(ctx, { overlay }) {
  const onHome = ctx.path === '/';
  const anchor = (id) => (onHome ? `#${id}` : `${ctx.home}#${id}`);
  return `<header class="site-header${overlay ? ' is-overlay' : ''}">
<div class="wrap header-row">
<a class="brand" href="${e(ctx.home)}"><img src="${e(ctx.logo)}" alt="" width="40" height="40"><span>${e(ctx.shopName)}</span></a>
<nav class="header-nav" aria-label="${e(ctx.tr('nav.menu'))}">
<a href="${e(anchor('products'))}">${e(ctx.tr('nav.products'))}</a>
<a href="${e(anchor('about'))}">${e(ctx.tr('nav.about'))}</a>
<a href="${e(`${ctx.prefix}/gallery`)}">${e(ctx.tr('nav.gallery'))}</a>
<a href="${e(anchor('contact'))}">${e(ctx.tr('nav.contact'))}</a>
</nav>
${langSwitch(ctx, 'lang-switch header-lang')}
<a class="menu-btn" href="#menu" data-menu-open aria-controls="menu" aria-expanded="false">${icon('menu')}<span>${e(ctx.tr('nav.menu'))}</span></a>
</div>
</header>`;
}

function hasSocial(s) {
  return Boolean(s.facebook_url || s.instagram_url || s.tiktok_handle || s.whatsapp_number);
}

function menuPanel(ctx) {
  const onHome = ctx.path === '/';
  const anchor = (id) => (onHome ? `#${id}` : `${ctx.home}#${id}`);
  const items = [
    [ctx.home, 'home', 'nav.home'],
    [anchor('products'), 'grid', 'nav.products'],
    [anchor('about'), 'info', 'nav.about'],
    [anchor('why'), 'check', 'nav.why'],
    [`${ctx.prefix}/gallery`, 'image', 'nav.gallery'],
    [anchor('location'), 'pin', 'nav.location'],
    [anchor('contact'), 'chat', 'nav.contact'],
    hasSocial(ctx.settings) ? [anchor('social'), 'share', 'nav.social'] : null,
  ].filter(Boolean);
  return `<div class="menu" id="menu" role="dialog" aria-modal="true" aria-label="${e(ctx.tr('nav.menu'))}">
<div class="menu-inner">
<div class="menu-top"><span class="menu-title">${e(ctx.tr('nav.menu'))}</span><a class="menu-close" href="#" data-menu-close>${icon('close')}<span>${e(ctx.tr('nav.close'))}</span></a></div>
<nav class="menu-list">${items.map(([href, ic, key]) => `<a href="${e(href)}">${icon(ic)}<span>${e(ctx.tr(key))}</span></a>`).join('')}</nav>
<div class="menu-lang"><span class="menu-lang-label">${e(ctx.tr('nav.language'))}</span>${langSwitch(ctx, 'lang-switch lang-blocks')}</div>
</div>
</div>`;
}

function siteFooter(ctx) {
  const s = ctx.settings;
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
<div class="wrap footer-row">
<div class="footer-brand"><img src="${e(ctx.logo)}" alt="" width="36" height="36"><div><strong>${e(ctx.shopName)}</strong><span>${e(ctx.tr('footer.since', { year: s.founded_year }))} · ${e(settingFor(s, 'address', ctx.lang))}</span></div></div>
<nav class="footer-nav"><a href="${e(`${ctx.home}#products`)}">${e(ctx.tr('nav.products'))}</a><a href="${e(`${ctx.prefix}/gallery`)}">${e(ctx.tr('nav.gallery'))}</a><a href="${e(`${ctx.home}#contact`)}">${e(ctx.tr('nav.contact'))}</a></nav>
<p class="footer-copy">© <span dir="ltr">${year}</span> ${e(ctx.shopName)}</p>
</div>
</footer>`;
}

function layout(ctx, { meta, body, overlay = false, bodyClass = '' }) {
  return `<!doctype html>
<html lang="${LANG_META[ctx.lang].html}" dir="${ctx.dir}" class="no-js" data-lang="${ctx.lang}" data-prefix="${e(ctx.prefix)}">
<head>
${head(ctx, meta)}
</head>
<body class="lang-${ctx.lang}${bodyClass ? ` ${bodyClass}` : ''}" data-t-close="${e(ctx.tr('viewer.close'))}" data-t-prev="${e(ctx.tr('viewer.prev'))}" data-t-next="${e(ctx.tr('viewer.next'))}" data-t-viewer="${e(ctx.tr('viewer.label'))}">
${sprite()}
<a class="skip" href="#main">${e(ctx.tr('skip'))}</a>
${siteHeader(ctx, { overlay })}
${menuPanel(ctx)}
<main id="main">
${body}
</main>
${siteFooter(ctx)}
<a class="wa-float" href="${e(waLink(ctx, ctx.tr('wa.general', { name: ctx.shopName })))}" target="_blank" rel="noopener" aria-label="${e(ctx.tr('cta.floating'))}">${icon('wa')}</a>
<script src="/js/site.js?v=3" defer></script>
<script src="/js/viewer.js?v=3" defer></script>
</body>
</html>`;
}

// ---------- Product card ----------
function statusBadge(ctx, p) {
  const state = availability(p);
  const key = { available: 'status.available', out: 'status.out', ask: 'status.ask' }[state];
  return `<span class="status status-${state}">${e(ctx.tr(key))}</span>`;
}

function searchText(p, categories) {
  const cat = categories.get(p.category_id);
  return [
    p.code, productNo(p.code), p.name, p.name_ar, p.name_en, p.description, p.description_ar, p.description_en,
    cat?.name, cat?.name_ar, cat?.name_en, p.width_cm && p.height_cm ? `${p.width_cm}x${p.height_cm}` : '',
  ].filter(Boolean).join(' ');
}

function productCard(ctx, p, categories) {
  const name = localized(p, 'name', ctx.lang);
  const size = sizeText(ctx, p);
  const url = productUrl(ctx, p);
  const img = p.main_thumb || p.main_file;
  const state = availability(p);
  return `<article class="card" data-code="${p.code}" data-cat="${p.category_id ?? ''}" data-size="${e(size ? `${p.width_cm}x${p.height_cm}` : '')}" data-search="${e(searchText(p, categories))}">
<a class="card-media" href="${e(url)}" tabindex="-1" aria-hidden="true">${img ? `<img class="fade" src="${e(img)}" alt="" width="600" height="600" loading="lazy" decoding="async">` : ''}<span class="badge" dir="ltr">${productNo(p.code)}</span></a>
<div class="card-body">
<h3 class="card-title"><a href="${e(url)}">${e(name)}</a></h3>
<div class="card-meta">${size ? `<span class="size"><span dir="ltr">${e(size)}</span> ${e(ctx.tr('cm'))}</span>` : ''}${statusBadge(ctx, p)}</div>
${p.price != null ? `<p class="price" dir="ltr">${e(money(ctx, p.price))}</p>` : ''}
<div class="card-actions">
<a class="btn btn-ghost" href="${e(url)}">${e(ctx.tr('card.details'))}</a>
<a class="btn btn-wa" href="${e(waLink(ctx, productMessage(ctx, p)))}" target="_blank" rel="noopener" data-enquiry="${p.code}">${icon('wa')}<span>${e(ctx.tr(state === 'available' ? 'card.ask' : 'card.askPrice'))}</span></a>
</div>
</div>
</article>`;
}

// ---------- Home ----------
export function homePage(ctx, { products, categories, gallery }) {
  const s = ctx.settings;
  const catMap = new Map(categories.map((c) => [c.id, c]));
  // Categories that have products, in the admin's display order; ties go to the category with more products.
  const countIn = (c) => products.filter((p) => p.category_id === c.id).length;
  const usedCats = categories.filter((c) => countIn(c) > 0).sort((a, b) => a.sort - b.sort || countIn(b) - countIn(a));
  const sizes = [...new Set(products.filter((p) => p.width_cm && p.height_cm).map((p) => `${p.width_cm}x${p.height_cm}`))].sort((a, b) => {
    const area = (v) => v.split('x').reduce((x, y) => x * y, 1);
    return area(b) - area(a) || a.localeCompare(b);
  });
  const year = Number(s.founded_year) || 2013;
  const experience = Math.max(1, new Date().getFullYear() - year);
  const aboutImage = (gallery.find((g) => g.featured) || gallery[0])?.file || ctx.hero;
  const waGeneral = waLink(ctx, ctx.tr('wa.general', { name: ctx.shopName }));

  const chip = (filter, value, label, on) =>
    `<button type="button" class="chip${on ? ' is-on' : ''}" data-filter="${filter}" data-value="${e(value)}" aria-pressed="${on}">${label}</button>`;

  const filters = products.length
    ? `<div class="filters" hidden>
<div class="search-box">${icon('search')}<input type="search" id="q" placeholder="${e(ctx.tr('products.search'))}" aria-label="${e(ctx.tr('products.searchLabel'))}" autocomplete="off" enterkeyhint="search"><button type="button" class="search-clear" data-clear hidden>${e(ctx.tr('products.clear'))}</button></div>
${usedCats.length > 1 ? `<div class="chip-row" role="group" aria-label="${e(ctx.tr('products.category'))}"><span class="chip-label">${e(ctx.tr('products.category'))}</span>${chip('cat', '', e(ctx.tr('products.all')), true)}${usedCats.map((c) => chip('cat', c.id, e(localized(c, 'name', ctx.lang)), false)).join('')}</div>` : ''}
${sizes.length > 1 ? `<div class="chip-row" role="group" aria-label="${e(ctx.tr('products.size'))}"><span class="chip-label">${e(ctx.tr('products.size'))}</span>${chip('size', '', e(ctx.tr('products.all')), true)}${sizes.map((v) => chip('size', v, `<span dir="ltr">${e(v.replace('x', ' × '))}</span>`, false)).join('')}</div>` : ''}
<p class="result-count" aria-live="polite" data-template="${e(ctx.tr('products.count'))}" data-total="${products.length}">${e(ctx.tr('products.count', { n: products.length, total: products.length }))}</p>
</div>`
    : '';

  const grid = products.length
    ? `<div class="grid" id="product-grid">${products.map((p) => productCard(ctx, p, catMap)).join('\n')}</div>
<div class="empty" hidden><h3>${e(ctx.tr('products.emptyTitle'))}</h3><p>${e(ctx.tr('products.emptyText'))}</p><button type="button" class="btn btn-ghost" data-reset>${e(ctx.tr('products.reset'))}</button></div>`
    : `<div class="empty"><p>${e(ctx.tr('products.none'))}</p></div>`;

  const why = [
    ['calendar', 'why.since', { year, n: experience }],
    ['layers', 'why.special', {}],
    ['ruler', 'why.sizes', { designs: products.length, sizes: sizes.length }],
    ['chat', 'why.direct', {}],
    ['factory', 'why.local', {}],
    ['user', 'why.service', {}],
  ].filter(([, key]) => key !== 'why.sizes' || products.length);

  const body = `
<section class="hero">
<img class="hero-img" src="${e(ctx.hero)}" alt="" fetchpriority="high" decoding="async">
<div class="wrap hero-content">
<p class="eyebrow">${e(ctx.tr('hero.label'))}</p>
<h1>${e(ctx.tr('hero.title'))}</h1>
<p class="hero-text">${e(ctx.tr('hero.text', { year }))}</p>
<div class="hero-actions">
<a class="btn btn-wa btn-lg" href="${e(waGeneral)}" target="_blank" rel="noopener">${icon('wa')}<span>${e(ctx.tr('cta.whatsapp'))}</span></a>
<a class="btn btn-outline btn-lg" href="#products">${e(ctx.tr('cta.products'))}</a>
</div>
</div>
</section>

<section class="section" id="products" aria-labelledby="products-title">
<div class="wrap">
<div class="section-head"><h2 id="products-title">${e(ctx.tr('products.title'))}</h2><p>${e(ctx.tr('products.lead'))}</p></div>
<div id="catalog">${filters}${grid}</div>
</div>
</section>

<section class="section section-alt" id="about" aria-labelledby="about-title">
<div class="wrap about">
<div class="about-text">
<h2 id="about-title">${e(ctx.tr('about.title'))}</h2>
<p>${e(ctx.tr('about.p1', { name: ctx.shopName, year }))}</p>
<p>${e(ctx.tr('about.p2'))}</p>
<p>${e(ctx.tr('about.p3'))}</p>
<dl class="facts">
<div><dt>${e(ctx.tr('about.fact.since'))}</dt><dd dir="ltr">${year}</dd></div>
<div><dt>${e(ctx.tr('about.fact.place'))}</dt><dd>${e(settingFor(s, 'address', ctx.lang))}</dd></div>
${products.length ? `<div><dt>${e(ctx.tr('about.fact.products'))}</dt><dd dir="ltr">${products.length}</dd></div>` : ''}
</dl>
</div>
<figure class="about-media"><img class="fade" src="${e(aboutImage)}" alt="${e(ctx.tr('gallery.workshop'))}" loading="lazy" decoding="async"></figure>
</div>
</section>

<section class="section" id="why" aria-labelledby="why-title">
<div class="wrap">
<div class="section-head"><h2 id="why-title">${e(ctx.tr('why.title', { name: ctx.shopName }))}</h2></div>
<ul class="why-grid">${why.map(([ic, key, vars]) => `<li>${icon(ic)}<h3>${e(ctx.tr(`${key}.t`, vars))}</h3><p>${e(ctx.tr(`${key}.d`, vars))}</p></li>`).join('')}</ul>
</div>
</section>

${gallery.length ? `<section class="section section-alt" id="gallery" aria-labelledby="gallery-title">
<div class="wrap">
<div class="section-head section-head-row"><h2 id="gallery-title">${e(ctx.tr('gallery.workshop'))}</h2><a class="link-arrow" href="${e(`${ctx.prefix}/gallery`)}">${e(ctx.tr('gallery.more'))} ${icon('arrow', 'flip-rtl')}</a></div>
<div class="photo-grid">${gallery.slice(0, 6).map((g, i) => photoTile(ctx, g, i, 'home')).join('')}</div>
</div>
</section>` : ''}

${locationSection(ctx)}
${contactSection(ctx)}`;

  return layout(ctx, {
    overlay: true,
    bodyClass: 'page-home',
    meta: {
      title: s[`seo_title_${ctx.lang}`] || ctx.shopName,
      description: s[`seo_description_${ctx.lang}`] || '',
      image: ctx.hero,
    },
    body,
  });
}

function photoTile(ctx, g, index, group) {
  const caption = localized(g, 'caption', ctx.lang);
  return `<a class="photo" href="${e(g.file)}" data-viewer="${group}" data-caption="${e(caption)}"><img class="fade" src="${e(g.thumb || g.file)}" alt="${e(caption || ctx.tr('product.photo', { n: index + 1 }))}" loading="lazy" decoding="async"></a>`;
}

function locationSection(ctx) {
  const s = ctx.settings;
  const hasCoords = s.map_lat && s.map_lng;
  const directions = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${s.map_lat},${s.map_lng}`)}`
    : s.map_url;
  return `<section class="section" id="location" aria-labelledby="location-title">
<div class="wrap location${hasCoords ? '' : ' no-map'}">
<div class="location-card">
<h2 id="location-title">${e(ctx.tr('location.title'))}</h2>
<p class="location-place">${icon('pin')}<span><strong>${e(settingFor(s, 'address', ctx.lang))}</strong><br>${e(ctx.tr('location.region'))}</span></p>
<div class="location-actions">
${directions ? `<a class="btn btn-accent" href="${e(directions)}" target="_blank" rel="noopener">${e(ctx.tr(hasCoords ? 'location.directions' : 'location.open'))}</a>` : ''}
${hasCoords && s.map_url ? `<a class="btn btn-ghost" href="${e(s.map_url)}" target="_blank" rel="noopener">${e(ctx.tr('location.open'))}</a>` : ''}
</div>
</div>
${hasCoords ? `<div class="map"><iframe title="${e(ctx.tr('location.mapTitle'))}" src="https://www.google.com/maps?q=${encodeURIComponent(`${s.map_lat},${s.map_lng}`)}&amp;z=15&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>` : ''}
</div>
</section>`;
}

function contactSection(ctx) {
  const s = ctx.settings;
  const wa = waLink(ctx, ctx.tr('wa.general', { name: ctx.shopName }));
  const phones = [s.phone_primary, s.phone_secondary].filter(Boolean);
  const socials = [
    s.facebook_url ? [s.facebook_url, 'fb', 'Facebook'] : null,
    s.instagram_url ? [s.instagram_url, 'ig', 'Instagram'] : null,
    tiktokUrl(s) ? [tiktokUrl(s), 'tt', `TikTok · ${s.tiktok_handle}`] : null,
    s.whatsapp_number ? [wa, 'wa', ctx.tr('contact.whatsapp')] : null,
  ].filter(Boolean);
  return `<section class="section section-alt" id="contact" aria-labelledby="contact-title">
<div class="wrap contact">
<div class="section-head"><h2 id="contact-title">${e(ctx.tr('contact.title'))}</h2><p>${e(ctx.tr('contact.lead'))}</p></div>
<div class="contact-grid">
<a class="contact-item contact-wa" href="${e(wa)}" target="_blank" rel="noopener">${icon('wa')}<span><small>${e(ctx.tr('contact.whatsapp'))}</small><strong dir="ltr">${e(s.phone_primary)}</strong></span></a>
${phones.map((p) => `<a class="contact-item" href="${e(phoneHref(p))}">${icon('phone')}<span><small>${e(ctx.tr('contact.phone'))}</small><strong dir="ltr">${e(p)}</strong></span></a>`).join('')}
<div class="contact-item">${icon('pin')}<span><small>${e(ctx.tr('contact.address'))}</small><strong>${e(settingFor(s, 'address', ctx.lang))}</strong></span></div>
</div>
${socials.length ? `<div class="social" id="social"><h3>${e(ctx.tr('social.title'))}</h3><div class="social-links">${socials.map(([href, ic, label]) => `<a href="${e(href)}" target="_blank" rel="noopener">${icon(ic)}<span>${e(label)}</span></a>`).join('')}</div></div>` : ''}
</div>
</section>`;
}

// ---------- Product page ----------
export function productPage(ctx, { product: p, images, related, categories, preview }) {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const name = localized(p, 'name', ctx.lang);
  const description = localized(p, 'description', ctx.lang);
  const size = sizeText(ctx, p);
  const state = availability(p);
  const cat = catMap.get(p.category_id);
  const pics = images.length ? images : [];
  const main = pics[0];
  const metaDescription = [name, size ? `${size} ${ctx.tr('cm')}` : '', description, ctx.shopName].filter(Boolean).join(' · ');

  const names = LANGS.map((l) => [l, localized(p, 'name', l)]).filter(([l, n]) => n && (l === 'ku' || p[`name_${l}`]));

  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    sku: String(p.code),
    productID: productNo(p.code),
    url: abs(ctx, productUrl(ctx, p)),
    image: pics.map((img) => abs(ctx, img.file)),
    description: description || name,
    category: cat ? localized(cat, 'name', ctx.lang) : undefined,
    brand: { '@type': 'Brand', name: ctx.shopName },
    manufacturer: { '@id': `${ctx.siteUrl}/#business` },
  };
  if (p.width_cm) productLd.width = { '@type': 'QuantitativeValue', value: p.width_cm, unitCode: 'CMT' };
  if (p.height_cm) productLd.depth = { '@type': 'QuantitativeValue', value: p.height_cm, unitCode: 'CMT' };
  if (p.price != null) {
    productLd.offers = {
      '@type': 'Offer',
      price: p.price,
      priceCurrency: ctx.settings.currency,
      availability: state === 'out' ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      url: abs(ctx, productUrl(ctx, p)),
    };
  }
  const crumbsLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: ctx.tr('nav.home'), item: abs(ctx, ctx.home) },
      { '@type': 'ListItem', position: 2, name: ctx.tr('nav.products'), item: abs(ctx, `${ctx.home}#products`) },
      { '@type': 'ListItem', position: 3, name },
    ],
  };

  const body = `
${preview ? `<div class="preview-bar">${e(ctx.tr('product.preview'))}</div>` : ''}
<div class="wrap product-page">
<nav class="crumbs" aria-label="breadcrumb"><a href="${e(ctx.home)}">${e(ctx.tr('nav.home'))}</a><span aria-hidden="true">/</span><a href="${e(`${ctx.home}#products`)}">${e(ctx.tr('nav.products'))}</a><span aria-hidden="true">/</span><span aria-current="page">${e(name)}</span></nav>
<div class="product-layout">
<div class="product-gallery">
<a class="product-main" href="${e(main?.file || '#')}" data-viewer="product" data-index="0">${main ? `<img class="fade" src="${e(main.file)}" srcset="${e(main.thumb)} 830w, ${e(main.file)} 1600w" sizes="(min-width: 960px) 560px, 100vw" alt="${e(name)}" width="800" height="800" decoding="async">` : ''}<span class="badge" dir="ltr">${productNo(p.code)}</span></a>
${pics.length > 1 ? `<div class="thumbs">${pics.map((img, i) => `<a href="${e(img.file)}" class="thumb${i === 0 ? ' is-on' : ''}" data-viewer="product" data-index="${i}" data-thumb="${e(img.thumb)}" aria-label="${e(ctx.tr('product.photo', { n: i + 1 }))}"><img src="${e(img.thumb)}" alt="" loading="lazy" decoding="async"></a>`).join('')}</div>` : ''}
</div>
<div class="product-info">
<p class="eyebrow" dir="ltr">${productNo(p.code)}</p>
<h1>${e(name)}</h1>
<div class="product-status">${statusBadge(ctx, p)}${p.price != null ? `<span class="price-lg" dir="ltr">${e(money(ctx, p.price))}</span>` : ''}</div>
${p.price != null ? `<p class="note">${e(ctx.tr('product.priceNote'))}</p>` : ''}
<a class="btn btn-wa btn-lg btn-block" href="${e(waLink(ctx, productMessage(ctx, p)))}" target="_blank" rel="noopener" data-enquiry="${p.code}">${icon('wa')}<span>${e(ctx.tr(state === 'available' ? 'product.ask' : 'product.askPrice'))}</span></a>
<dl class="specs">
<div><dt>${e(ctx.tr('product.no'))}</dt><dd dir="ltr">${productNo(p.code)}</dd></div>
${size ? `<div><dt>${e(ctx.tr('product.size'))}</dt><dd><span dir="ltr">${e(size)}</span> ${e(ctx.tr('cm'))}</dd></div>` : ''}
${cat ? `<div><dt>${e(ctx.tr('product.category'))}</dt><dd>${e(localized(cat, 'name', ctx.lang))}</dd></div>` : ''}
<div><dt>${e(ctx.tr('product.availability'))}</dt><dd>${statusBadge(ctx, p)}</dd></div>
</dl>
${description ? `<h2 class="h-sm">${e(ctx.tr('product.description'))}</h2><p class="product-desc">${e(description)}</p>` : ''}
${names.length > 1 ? `<h2 class="h-sm">${e(ctx.tr('product.names'))}</h2><dl class="names">${names.map(([l, n]) => `<div><dt>${e(LANG_META[l].label)}</dt><dd lang="${LANG_META[l].html}" dir="${LANG_META[l].dir}">${e(n)}</dd></div>`).join('')}</dl>` : ''}
<a class="link-arrow back" href="${e(`${ctx.home}#products`)}">${icon('arrow', 'flip-ltr')} ${e(ctx.tr('product.back'))}</a>
</div>
</div>
${related.length ? `<section class="related" aria-labelledby="related-title"><h2 id="related-title">${e(ctx.tr('product.related'))}</h2><div class="grid">${related.map((r) => productCard(ctx, r, catMap)).join('\n')}</div></section>` : ''}
</div>`;

  return layout(ctx, {
    bodyClass: 'page-product',
    meta: {
      title: `${name} ${productNo(p.code)} · ${ctx.shopName}`,
      description: metaDescription.slice(0, 300),
      image: main?.file || ctx.hero,
      type: 'product',
      noindex: preview,
      ld: [productLd, crumbsLd],
    },
    body,
  });
}

// ---------- Gallery page ----------
export function galleryPage(ctx, { gallery, products }) {
  const productPhotos = products.filter((p) => p.main_file);
  const body = `
<div class="wrap page-head"><h1>${e(ctx.tr('gallery.title'))}</h1><p>${e(ctx.tr('gallery.lead'))}</p></div>
${gallery.length ? `<section class="section section-tight"><div class="wrap"><h2>${e(ctx.tr('gallery.workshop'))}</h2><div class="photo-grid">${gallery.map((g, i) => photoTile(ctx, g, i, 'workshop')).join('')}</div></div></section>` : ''}
${productPhotos.length ? `<section class="section section-tight"><div class="wrap"><h2>${e(ctx.tr('gallery.products'))}</h2><div class="photo-grid">${productPhotos
    .map((p) => `<a class="photo" href="${e(p.main_file)}" data-viewer="products" data-caption="${e(`${productNo(p.code)} · ${localized(p, 'name', ctx.lang)}`)}"><img class="fade" src="${e(p.main_thumb || p.main_file)}" alt="${e(localized(p, 'name', ctx.lang))}" loading="lazy" decoding="async"><span class="badge" dir="ltr">${productNo(p.code)}</span></a>`)
    .join('')}</div></div></section>` : ''}
${!gallery.length && !productPhotos.length ? `<div class="wrap"><div class="empty"><p>${e(ctx.tr('products.none'))}</p></div></div>` : ''}`;
  return layout(ctx, {
    bodyClass: 'page-gallery',
    meta: {
      title: `${ctx.tr('gallery.title')} · ${ctx.shopName}`,
      description: `${ctx.tr('gallery.lead')} ${ctx.settings[`seo_description_${ctx.lang}`] || ''}`.trim(),
      image: gallery[0]?.file || ctx.hero,
    },
    body,
  });
}

// ---------- 404 ----------
export function notFoundPage(ctx) {
  return layout(ctx, {
    bodyClass: 'page-404',
    meta: { title: `${ctx.tr('notFound.title')} · ${ctx.shopName}`, description: ctx.tr('notFound.text'), image: ctx.hero, noindex: true },
    body: `<div class="wrap page-head not-found"><h1>${e(ctx.tr('notFound.title'))}</h1><p>${e(ctx.tr('notFound.text'))}</p><a class="btn btn-accent" href="${e(ctx.home)}">${e(ctx.tr('notFound.home'))}</a></div>`,
  });
}
