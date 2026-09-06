/**
 * OpenRouter provider (default).
 * Access 200+ models — including free-tier models — through one key.
 * https://openrouter.ai/docs
 */
import { createOpenAICompatible } from './openai-compatible.js';

export const openrouterProvider = createOpenAICompatible({
  id: 'openrouter',
  label: 'OpenRouter',
  description:
    'Unified gateway to 200+ models (GLM, Llama, DeepSeek, Gemini, Qwen...) with free-tier options.',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  envKey: 'OPENROUTER_API_KEY',
  modelEnvKey: 'OPENROUTER_MODEL',
  extraModelEnvKeys: ['MODEL_NAME'], // backward compatible with v1 of this project
  defaultModel: 'z-ai/glm-5.2:free',
  // FREE-ONLY POLICY: OpenRouter hosts hundreds of paid models; this gateway
  // surfaces only the ":free" tier in GET /api/v1/models (per gateway policy).
  freeOnly: true,
  models: [
    'z-ai/glm-5.2:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-3-27b-it:free',
    'qwen/qwen-2.5-72b-instruct:free',
  ],
  // Attribution headers recommended by OpenRouter.
  extraHeadersFn: (env) => ({
    'HTTP-Referer': env.APP_URL || 'http://localhost:5000',
    'X-Title': 'AI Gateway API',
  }),
});
