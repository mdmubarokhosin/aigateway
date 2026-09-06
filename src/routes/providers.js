/**
 * GET /api/v1/providers
 * Discovery endpoint: lists every registered provider, its models, its
 * required env vars, and whether it is currently configured on the server.
 * Clients use this to know what they can pass as {"provider": "..."}.
 */
import { listProviders } from '../providers/registry.js';

export function listProvidersHandler(c) {
  const cfg = c.get('config');
  const providers = listProviders(c.env || {});

  return c.json({
    success: true,
    defaultProvider: cfg.defaultProvider,
    total: providers.length,
    providers,
  });
}
