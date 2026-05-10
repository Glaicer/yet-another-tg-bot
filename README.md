# Yet Another Telegram LLM bot

A Telegram bot for one allowed group. It can call an LLM, use character personas, run safety checks, search the web, limit abuse, and write audit events to SQLite.

## Features

### Invocation and context

- Mention trigger: the bot responds when someone tags `@bot_username` in the group.
- Reply trigger: replying to one of the bot's messages also invokes it. No tag required.
- Replied-message context: if someone replies to another message and tags the bot, the replied text is included in the LLM context. This lets the bot handle requests like "explain this" or "translate it".
- Telegram topics: forum topics are supported. The bot replies in the same topic where it was invoked.

### Safety and moderation

- Guardrails: before a request reaches the LLM, an external safety model checks the user input and any replied text. Unsafe requests are blocked with a refusal message. If the safety provider fails, the bot fails open and continues without guardrails.
- Rate limiting: per-user and per-chat sliding-window limits help prevent abuse.
- Request queue: LLM requests run through a bounded queue with configurable concurrency, queue size, and timeouts.

### Personas

- Character system: personas are Markdown files stored in a configurable directory. The selected persona is saved in SQLite and survives restarts.
- Admin management: the admin can switch personas with `/persona <name>` in private chat.
- Hot reload: new or edited persona files can be picked up without restarting the bot.

### Web search

- `/search` command: available when the configured provider supports web search through the OpenAI tool, OpenRouter server tool, or legacy `:online` suffix.
- Search responses return a short answer with source citations.
- `/search` can also use a replied message as context, which is useful for quick fact-checking.

### URL context extraction

- Firecrawl integration: when `FIRECRAWL_API_KEY` is set, URLs in a user message are scraped with Firecrawl. The page content is converted to Markdown and added to the LLM context.

### LLM integration

- OpenAI-compatible API: supports both the Responses API and the Chat Completions API.
- Provider profiles: includes built-in profiles for OpenAI, OpenRouter, OpenCode Go, and Ollama Cloud.
- Feature detection: provider settings control support for reasoning effort, web search mode, and related options.
- Reasoning effort: configurable per request from `none` through `xhigh`, and passed to the provider when supported.
- Telegram MarkdownV2: responses are sent as Telegram MarkdownV2. If Telegram rejects the formatting, the bot retries with plain text.

### New member greeting

When a new member joins the allowed group, the bot sends a configurable greeting. This path does not use guardrails, rate limits, queueing, typing indicators, or the LLM.

### Logging and diagnostics

- SQLite audit log: bot events and guardrail events are logged with secrets redacted.
- Message privacy: full user message text is not stored by default. The bot stores SHA256 hashes for traceability.
- Health endpoint: `GET /healthz` returns bot status, uptime, provider info, and database health without exposing secrets.

## Setup

Run `install.sh` and follow instructions or:

1. Copy `.env.template` to `.env` and fill in the required values.
2. Create production config under `config/production/`. See `config/examples/` for examples.
3. Run `npm install`.
4. Run `npm run build`.
5. Run `npm start`.

## Environment variables

Copy `.env.template` to `.env` and set at least these variables:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_ALLOWED_CHAT_ID` | Group chat ID where the bot is allowed to respond |
| `TELEGRAM_ADMIN_USER_ID` | Telegram user ID for the admin |
| `MAIN_LLM_API_KEY` | API key for the main LLM provider |
| `GUARDRAILS_API_KEY` | API key for the guardrails provider, when guardrails are enabled |
| `SQLITE_DATABASE_PATH` | Path to the SQLite database file. Defaults to `./data/bot.sqlite` |

Optional variables:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OLLAMA_CLOUD_API_KEY` | Ollama Cloud API key |
| `OPENCODE_GO_API_KEY` | OpenCode Go API key |
| `FIRECRAWL_API_KEY` | Enables URL extraction through Firecrawl |
| `TELEGRAM_WEBHOOK_SECRET` | Secret token for webhook verification |

## Configuration reference

Behavioral settings live in `config/production/config.yaml`. Example files are in `config/examples/`.

### `app`

| Field | Type | Description |
|-------|------|-------------|
| `environment` | `string` | Environment name, such as `production`. Used in logs. |
| `logLevel` | `debug` \| `info` \| `warn` \| `error` | Minimum log level. |

### `telegram`

