import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Kept outside public/ so static hosting can never serve the unrendered template.
const TEMPLATE_PATH = path.join(config.root, 'views', 'index.template.html');
let templateCache = null;

/** Reads the page template once; in development it is re-read on every request so edits show immediately. */
function loadTemplate() {
  if (config.isProduction && templateCache) return templateCache;
  templateCache = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return templateCache;
}

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pad2 = (n) => String(n).padStart(2, '0');

/** Builds one product <figure> with exactly the markup the original gallery scripts expect. */
export function renderProductFigure(product, settings) {
  const code = product.code;
  const id = `tile-${pad2(code)}`;
  const size = product.width_cm && product.height_cm ? `${product.width_cm} × ${product.height_cm}` : '';
  const alt = product.description || product.name;
  const fullAttr = product.main_file ? ` data-full="${escapeHtml(product.main_file)}"` : '';
  const extraAttr = product.extra_file ? ` data-extra="${escapeHtml(product.extra_file)}"` : '';
  const src = product.main_thumb || product.main_file || '/img/blank.gif';

  const message = `سڵاو، دەمەوێت زانیاری و نرخی کاشی ژمارە ${code} بزانم`;
  const waUrl = `https://wa.me/${settings.whatsapp_number}?text=${encodeURIComponent(message)}`;
  const price = product.price != null ? `<span class="price">${Number(product.price).toLocaleString('en-US')} ${escapeHtml(settings.currency)}</span>` : '';

  return (
    `<figure${fullAttr} data-full-alt="${escapeHtml(alt)}" id="${id}" data-id="${code}"${extraAttr}>` +
    `<a class="zoom" href="#${id}"><img decoding="async" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="830" height="500" loading="lazy"></a>` +
    `<a class="zx" href="#!">✕ گەڕانەوە</a>` +
    `<figcaption>${escapeHtml(product.name)} ${size ? `<b dir="ltr">${escapeHtml(size)}</b>` : ''} ${price}</figcaption>` +
    `<a class="ask" href="${escapeHtml(waUrl)}" target="_blank" rel="noopener" data-enquiry="${code}">نرخ</a>` +
    `</figure>`
  );
}

/** Renders the public page from the template, the visible products, and the shop settings. */
export function renderHomePage({ products, settings }) {
  const gallery = products.map((p) => renderProductFigure(p, settings)).join('\n');
  const values = {
    '{{PHONE_1}}': settings.phone_primary,
    '{{PHONE_2}}': settings.phone_secondary,
    '{{WA_NUMBER}}': settings.whatsapp_number,
    '{{TIKTOK}}': settings.tiktok_handle,
  };
  let page = loadTemplate().replace('<!--GALLERY-->', gallery || '<p class="lead">No products to show yet.</p>');
  for (const [token, value] of Object.entries(values)) {
    page = page.split(token).join(escapeHtml(value));
  }
  return page;
}
