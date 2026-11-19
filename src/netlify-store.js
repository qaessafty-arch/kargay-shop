import { getStore } from '@netlify/blobs';

// Photos on Netlify live in Netlify Blobs. Only available inside a Netlify deploy (NETLIFY=true).
export const isNetlify = () => process.env.NETLIFY === 'true';

export function photoStore() {
  return getStore({ name: 'photos', consistency: 'strong' });
}

// Keys look like products/<code>/<24 hex chars>.webp or ...-thumb.webp. Anything else is refused.
export const PHOTO_KEY = /^products\/\d+\/[a-f0-9]{24}(-thumb)?\.webp$/;