| Field | Type | Description |
|-------|------|-------------|
| `mode` | `polling` \| `webhook` | How the bot receives updates. Defaults to `polling`. |
| `allowedChatIdEnv` | `string` | Env variable name containing the allowed group chat ID. |
| `adminUserIdEnv` | `string` | Env variable name containing the admin's Telegram user ID. |
| `typingIndicator.enabled` | `boolean` | Show a typing indicator while waiting for the LLM. |
| `typingIndicator.intervalMs` | `number` | How often to resend the typing action, in milliseconds. |
| `webhook.publicUrl` | `string` \| `null` | Public HTTPS URL for webhook mode. Use `null` for polling. |
| `webhook.path` | `string` | URL path for the webhook endpoint, such as `/telegram/webhook`. |
| `webhook.secretTokenEnv` | `string` | Env variable name for the webhook secret token. |

### `http`

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Start the HTTP server for health checks and webhooks. |
| `host` | `string` | Bind address, such as `0.0.0.0`. |
| `port` | `number` | Port number, from 1 to 65535. |
| `healthPath` | `string` | Path for the health check endpoint, such as `/healthz`. |

### `storage`

| Field | Type | Description |
|-------|------|-------------|
| `type` | `sqlite` | Storage backend. Only `sqlite` is supported. |
| `databasePathEnv` | `string` | Env variable name containing the SQLite database path. |

### `systemPrompt`

| Field | Type | Description |
|-------|------|-------------|
| `file` | `string` | Path to the system prompt Markdown file, such as `config/production/prompts/system.md`. |

### `characters`

| Field | Type | Description |
|-------|------|-------------|
| `directory` | `string` | Directory containing persona `.md` files. |
| `default` | `string` | Default persona name, without the file extension. This file must exist or the bot will not start. |
| `selected` | `string` | Initially selected persona. After the first run, the value saved in SQLite takes precedence. |
| `hotReload` | `boolean` | Re-read persona files without restart on `/personas` calls and before each LLM request. |

