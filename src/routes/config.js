/**
 * GET /api/v1/config   (public — no auth, like /health)
 *
 * Runtime configuration endpoint. The docs site calls this from the browser
 * so every page always displays the CURRENT server settings:
 *
 *   - apiBaseUrl : auto-detected from the incoming request (works on
 *                  localhost, *.pages.dev, or any custom domain — no config).
 *   - version    : from the APP_VERSION env var (single source of truth).
 *   - appName    : from the APP_NAME env var.
 *   - failover   : automatic provider failover status.
 *   - providers  : which providers are configured right now.
 *
 * Change the value in .env / Cloudflare dashboard and this endpoint (plus
 * every page that reads it) updates immediately after deploy.
 */
import { listProviders } from '../providers/registry.js';

export function configHandler(c) {
  const cfg = c.get('config');

  // Auto-detect the public base URL from the request itself.
  let apiBaseUrl = '';
  try {
    apiBaseUrl = new URL(c.req.url).origin;
  } catch {
    apiBaseUrl = '';
  }

  const providers = listProviders(c.env || {});

  return c.json({
    success: true,
    appName: cfg.appName,
    version: cfg.version,
    apiBaseUrl,
    defaultProvider: cfg.defaultProvider,
    failover: {
      enabled: cfg.failover.enabled,
      maxRounds: cfg.failover.maxRounds,
      retryDelayMs: cfg.failover.retryDelayMs,
    },
    providers: providers.map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.configured,
      defaultModel: p.defaultModel,
    })),
  });
}
