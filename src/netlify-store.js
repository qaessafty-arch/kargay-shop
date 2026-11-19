import { getStore } from '@netlify/blobs';

// Photos on Netlify live in Netlify Blobs. Only available inside a Netlify deploy (NETLIFY=true).
export const isNetlify = () => process.env.NETLIFY === 'true';

export function photoStore() {
  return getStore({ name: 'photos', consistency: 'strong' });
}

// Keys look like products/<code>/<24 hex>.webp, gallery/<24 hex>.webp or site/<24 hex>.webp (plus -thumb). Anything else is refused.
export const PHOTO_KEY = /^(products\/\d+|gallery|site)\/[a-f0-9]{24}(-thumb)?\.webp$/;