### `llm`

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `string` | Provider name. Must match a key in `providers`, such as `openai` or `openrouter`. |
| `apiMode` | `responses` \| `chat_completions` | OpenAI-compatible API mode to use. |
| `apiKeyEnv` | `string` | Env variable name containing the LLM API key. |
| `baseUrl` | `string` | Base URL for the LLM API, such as `https://api.openai.com/v1`. |
| `model` | `string` | Model identifier, such as `gpt-5.5-mini`. |
| `temperature` | `number` | Sampling temperature, from 0 to 2. |
| `maxTokens` | `number` | Maximum response tokens. |
| `reasoningEffort` | `none` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh` | Reasoning effort level. Sent only when the provider supports it. |
| `supportsWebSearch` | `boolean` | Whether web search is available for this model and provider. |
| `webSearch.mode` | `openai_tool` \| `openrouter_server_tool` \| `openrouter_online_legacy` \| `none` | Web search integration mode. |
| `webSearch.maxResults` | `number` | Maximum number of search results. |
| `webSearch.requireCitations` | `boolean` | Require source citations in search responses. |

### `providers`

`providers` is a map of provider profiles. Each key is a provider name referenced by `llm.provider`.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `openai-compatible` | Provider type. Only `openai-compatible` is currently supported. |
| `supportsResponsesApi` | `boolean` \| `unknown` | Whether the Responses API is supported. |
| `supportsChatCompletionsApi` | `boolean` \| `unknown` | Whether the Chat Completions API is supported. |
| `supportsReasoningEffort` | `boolean` \| `provider-dependent` | Whether the `reasoning_effort` parameter is supported. |
| `webSearchMode` | `openai_tool` \| `openrouter_server_tool` \| `openrouter_online_legacy` \| `none` | Default web search mode for this provider. |
| `legacyOnlineSuffix` | `boolean` | Optional. Supports the `:online` model suffix for legacy OpenRouter search. |

### `guardrails`

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Enable input safety checks. |
| `failOpenOnProviderError` | `boolean` | Continue without guardrails if the safety provider is unreachable. |
| `provider` | `string` | Guardrails provider type. |
| `apiKeyEnv` | `string` | Env variable name containing the guardrails API key. |
| `baseUrl` | `string` | Base URL for the guardrails API. |
| `model` | `string` | Safety model identifier, such as `llama-guard-4-12b`. |
| `timeoutMs` | `number` | Guardrails request timeout, in milliseconds. |
| `refusalMessage` | `string` | Message sent when input is blocked. |
| `checkInput` | `boolean` | Check user input for safety. |
| `checkOutput` | `boolean` | Check LLM output for safety. Not used in the current version. |
| `blockPromptInjection` | `boolean` | Block detected prompt-injection attempts. |

### `rateLimit`

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Enable rate limiting. |
| `perUser.windowMs` | `number` | Sliding-window duration per user, in milliseconds. |
| `perUser.maxRequests` | `number` | Maximum requests per user within the window. |
| `perChat.windowMs` | `number` | Sliding-window duration per chat, in milliseconds. |
| `perChat.maxRequests` | `number` | Maximum requests per chat within the window. |

### `queue`

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Enable the request queue. |
| `maxConcurrentRequests` | `number` | Maximum parallel LLM requests. |
| `maxQueueSize` | `number` | Maximum queued requests before new requests are rejected. |
| `timeoutMs` | `number` | Timeout for a queued request, in milliseconds. |

### `timeouts`

| Field | Type | Description |
|-------|------|-------------|
| `llmRequestMs` | `number` | Timeout for the full LLM request, in milliseconds. |
| `telegramSendMs` | `number` | Timeout for sending a message to Telegram, in milliseconds. |

### `commands`

| Field | Type | Description |
|-------|------|-------------|
| `registerOnStartup` | `boolean` | Register bot commands with Telegram on startup. |
| `group` | `Array<{command, description}>` | Commands available in the allowed group. |
| `adminPrivate` | `Array<{command, description}>` | Commands available in the admin's private chat. |

### `logging`

| Field | Type | Description |
|-------|------|-------------|
| `logging.sqlite.enabled` | `boolean` | Write events to SQLite. |
| `logging.sqlite.logMessages` | `boolean` | Log full message text. Disabled by default for privacy. |
| `logging.sqlite.redactSecrets` | `boolean` | Redact API keys and tokens from log entries. |

### `messages`

User-facing reply text lives under `messages`. Templates support `{name}` and `{list}` placeholders.

| Field | Description |
|-------|-------------|
| `unsupportedReply` | Sent when the replied message is a non-text media type. |
| `rateLimitExceeded` | Sent when a rate limit is hit. |
| `queueTimeout` | Sent when a queued request times out. |
| `queueFull` | Sent when the request queue is full. |
| `llmError` | Sent when the LLM request fails. |
| `greetUser` | Sent to new members joining the allowed group. |
| `helpText` | Body of the `/help` response. |
| `helpSearchHint` | Appended to help text when web search is available. |
| `searchEmptyArgs` | Sent when `/search` is called without arguments. |
| `personasAvailable` | Template for the `/personas` list. Uses `{list}`. |
| `personasEmpty` | Sent when no personas are found. |
| `personaMissingName` | Sent when `/persona` is called without a name. |
| `personaUnknown` | Sent when an unknown persona name is given. Uses `{name}`. |
| `personaChanged` | Confirmation after switching persona. Uses `{name}`. |
| `statusTitle` | Title of the `/status` response. |

### Polling vs webhook

- Polling: the bot fetches updates from Telegram. This is the default and works well behind NAT.
- Webhook: Telegram sends updates to an HTTPS endpoint exposed by the bot. Set `telegram.mode: webhook` and provide `telegram.webhook.publicUrl`. Use `secretTokenEnv` to verify webhook requests.

## Commands

### Group commands

These commands work in the allowed group:

- `/help` - Show usage help
- `/search <query>` - Search the web with sources, when supported by the configured provider

### Admin private commands

These commands work only for `TELEGRAM_ADMIN_USER_ID` in private chat:

- `/status` - Show bot status, including provider, model, character, and uptime
- `/personas` - List available personas
- `/persona <name>` - Select the global persona

## Development

- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run typecheck` - Type check without emitting
- `npm run lint` - Run lint and format checks
- `npm run lint:fix` - Auto-fix lint and formatting issues
- `npm run build` - Build for production
- `npm start` - Start the compiled bot

## Docker

Build and run with Docker Compose:

```bash
docker compose up --build
````

The Compose setup:

* Mounts `./data:/app/data` for persistent SQLite storage
* Mounts `./config/production:/app/config/production:ro` for configuration
* Exposes port `3000` for the health check endpoint, and for the webhook if enabled

Make sure `.env` and `config/production/` exist before starting.

## Security notes

* Keep secrets in `.env`. Do not commit `.env`.
* Config files should reference environment variable names, such as `apiKeyEnv`, rather than raw secrets.
* Guardrails check for prompt-injection and secret-exfiltration attempts before LLM calls.
* Full user message text is not stored in SQLite by default. The bot stores hashes and metadata instead.
* Health check responses do not reveal secrets.
* Admin commands are restricted to the configured admin user ID and private chat.
