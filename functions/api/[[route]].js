/**
 * Cloudflare Pages Function entry (catches every /api/* request).
 * https://developers.cloudflare.com/pages/functions/routing/#dynamic-routes
 *
 * Cloudflare Pages auto-detects the functions/ directory and bundles this
 * file with the Hono app. The entire API therefore runs serverlessly:
 *   - src/index.js defines routes/middleware ONCE (shared with Node).
 *   - This adapter only maps (request, env, ctx) into app.fetch().
 */
import app from '../../src/index.js';

export const onRequest = (context) => app.fetch(context.request, context.env, context.ctx);
