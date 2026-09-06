# AI Gateway API

> **v1.3.0 highlights** — New experience layer: aurora hero, live stats counters, models marquee, testimonials, FAQ, Ctrl+K command palette, rich functional footer, scroll animations, new Changelog/Privacy/Terms pages.
>
> **v1.2.0 highlights** — DEEP model-level failover (every model of a provider is tried before switching to the next provider), 🚀 one-click PUSH-to-GitHub button in the Admin Panel, dashboard-friendly config (wrangler.toml removed so Cloudflare never locks Variables again), browser-only env file generator on /env-setup/, browser-clickable GET chat (`/api/v1/chat?prompt=…` + short route `/ask?prompt=…`), functional Telegram bot, Admin Panel with full CRUD, Bangla/English i18n, Noto Serif Bengali typography.

A production-ready, **multi-provider AI gateway REST API** with a complete documentation
website. One consistent endpoint for any AI provider — **OpenRouter**, **Poolside AI**, or
**any custom OpenAI-compatible server** — with a pluggable provider architecture that lets
you add a new provider in minutes. If a provider errors, the gateway **automatically fails
over** to the next one and keeps retrying the chain until a response arrives.

Deploys out of the box on **Cloudflare Pages** (serverless Functions) and also runs on
plain **Node.js** for local development or self-hosting.

```
                 ┌──────────────────────────────┐
   POST          │        AI Gateway API        │
  /api/v1/chat ──>│  validate -> route provider  │──> OpenRouter ──> z-ai/glm-5.2:free
   {message,      │  (Hono, runtime-agnostic)    │──> Poolside   ──> poolside/laguna-s-2.1
    provider,     └──────────────────────────────┘──> Custom     ──> ANY OpenAI-compatible
    model, ...)                 ^                                        base URL
                                │
                    runs on Cloudflare Pages Functions
                    or Node.js 18+ (same codebase)
```

## Features
- **Live model catalog, auto-fetched** — `GET /api/v1/models` pulls every provider's own `/models` list automatically: OpenRouter and OpenCode Zen expose **only their free models** (`:free` / `-free` ids), every other provider exposes its **full catalog**. Cached (default 6 h), refreshable with `?refresh=1`, browsable at `/models/`.
- **Admin panel at `/admin/`** — sign in with a GitHub repo + branch + fine-grained token; the panel loads `config/site.json` + `config/providers.json` from the repo and **commits every change straight back via the GitHub API**, after which Cloudflare Pages rebuilds automatically. Token stays in your browser tab only.
- **Built-in chat bot widget** — a floating assistant on every page that runs **on this very gateway** (`POST /api/v1/chat`), answers visitor questions (Bangla or English) and doubles as a live, always-on self-test of the whole API. Configurable (welcome text, quick questions, on/off) from the admin panel.

- **Multi-provider architecture** — a registry + adapter pattern. Providers are
  self-contained modules in `src/providers/`; adding one is ~15 lines (or **zero
  code** for OpenAI-compatible endpoints via `CUSTOM_*` env vars).
- **Automatic provider failover (default ON)** — when the chosen provider errors (bad
  key, quota, rate limit, timeout, outage), the gateway retries the next configured
  provider, rotating the chain each round, until a response is produced. Disable per
  request with `"failover": false` or globally with `FAILOVER_ENABLED=false`.
- **Dynamic base URL auto-detection** — `GET /api/v1/config` reports the public base URL
  derived from the request itself; every docs page auto-detects it in the browser, so the
  same build works on `localhost`, `*.pages.dev`, and custom domains.
- **Env-driven branding (single source of truth)** — `APP_NAME` / `APP_VERSION` flow into
  the health & config endpoints, navbar, footer and docs headings. Change `.env` once and
  every surface reflects it after redeploy.
- **Per-request provider switching** — clients choose `"provider": "poolside"` etc.; the
  server default comes from `DEFAULT_PROVIDER`.
- **Two input styles** — simple `{ message }` or full multi-turn `{ messages: [...] }`.
- **Consistent envelopes** — every response, success or failure, follows one JSON shape.
- **Typed upstream error mapping** — auth failures, credit exhaustion, rate limits,
  timeouts, network errors and malformed responses all get explicit error codes (and
  `Retry-After` hints where providers supply them).
- **Optional API key protection** — lock YOUR gateway with `API_SECRET_KEY`
  (`X-API-Key` header), constant-time comparison.
