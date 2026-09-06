/**
 * Custom OpenAI-compatible provider — THE zero-code extension point.
 *
 * Point CUSTOM_BASE_URL at ANY OpenAI-compatible server and it becomes a
 * first-class provider, no code changes needed:
 *
 *   OpenAI    : https://api.openai.com/v1        (CUSTOM_MODEL=gpt-4o-mini)
 *   DeepSeek  : https://api.deepseek.com/v1      (CUSTOM_MODEL=deepseek-chat)
 *   Together  : https://api.together.xyz/v1
 *   Ollama    : http://localhost:11434/v1        (key optional)
 *   LM Studio : http://localhost:1234/v1         (key optional)
 *   vLLM      : http://your-host:8000/v1
 *   ...any OpenAI-compatible endpoint
 *
 * Env vars:
 *   CUSTOM_BASE_URL (required) - e.g. https://api.openai.com/v1
 *   CUSTOM_API_KEY  (optional) - omitted from headers when empty
 *   CUSTOM_MODEL    (required at request time) - default model id
 */
import { createOpenAICompatible } from './openai-compatible.js';

export const customProvider = createOpenAICompatible({
  id: 'custom',
  label: 'Custom (OpenAI-compatible)',
  description:
    'Any OpenAI-compatible endpoint: OpenAI, DeepSeek, Together, vLLM, Ollama, LM Studio... Configure via CUSTOM_BASE_URL / CUSTOM_API_KEY / CUSTOM_MODEL.',
  defaultBaseUrl: null,
  baseUrlEnvKey: 'CUSTOM_BASE_URL',
  envKey: 'CUSTOM_API_KEY',
  apiKeyOptional: true, // some runtimes (Ollama, LM Studio) need no key
  modelEnvKey: 'CUSTOM_MODEL',
  defaultModel: null, // must come from env or the request body
  models: [],
  supportsMaxTokens: true,
});
