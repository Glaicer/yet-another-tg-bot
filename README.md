# Telegram LLM Bot

A Telegram bot for a single group with LLM integration, character personas, guardrails, web search, rate limiting, and SQLite audit logging.

## Setup

1. Copy `.env.template` to `.env` and fill in the required values.
2. Create production config under `config/production/` (see `config/examples/`).
3. Run `npm install` to install dependencies.
4. Run `npm run build` to compile TypeScript.
5. Run `npm start` to start the bot.

## Environment variables

Copy `.env.template` to `.env` and set at least these required variables:

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_ALLOWED_CHAT_ID` | The group chat ID the bot is allowed to respond in |
| `TELEGRAM_ADMIN_USER_ID` | Telegram user ID of the admin (for private admin commands) |
| `MAIN_LLM_API_KEY` | API key for the main LLM provider |
| `GUARDRAILS_API_KEY` | API key for the guardrails provider (when guardrails are enabled) |
| `SQLITE_DATABASE_PATH` | Path to the SQLite database file (default: `./data/bot.sqlite`) |

Optional provider-specific keys are also supported; see `.env.template`.

## Configuration

Behavioral settings live in `config/production/config.yaml`. Key sections:

- `telegram.mode` — `polling` (default) or `webhook`
- `telegram.webhook` — public URL and path when using webhook mode
- `llm` — provider, model, API mode (`responses` or `chat_completions`), temperature, max tokens
- `guardrails` — enable input safety checks and configure refusal behavior
- `rateLimit` — per-user and per-chat rate limiting windows
- `queue` — concurrent request limits and timeouts
- `characters` — directory for persona `.md` files and hot-reload settings

Example files are provided under `config/examples/`.

### Polling vs webhook

- **Polling** (default): the bot continuously fetches updates from Telegram. Simple and works behind NAT.
- **Webhook**: the bot exposes an HTTPS endpoint that Telegram pushes updates to. Set `telegram.mode: webhook` and provide `telegram.webhook.publicUrl`. A `secretTokenEnv` is recommended for webhook security.

## Commands

### Group commands (in the allowed group)

- `/help` — Show usage help
- `/search <query>` — Web search with sources (when supported by the configured provider)

### Admin private commands (only from `TELEGRAM_ADMIN_USER_ID` in private chat)

- `/status` — Bot status (provider, model, character, uptime, etc.)
- `/personas` — List available personas
- `/persona <name>` — Select a global persona

## Development

- `npm test` — Run all tests
- `npm run test:watch` — Run tests in watch mode
- `npm run typecheck` — Type check without emitting
- `npm run lint` — Lint and format check
- `npm run lint:fix` — Auto-fix lint and format issues
- `npm run build` — Build for production
- `npm start` — Start the compiled bot

## Docker

Build and run with Docker Compose:

```bash
docker compose up --build
```

The Compose setup:
- Mounts `./data:/app/data` for persistent SQLite storage
- Mounts `./config/production:/app/config/production:ro` for configuration
- Exposes port `3000` for the healthcheck endpoint (and webhook, if enabled)

Make sure `.env` and `config/production/` exist before starting.

## Security notes

- Secrets live only in `.env`. Never commit `.env`.
- The config file references environment variable names (e.g., `apiKeyEnv`), never raw secrets.
- Guardrails block prompt-injection and secret-exfiltration attempts before LLM calls.
- Full user message text is not persisted in SQLite; only hashes and metadata are stored.
- Healthcheck responses do not reveal secrets.
- Admin commands are restricted to the configured admin user ID and private chat only.
