import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { config } from './config.js';
import { getDatabase } from './database.js';
import { uploadsRoot } from './uploads.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { setupRouter } from './routes/setup.js';
import { notFoundHandler, publicRouter, staticRouter } from './routes/public.js';

/** Builds the Express app. Tests pass their own in-memory database. */
export function createApp({ db = getDatabase(), loginLimit = 10 } = {}) {
  const app = express();
  // Behind Vercel/Netlify, trust the first proxy hop so rate limits key on the visitor's IP, not the proxy's.
  if (process.env.VERCEL || process.env.NETLIFY === 'true') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.public.blob.vercel-storage.com'],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          // Only the Google Maps embed in the Location section, and only when the owner has set coordinates.
          frameSrc: ['https://www.google.com'],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const limit = (options) =>
    rateLimit({ standardHeaders: 'draft-7', legacyHeaders: false, ...options, message: { error: 'Too many requests. Try again later.' } });
  const loginLimiter = limit({ windowMs: 15 * 60 * 1000, limit: loginLimit });
  const writeLimiter = limit({ windowMs: 15 * 60 * 1000, limit: 600 });
  const enquiryLimiter = limit({ windowMs: 60 * 1000, limit: 60 });

  // Page routes first, so static folders never answer for them (e.g. the /admin redirect to /admin/).
  app.use(publicRouter({ db, enquiryLimiter }));
  app.use(staticRouter(uploadsRoot));
  const passwordLimiter = limit({ windowMs: 15 * 60 * 1000, limit: loginLimit });
  app.use('/api/auth', authRouter({ db, loginLimiter, passwordLimiter }));
  app.use('/api/setup', setupRouter({ db, limiter: loginLimiter }));
  app.use('/api/admin', adminRouter({ db, writeLimiter }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(notFoundHandler({ db }));

  // Errors: never send stack traces or internal messages to the browser.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 6 MB or smaller.' : 'Too many files or an unexpected field.';
      return res.status(400).json({ error: message });
    }
    if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
      return res.status(400).json({ error: 'Invalid request.' });
    }
    console.error('[server error]', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
