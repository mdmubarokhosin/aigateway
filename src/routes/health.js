/**
 * GET /health and GET /api/v1/health
 * Liveness probe for uptime monitors, load balancers, Cloudflare health checks.
 * Version/appName come from the environment (APP_VERSION / APP_NAME).
 */
export function healthCheck(c) {
  const cfg = c.get('config');
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: cfg.version,
    appName: cfg.appName,
    defaultProvider: cfg.defaultProvider,
    failover: cfg.failover.enabled,
  });
}
