// Netlify entry point. Every non-static request is redirected here (see netlify.toml).
import serverless from 'serverless-http';
import { createApp } from '../../src/app.js';

const app = createApp();
const toExpress = serverless(app);

const FUNCTION_PREFIX = '/.netlify/functions/server';

export const handler = (event, context) => {
  // The redirect rewrites the path to the function URL; the app expects the original path.
  if (event.path?.startsWith(FUNCTION_PREFIX)) {
    event = { ...event, path: event.path.slice(FUNCTION_PREFIX.length) || '/' };
  }
  return toExpress(event, context);
};
