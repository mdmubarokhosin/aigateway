/**
 * Request payload validation for POST /api/v1/chat.
 *
 * Two input styles are supported (exactly ONE is required):
 *   1. Simple:      { "message": "..." }
 *   2. Multi-turn:  { "messages": [ { "role": "user", "content": "..." }, ... ] }
 *
 * Shared optional fields:
 *   provider      - provider id (see GET /api/v1/providers); default: DEFAULT_PROVIDER
 *   model         - model id override; default: provider default or env override
 *   system_prompt - system instruction (simple style)
 *   temperature   - 0..2 (default 0.7)
 *   max_tokens    - 1..MAX_TOKENS_LIMIT (omitted upstream when unset)
 *   failover      - boolean; false = ONLY try the requested provider (no
 *                   automatic fallback). Default: follow server config.
 *
 * Everything is validated and normalized BEFORE reaching any provider.
 */
import { ApiError } from './errors.js';

const ALLOWED_ROLES = ['system', 'user', 'assistant'];

function validationError(message, details) {
  return new ApiError(400, message, 'VALIDATION_ERROR', details);
}

function checkString(value, name, rule, { required = false, maxLength } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw validationError(`"${name}" is required.`, { field: name, rule });
    return null;
  }
  if (typeof value !== 'string') {
    throw validationError(`"${name}" must be a string.`, { field: name, rule });
  }
  const trimmed = value.trim();
  if (required && trimmed.length === 0) {
    throw validationError(`"${name}" must be a non-empty string.`, { field: name, rule });
  }
  if (maxLength && trimmed.length > maxLength) {
    throw validationError(`"${name}" exceeds the maximum length of ${maxLength} characters.`, {
      field: name,
      maxLength,
    });
  }
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {Object} body  - Raw request body.
 * @param {Object} cfg   - Effective config (getConfig()).
 * @returns {Object} Normalized payload for the provider layer.
 */
export function parseChatPayload(body, cfg) {
  const { validation } = cfg;
  const src = body || {};

  // --- provider (optional string; existence checked against the registry) ---
  const provider = checkString(src.provider, 'provider', 'optional string');

  // --- model (optional string) ---
  const model = checkString(src.model, 'model', 'optional string');

  // --- input: "messages" (multi-turn) OR "message" (simple) ---
  let messages = null;
  let message = null;

  if (src.messages !== undefined && src.messages !== null) {
    if (!Array.isArray(src.messages) || src.messages.length === 0) {
      throw validationError('"messages" must be a non-empty array of {role, content} objects.', {
        field: 'messages',
        rule: 'non-empty array',
      });
    }
    if (src.messages.length > validation.maxMessages) {
      throw validationError(`"messages" cannot contain more than ${validation.maxMessages} items.`, {
        field: 'messages',
        maxMessages: validation.maxMessages,
      });
    }
    messages = src.messages.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw validationError(`"messages[${index}]" must be an object with role and content.`, {
          field: `messages[${index}]`,
          rule: `{ role: 'system'|'user'|'assistant', content: string }`,
        });
      }
      const role = item.role;
      if (!ALLOWED_ROLES.includes(role)) {
        throw validationError(
          `"messages[${index}].role" must be one of: ${ALLOWED_ROLES.join(', ')}.`,
          { field: `messages[${index}].role`, allowed: ALLOWED_ROLES }
        );
      }
      const content = checkString(item.content, `messages[${index}].content`, 'non-empty string', {
        required: true,
        maxLength: validation.maxMessageLength,
      });
      return { role, content };
    });
  } else {
    message = checkString(src.message, 'message', 'required, non-empty string', {
      required: true,
      maxLength: validation.maxMessageLength,
    });
  }

  // --- system prompt (accept snake_case and camelCase) ---
  const systemPrompt = checkString(
    src.system_prompt !== undefined ? src.system_prompt : src.systemPrompt,
    'system_prompt',
    'optional string',
    { maxLength: validation.maxMessageLength }
  );

  // --- temperature (optional number 0..2) ---
  let temperature = 0.7;
  if (src.temperature !== undefined) {
    if (typeof src.temperature !== 'number' || Number.isNaN(src.temperature) || src.temperature < 0 || src.temperature > 2) {
      throw validationError('"temperature" must be a number between 0 and 2.', {
        field: 'temperature',
        rule: '0 <= temperature <= 2',
      });
    }
    temperature = src.temperature;
  }

  // --- failover (optional boolean; null = follow server config) ---
  let failover = null;
  if (src.failover !== undefined && src.failover !== null) {
    if (typeof src.failover !== 'boolean') {
      throw validationError('"failover" must be a boolean (true/false).', {
        field: 'failover',
        rule: 'boolean',
      });
    }
    failover = src.failover;
  }

  // --- max tokens (optional integer, capped) ---
  let maxTokens = null;
  const rawMaxTokens = src.max_tokens !== undefined ? src.max_tokens : src.maxTokens;
  if (rawMaxTokens !== undefined && rawMaxTokens !== null) {
    if (!Number.isInteger(rawMaxTokens) || rawMaxTokens < 1 || rawMaxTokens > validation.maxTokensLimit) {
      throw validationError(`"max_tokens" must be an integer between 1 and ${validation.maxTokensLimit}.`, {
        field: 'max_tokens',
        rule: `1 <= max_tokens <= ${validation.maxTokensLimit}`,
      });
    }
    maxTokens = rawMaxTokens;
  }

  return { provider, model, messages, message, systemPrompt, temperature, maxTokens, failover };
}