- **Two-layer rate limiting** (global + chat) — sliding window, per-isolate on
  Cloudflare (see notes), configurable via env.
- **CORS allow-list**, security headers, JSON 404/error handlers, custom 404 page.
- **Complete documentation website** — light/dark mode, fully responsive:
  - `/` — landing page with live provider status
  - `/docs/` — full API reference (auth, chat, errors, rate limits, config)
  - `/endpoints/` — per-endpoint reference with examples
  - `/playground/` — interactive API testing console (providers, params, history)
  - `/guide/` — usage & integration guide (cURL / JS / Python, deploy steps)
  - `/status/` — live API status: health polling, latency chart, per-provider tests
  - `/custom-provider/` — where & how to add custom providers (English + Bengali)
- **Zero-config build for Cloudflare Pages** — `npm run build` -> `out/`.
- **Smoke-test script** — verify any deployment (local or deployed) in one command.

## Tech Stack

| Layer      | Choice                                        | Why |
| ---------- | --------------------------------------------- | --- |
| Framework  | [Hono](https://hono.dev) (JavaScript)         | Runs natively on Cloudflare Workers/Pages **and** Node.js with the same code |
| HTTP       | Global `fetch` + AbortController              | Axios is unreliable on the Workers runtime |
| Frontend   | Vanilla HTML/CSS/JS (no build step)           | Fully editable — change a file, refresh, done |
| Runtime    | Cloudflare Pages Functions / Node.js >= 18    | Serverless or self-hosted |
| Tooling    | wrangler (dev), dotenv (Node dev)             | Standard Cloudflare workflow |

## Project Structure

```
ai-gateway-api/
├── functions/                          # Cloudflare Pages Functions (API, serverless)
│   ├── api/
│   │   └── [[route]].js                #   catches /api/*  -> Hono app
│   └── health.js                       #   catches /health -> Hono app (legacy path)
├── public/                             # Documentation website -> copied to out/
│   ├── index.html                      #   landing page
│   ├── 404.html                        #   custom 404 page
│   ├── _headers                        #   security headers for static assets
│   ├── favicon.svg
│   ├── docs/  endpoints/  playground/  guide/  status/  custom-provider/
│   └── assets/
│       ├── css/styles.css              #   design system (light default + dark)
│       └── js/                         #   layout, tabs/copy, home, playground, status
├── scripts/
│   └── build.mjs                       # npm run build  -> out/  (CI-safe, no deps)
├── src/
│   ├── config.js                       # env -> effective config (CF env or process.env)
│   ├── index.js                        # Hono app: middleware pipeline + routes
│   ├── core/
│   │   ├── errors.js                   # ApiError + upstream error mapping
│   │   ├── failover.js                 # DEEP MODEL-LEVEL PROVIDER FAILOVER engine
│   │   └── validate.js                 # chat payload validation/normalization
│   ├── providers/
│   │   ├── base.js                     # PROVIDER CONTRACT (read me first)
│   │   ├── normalize.js                # usage normalization across providers
│   │   ├── openai-compatible.js        # factory: any OpenAI-protocol provider
│   │   ├── openrouter.js               # OpenRouter (default, z-ai/glm-5.2:free)
│   │   ├── poolside.js                 # Poolside AI (poolside/laguna-s-2.1)
│   │   ├── custom.js                   # ANY custom OpenAI-compatible endpoint
│   │   ├── _template.js                # copy-me skeleton for new providers
│   │   └── registry.js                 # registration + discovery
│   ├── middleware/
│   │   ├── rate-limit.js               # sliding-window limiter (global + chat)
│   │   ├── security.js                 # optional X-API-Key auth
│   │   └── error-handler.js            # centralized JSON error envelopes
│   ├── routes/
│   │   ├── health.js                   # GET  /api/v1/health, /health
│   │   ├── config.js                   # GET  /api/v1/config (runtime config + base URL)
│   │   ├── providers.js                # GET  /api/v1/providers
│   │   └── chat.js                     # POST /api/v1/chat (with failover)
│   └── utils/
│       └── http.js                     # fetch + timeout helper
├── cloudflare-env-import.env           # OWNER-ONLY real env file (gitignored, never commit)
├── .env.example                        # env template (placeholders only)
├── .dev.vars.example                   # Cloudflare local-dev template
├── DEPLOYMENT.md                       # step-by-step GitHub -> Cloudflare Pages guide
├── package.json
└── README.md
```

## Quick Start

### A. Deploy to Cloudflare Pages (recommended)

1. Push this folder to a GitHub repository.
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Select the repo and use this build configuration:

   | Setting | Value |
   | --- | --- |
   | Framework preset | None |
   | **Build command** | `npm run build` |
   | **Build output directory** | `out` |
   | Root directory | *(empty)* |

4. Add environment variables (Production + Preview): at minimum
   `OPENROUTER_API_KEY` or `POOLSIDE_API_KEY` (see the table below).
   Fastest way: **Settings → Variables and Secrets → Import .env** with a prepared env file.
5. Deploy → your API **and** the whole documentation site go live at
   `https://<project>.pages.dev`.

Full walkthrough: [DEPLOYMENT.md](./DEPLOYMENT.md) and the in-site
[Usage & Integration Guide](public/guide/index.html) (`/guide/` once deployed).

### B. Run locally with Cloudflare tooling

```bash
npm install
cp .dev.vars.example .dev.vars     # then set your provider keys
npm run dev                        # http://localhost:8788  (wrangler pages dev)
```

### C. Run locally on plain Node.js (site + API together)

```bash
npm install
npm run build                      # builds the static site into out/
cp .env.example .env               # then set your provider keys
npm start                          # http://localhost:5000
```

## API Reference

Base URL: `https://<project>.pages.dev` (Cloudflare) or `http://localhost:5000` (Node).
Full interactive reference ships with the site at `/docs/` and `/endpoints/`.

### `GET /api/v1/health`  (public; `GET /health` also works)

```json
{ "status": "ok", "timestamp": "2026-09-05T10:00:00.000Z", "version": "1.0.0", "appName": "AI Gateway API", "defaultProvider": "openrouter", "failover": true }
```

### `GET /api/v1/config`  (public — runtime config + auto-detected base URL)

```json
{
  "success": true,
  "appName": "AI Gateway API",
  "version": "1.0.0",
  "apiBaseUrl": "https://<project>.pages.dev",
  "defaultProvider": "openrouter",
  "failover": { "enabled": true, "maxRounds": 3, "retryDelayMs": 800 },
  "providers": [ { "id": "openrouter", "label": "OpenRouter", "configured": true, "defaultModel": "z-ai/glm-5.2:free" } ]
}
```

`apiBaseUrl` is detected from the incoming request, so it is always correct — on
localhost, on `*.pages.dev`, or on any custom domain.

### `GET /api/v1/providers`

```json
{
  "success": true,
  "defaultProvider": "openrouter",
  "total": 3,
  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "description": "Unified gateway to 200+ models ...",
      "defaultModel": "z-ai/glm-5.2:free",
      "models": ["z-ai/glm-5.2:free", "..."],
      "requiredEnvKeys": ["OPENROUTER_API_KEY"],
      "configured": true
    }
  ]
}
```

### `GET /api/v1/models`

Live model catalog, **auto-fetched from every configured provider** (nothing hardcoded):

| Provider | What gets listed |
|---|---|
| `openrouter` | only **`:free`** models (e.g. `z-ai/glm-5.2:free`) |
| `opencodezen` | only **`-free`** models (e.g. `deepseek-v4-flash-free`) |
| `poolside`, `custom`, … | **full catalog** |

Query params: `?refresh=1` (bypass cache), `?provider=<id>` (filter). One provider failing never fails the endpoint — its error is reported inside `providers[].error`.

```json
{
  "success": true, "object": "list", "total": 28,
  "providers": [
    { "id": "openrouter", "status": "ok", "freeOnly": true, "total": 19, "totalBeforeFilter": 214,
      "models": [ { "id": "z-ai/glm-5.2:free", "object": "model", "owned_by": "z-ai", "provider": "openrouter", "free": true } ] },
    { "id": "opencodezen", "status": "ok", "freeOnly": true, "total": 7, "models": [ /* … */ ] },
    { "id": "poolside", "status": "ok", "freeOnly": false, "total": 2, "models": [ /* … */ ] }
  ],
  "data": [ /* flat OpenAI-style list across all providers */ ],
  "cache": { "hit": false, "updatedAt": "2026-09-05T04:00:00.000Z", "ttlMs": 21600000, "nextRefreshAt": "2026-09-05T10:00:00.000Z" }
}
```

### `POST /api/v1/chat`

**Request body**

| Field           | Type   | Required              | Default           | Notes |
| --------------- | ------ | --------------------- | ----------------- | ----- |
| `message`       | string | one of message/messages | —               | Simple single-turn input |
| `messages`      | array  | one of message/messages | —               | Multi-turn: `[{role: system\|user\|assistant, content}]`, max 50 |
| `provider`      | string | no                    | `DEFAULT_PROVIDER`| One of: `openrouter`, `poolside`, `custom` |
| `model`         | string | no                    | provider default  | Any model id supported by that provider |
| `failover`      | bool   | no                    | server config     | `false` pins the request to one provider (no auto-fallback) |
| `system_prompt` | string | no                    | null              | System instruction |
| `temperature`   | number | no                    | 0.7               | 0 – 2 |
| `max_tokens`    | int    | no                    | provider default  | 1 – `MAX_TOKENS_LIMIT` (8192) |

**Simple request**

```bash
curl -X POST http://localhost:5000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the meaning of life?"}'
```

```json
{
  "success": true,
  "provider": "openrouter",
  "reply": "AI response content ...",
  "model": "z-ai/glm-5.2:free",
  "usage": { "prompt_tokens": 12, "completion_tokens": 148, "total_tokens": 160 },
  "failover": { "enabled": true, "attempts": [], "rounds": 1, "servedOnRound": 1 }
}
```

`provider` = the provider that actually answered (after any failover); the winning
provider is also sent in the `X-AI-Gateway-Provider` response header.

### Automatic provider failover

On by default. Preferred provider first (request `provider` field or `DEFAULT_PROVIDER`),
then every other **configured** provider in registry order; the chain is cycled up to
`FAILOVER_MAX_ROUNDS` rounds (default 3) with a rotating start, retrying only transient
errors (rate limit, timeout, outage, network). Permanent errors (invalid key, provider
not configured) are not retried. If everything fails:

```json
{
  "success": false,
  "error": {
    "code": "ALL_PROVIDERS_FAILED",
    "message": "All 2 configured provider(s) failed after 3 attempt(s). Last error: ...",
    "details": { "attempts": [ { "provider": "openrouter", "code": "UPSTREAM_RATE_LIMIT", "http": 429, "round": 1 } ], "chain": ["openrouter", "poolside"], "roundsTried": 3 } 
  }
}
```

**Multi-turn + provider switch + tuning**

```bash
curl -X POST http://localhost:5000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "poolside",
    "model": "poolside/laguna-s-2.1",
    "messages": [
      {"role": "system", "content": "You are a concise senior Go developer."},
      {"role": "user", "content": "What are channels in Go?"}
    ],
    "temperature": 0.4,
    "max_tokens": 300
  }'
```

**Error responses** always use one envelope:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": { "field": "message" } } }
```

## Error Codes

| HTTP | Code                          | Meaning                                             |
| ---- | ----------------------------- | --------------------------------------------------- |
| 400  | `VALIDATION_ERROR`            | Payload failed validation (`error.details` says why) |
| 400  | `INVALID_JSON`                | Body is not valid JSON                              |
| 400  | `UNKNOWN_PROVIDER`            | `provider` not registered (see `details.availableProviders`) |
| 401  | `UNAUTHORIZED`                | Missing/wrong `X-API-Key` (when `API_SECRET_KEY` set) |
| 402  | `UPSTREAM_CREDITS_EXHAUSTED`  | Provider says credits/quota exhausted               |
| 404  | `ROUTE_NOT_FOUND`             | Unknown route                                       |
| 429  | `RATE_LIMITED`                | This gateway's own rate limit hit                   |
| 429  | `UPSTREAM_RATE_LIMIT`         | Provider throttled us (`details.retryAfterSeconds`) |
| 500  | `UPSTREAM_AUTH_ERROR`         | Provider rejected the server-side API key           |
| 500  | `PROVIDER_NOT_CONFIGURED`     | Provider selected but its env keys are missing      |
| 500  | `NO_PROVIDER_CONFIGURED`      | No provider env var is set at all                   |
| 502  | `ALL_PROVIDERS_FAILED`        | Auto-failover exhausted every configured provider   |
| 500  | `INTERNAL_ERROR`              | Unexpected server error                             |
| 502  | `UPSTREAM_ERROR`              | Provider returned an unexpected error               |
| 502  | `NETWORK_ERROR`               | Could not reach the provider                        |
| 502  | `MALFORMED_UPSTREAM_RESPONSE` | Unexpected response shape from the provider         |
| 503  | `UPSTREAM_UNAVAILABLE`        | Provider temporarily down                           |
| 504  | `UPSTREAM_TIMEOUT`            | Provider did not respond in time                    |

## Securing Your Gateway

Set `API_SECRET_KEY` in the provider's environment variables. Every `/api/v1/*`
request (except health) then requires:

```bash
curl -X POST https://<project>.pages.dev/api/v1/chat \
  -H "X-API-Key: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message": "hello"}'
```

`Authorization: Bearer YOUR_SECRET` is also accepted. Keep `API_SECRET_KEY` unset in
development for open access.

## Rate Limits

| Scope | Default | Env vars |
| --- | --- | --- |
| All `/api/v1/*` | 100 requests / 15 min / IP | `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS` |
| `POST /api/v1/chat` | 15 requests / 1 min / IP | `CHAT_RATE_LIMIT_MAX`, `CHAT_RATE_LIMIT_WINDOW_MS` |

Responses include `X-RateLimit-Limit` / `X-RateLimit-Remaining`, and 429s include
`Retry-After`.

> **Cloudflare note:** Pages Functions run across many isolates, so this limiter is a
> per-isolate soft cap — ideal for basic abuse protection. For hard, exact quotas at
> scale, add a Cloudflare WAF rate-limiting rule on `/api/v1/chat` (one click in the
> dashboard) or swap in a KV/Durable Object counter.

## Adding a New Provider

The site page `/custom-provider/` explains this in depth (English + Bengali). Summary:

### Way 1 — zero code (any OpenAI-compatible endpoint)

Set three env vars and restart/redeploy:

```env
CUSTOM_BASE_URL=https://api.deepseek.com/v1
CUSTOM_API_KEY=sk-...
CUSTOM_MODEL=deepseek-chat
```

Then call it: `{"provider": "custom", "message": "hello"}`. Works with OpenAI,
DeepSeek, Together, Fireworks, vLLM, Ollama (`http://localhost:11434/v1`, key
optional), LM Studio, and every other OpenAI-protocol server.

### Way 2 — a dedicated provider file (like poolside.js)

If the provider speaks the OpenAI protocol, use the factory (~15 lines):

```js
// src/providers/poolside.js
import { createOpenAICompatible } from './openai-compatible.js';

export const poolsideProvider = createOpenAICompatible({
  id: 'poolside',
  label: 'Poolside AI',
  description: 'Poolside Laguna code-intelligence models…',
  defaultBaseUrl: 'https://inference.poolside.ai/v1',
  envKey: 'POOLSIDE_API_KEY',
  modelEnvKey: 'POOLSIDE_MODEL',
  defaultModel: 'poolside/laguna-s-2.1',
  models: ['poolside/laguna-s-2.1'],
});
```

Register it in `src/providers/registry.js`, set `POOLSIDE_API_KEY`, redeploy — done.

### Way 3 — full control

For non-OpenAI protocols, copy `src/providers/_template.js` and implement
`isConfigured(env)` + `chat(payload, ctx)` yourself. The full contract is documented
at the top of [`src/providers/base.js`](./src/providers/base.js).

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_NAME` | `AI Gateway API` | Display name (health, config endpoint, docs site) |
| `APP_VERSION` | `1.0.0` | Version badge shown everywhere (env-driven) |
| `FAILOVER_ENABLED` | `true` | Automatic provider failover on/off |
| `FAILOVER_MAX_ROUNDS` | `3` | Chain cycles before `ALL_PROVIDERS_FAILED` (1–20) |
| `FAILOVER_RETRY_DELAY_MS` | `800` | Pause between failover rounds |
| `API_BASE_URL` | *(auto-detect)* | Build-time override for the docs site (separate API domain) |
| `DEFAULT_PROVIDER` | `openrouter` | Provider used when the request has no `provider`; first in the failover chain |
| `OPENROUTER_API_KEY` | — | OpenRouter key (required for that provider) |
| `OPENROUTER_MODEL` (or legacy `MODEL_NAME`) | `z-ai/glm-5.2:free` | OpenRouter model override |
| `OPENCODEZEN_API_KEY` | — | OpenCode Zen key (enables `opencodezen` chat; catalog is public). |
| `OPENCODEZEN_MODEL` | `deepseek-v4-flash-free` | Default Zen model. |
| `MODELS_CACHE_TTL_MS` | `21600000` | Live model catalog cache TTL (6 h). |
| `POOLSIDE_API_KEY` / `POOLSIDE_MODEL` | — / `poolside/laguna-s-2.1` | Poolside AI |
| `CUSTOM_BASE_URL` / `CUSTOM_API_KEY` / `CUSTOM_MODEL` | — | Custom OpenAI-compatible provider |
| `API_SECRET_KEY` | — | Protects this gateway (`X-API-Key`); empty = open |
| `ALLOWED_ORIGINS` | `*` | CORS allow-list (comma-separated) |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | 100 / 900000 | Global limiter |
| `CHAT_RATE_LIMIT_MAX` / `CHAT_RATE_LIMIT_WINDOW_MS` | 15 / 60000 | Chat limiter |
| `MAX_MESSAGE_LENGTH` / `MAX_MESSAGES` / `MAX_TOKENS_LIMIT` | 8000 / 50 / 8192 | Validation caps |
| `PROVIDER_TIMEOUT_MS` | 60000 | Upstream request timeout |
| `APP_URL` | — | Sent to OpenRouter as `HTTP-Referer` attribution |
| `NODE_ENV` | `development` | `production` hides stack traces |
| `PORT` | `5000` | Node server port only |

## Smoke Tests

```bash
# against local Node server
npm run smoke

# against a deployed Cloudflare Pages URL (read-only checks)
BASE_URL=https://your-project.pages.dev npm run smoke

# include a real end-to-end chat call
BASE_URL=https://your-project.pages.dev RUN_E2E=1 npm run smoke
```

A healthy deployment passes every check. During `RUN_E2E`, a free-tier provider that
answers `429 UPSTREAM_RATE_LIMIT` counts as a soft pass — the chain works, the shared
pool is just busy.

## Admin Panel (GitHub-backed)

Open **`/admin/`** and sign in with:

1. **Repository** — `owner/repo` or the full GitHub URL
2. **Branch** — usually `main`
3. **GitHub token** — a fine-grained personal access token with **Contents: Read and write** on that one repo only

The panel then:

- **Loads all data from the GitHub repo** — `config/site.json` (site name, tagline, homepage description, announcement banner, chat-bot settings) and `config/providers.json` (provider display order, taglines, hidden list). Missing files are created from defaults on first save.
- **Commits every change back to the repo** through the GitHub Contents API. Cloudflare Pages detects the push and redeploys automatically — admin changes go live in 1–2 minutes with zero manual steps.
- Shows an **activity list** of the recent commits touching `config/`.

Security model: the token lives in **session storage** (this browser tab only, gone on close) and is sent **only to `api.github.com`** — never to the gateway or any other service. Provider API keys are intentionally NOT editable in the panel; they remain Cloudflare environment secrets.

```text
You (browser) ──GET/PUT config/*.json──▶ api.github.com ──▶ your repo
                                                            └─ push ──▶ Cloudflare Pages auto-rebuild ──▶ live site
```

## বাংলা কুইক স্টার্ট

1. এই ফোল্ডারটি একটি GitHub রিপোতে push করুন।
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git।
3. Build configuration: **Build command** = `npm run build`, **Build output** = `out`,
   **Root directory** = খালি।
4. Environment variables দিন — Settings → Variables and Secrets → **Import .env** দিয়ে
   একবারে সব আপলোড করুন (বা `OPENROUTER_API_KEY` / `POOLSIDE_API_KEY` আলাদা করে দিন),
   Production + Preview দুটোতেই।
5. Deploy করুন — API ও পুরো ডকুমেন্টেশন সাইট লাইভ: `https://<project>.pages.dev`।

ভার্সন ব্র্যান্ডিং ও failover সব `.env`-নিয়ন্ত্রিত: `APP_VERSION=1.0.0` বদলালে সব পেজে
ভার্সন বদলাবে; `FAILOVER_ENABLED` / `FAILOVER_MAX_ROUNDS` দিয়ে অটো-ফেইলওভার নিয়ন্ত্রণ হয়।

সাইটের `/custom-provider/` পেজে বাংলায় বিস্তারিত দেখানো আছে কীভাবে নতুন provider
যোগ করবেন — কোড ছাড়া (`CUSTOM_*` env) অথবা ছোট একটি ফাইল বানিয়ে।

## Roadmap

- SSE streaming responses (`POST /api/v1/chat/stream`)
- KV/Durable-Object-backed rate limiting & usage quotas per API key
- Per-client API keys with dashboards
- Response caching for identical prompts

## License

MIT — see [LICENSE](./LICENSE).
