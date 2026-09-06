/**
 * Cloudflare Pages Function entry for legacy GET /health (no /api prefix).
 * Keeps backward compatibility with v1 of this project and lets uptime
 * monitors hit https://<project>.pages.dev/health directly.
 */
import app from '../src/index.js';

export const onRequest = (context) => app.fetch(context.request, context.env, context.ctx);
