/**
 * Poolside AI provider.
 *
 * Laguna is Poolside's code-intelligence model family, tuned for software
 * engineering tasks (code generation, review, explanation, refactoring).
 * The endpoint speaks the OpenAI chat-completions protocol.
 *
 * Env vars:
 *   POOLSIDE_API_KEY  (required) - your Poolside API key
 *   POOLSIDE_MODEL    (optional) - override the default model id
 *
 * Upstream request shape (handled by the OpenAI-compatible factory):
 *   curl https://inference.poolside.ai/v1/chat/completions \
 *     -H "Authorization: Bearer $POOLSIDE_API_KEY" \
 *     -H "Content-Type: application/json" \
 *     -d '{ "model": "poolside/laguna-s-2.1",
 *           "messages": [{ "role": "user", "content": "What are channels in Go?" }] }'
 */
import { createOpenAICompatible } from './openai-compatible.js';

export const poolsideProvider = createOpenAICompatible({
  id: 'poolside',
  label: 'Poolside AI',
  description:
    'Poolside Laguna code-intelligence models for software engineering tasks (code gen, review, refactoring).',
  defaultBaseUrl: 'https://inference.poolside.ai/v1',
  envKey: 'POOLSIDE_API_KEY',
  modelEnvKey: 'POOLSIDE_MODEL',
  defaultModel: 'poolside/laguna-s-2.1',
  models: ['poolside/laguna-s-2.1'],
  supportsMaxTokens: true,
});
