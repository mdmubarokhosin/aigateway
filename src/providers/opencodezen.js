/**
 * OpenCode Zen provider.
 *
 * Zen is opencode.ai's model gateway serving coding-focused frontier models
 * (Claude, GPT, Grok, Qwen, DeepSeek, Nemotron, Muse...). The endpoint speaks
 * the OpenAI chat-completions protocol:
 *   POST https://opencode.ai/zen/v1/chat/completions
 * The model catalog (GET /models) is PUBLIC — no key needed to list it.
 *
 * Env vars:
 *   OPENCODEZEN_API_KEY  (required for chat) - your OpenCode Zen API key
 *   OPENCODEZEN_MODEL    (optional)          - override the default model id
 *
 * FREE-ONLY POLICY: this gateway surfaces only Zen's free models in
 * GET /api/v1/models (ids ending in "-free", e.g. "deepseek-v4-flash-free").
 */
import { createOpenAICompatible } from './openai-compatible.js';

export const opencodezenProvider = createOpenAICompatible({
  id: 'opencodezen',
  label: 'OpenCode Zen',
  description:
    "opencode.ai Zen gateway — coding-tuned frontier models; free tier models like deepseek-v4-flash-free, nemotron-3.5-lightning-free.",
  defaultBaseUrl: 'https://opencode.ai/zen/v1',
  envKey: 'OPENCODEZEN_API_KEY',
  modelEnvKey: 'OPENCODEZEN_MODEL',
  defaultModel: 'deepseek-v4-flash-free',
  models: [
    'deepseek-v4-flash-free',
    'nemotron-3.5-lightning-free',
    'mimo-v2.5-free',
    'ling-3.0-flash-fin-free',
  ],
  freeOnly: true,
  // Zen's GET /models is public: its catalog is auto-listed even before an
  // OPENCODEZEN_API_KEY is configured (only CHAT requires the key).
  allowPublicModels: true,
  supportsMaxTokens: true,
});
