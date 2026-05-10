# Yet Another TG Bot — Agent Instructions

## What This Is

A Telegram LLM bot for a single group with topic support, characters/personas, guardrails,
web search, rate limiting, request queueing, and SQLite logging.

Read `TECHSPEC.md` for the full technical specification and acceptance criteria.

## Stack

Node.js ≥22, TypeScript (strict), ESM (`"type": "module"`).
Runtime deps: `better-sqlite3`, `grammy`, `dotenv`, `zod`, `yaml`.
Dev deps: `vitest`, `tsx`, `@biomejs/biome`.

## Quick Start

```bash
# Copy env template and fill in real values
cp .env.template .env
# Copy example config
cp config/examples/config.example.yaml config/production/config.yaml
# Create characters directory
cp -r config/examples/characters config/production/characters
cp -r config/examples/prompts config/production/prompts
# Run
npm run dev
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Run via `tsx` (no build, development) |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | Run compiled `dist/index.js` |
| `npm test` | `vitest run` |
| `npm run test:watch` | `vitest` (watch mode) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `biome check .` |
| `npm run lint:fix` | `biome check --write .` |
| `npm run format` | `biome format --write .` |

**Verification order:** `lint:fix` → `format` → `typecheck` → `test`.

## TypeScript

- Strict: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.
  Build fails on unused variables.
- `moduleResolution: NodeNext` — use `.js` extensions in imports even for `.ts` files.
- Tests in `tests/` are excluded from `tsconfig.json`. They're type-checked by vitest directly.
- `rootDir: src/`, `outDir: dist/`. Only `src/` compiles.

## Architecture

```
src/
├── index.ts              # Entry: createApp().start() + graceful shutdown
├── app.ts                # createApp() — wires all services
├── config/               # Config loading, validation, env resolution, types
│   ├── types.ts          # ResolvedConfig type (all env vars resolved)
│   ├── schema.ts         # Zod schema for config.yaml + env validation
│   ├── loadConfig.ts     # Reads YAML, resolves env refs, validates
│   └── env.ts            # Env variable loading (dotenv)
├── telegram/             # Telegram integration via grammy
│   ├── bot.ts            # createBot() — polling/webhook, command registration
│   ├── updateParser.ts   # parseMessage() → ParsedEvent (mention/reply/command detection)
│   ├── messageHandler.ts # createMessageHandler() — orchestrates guardrails→LLM→send
│   ├── commands.ts       # /help, /search, /status, /personas, /persona
│   ├── searchCommand.ts  # /search web search logic
│   ├── sender.ts         # sendSafeMessage() — sends with MarkdownV2+fallback
│   ├── typingIndicator.ts# startTypingIndicator() — repeats sendChatAction
│   └── types.ts          # ParsedEvent union type
├── llm/                  # LLM integration (OpenAI-compatible API)
│   ├── client.ts         # callLlm() — makes HTTP request to LLM API
│   ├── requestMapper.ts  # mapRequest() — builds Responses/ChatCompletions payload
│   ├── providerCapabilities.ts # Provider feature detection
│   └── types.ts          # MappedRequest, LlmResponse
├── guardrails/
│   └── guardrailsService.ts # createGuardrailsService() — checks input via LLM
├── prompt/
│   ├── promptBuilder.ts  # buildPrompt() — system+character+user+replied
│   └── markdown.ts       # MarkdownV2 escaping
├── characters/
│   └── characterStore.ts # CharacterStore — load .md files, persist selection in SQLite
├── storage/
│   ├── database.ts       # createDatabase() — SQLite setup + migrations
│   ├── logger.ts         # createLogger() — bot_events, guardrail_events (redacted)
│   └── settings.ts       # Settings get/set via bot_settings table
├── core/
│   ├── rateLimiter.ts    # createRateLimiter() — per-user, per-chat sliding windows
│   ├── requestQueue.ts   # createRequestQueue() — bounded concurrency + timeout
│   ├── redact.ts         # redactSecrets() — strips API keys from log data
│   └── hash.ts           # hashString() — SHA256 for audit traceability
└── http/
    └── health.ts         # createHealthServer() — /healthz + optional webhook path
```

### Dependency Injection

`createApp(options)` in `src/app.ts` wires all services. Every service receives its
dependencies as parameters (no singletons). The `overrides` option allows injecting
fakes/mocks for testing:

```ts
const app = createApp({
  overrides: {
    loadConfig,      // config loader
    createDatabase,  // SQLite factory
    createLogger,    // logger factory
    createCharacterStore,
    createRateLimiter,
    createRequestQueue,
    createGuardrailsService,
    createBot,
    createHealthServer,
    readSystemPrompt,
    callLlm,         // LLM HTTP client
  },
});
```

## Test Architecture

Tests mirror `src/` under `tests/`. Integration tests use the helper at
`tests/helpers/integration.ts` which creates a full app with mocked Telegram API
and in-memory SQLite, but real service logic throughout.

Key test helper:

```ts
const { app, captured, sendMessage, sendChatAction } = await setupApp({
  configOverrides: { ... },
  callLlm: vi.fn().mockResolvedValue({ text: 'Mock response' }),
});

// Simulate a Telegram update
await captured.handleUpdate(makeGroupMessage({
  text: '@testbot hello',
  userId: REGULAR_USER_ID,
}));

// Assert bot response
expect(sendMessage).toHaveBeenCalledWith(...);
```

## Config & Secrets

- `.env` — all secrets (never committed). Use `.env.template` as reference.
- `config/production/config.yaml` — runtime config (gitignored).
- `config/examples/` — example config, characters, and prompts.
- Config fields reference env var names (e.g., `apiKeyEnv: MAIN_LLM_API_KEY`), never inline secrets.
- Config supports `providers` section for multi-provider detection (openai, openrouter, opencode_go, ollama_cloud).

## Docker

- `docker compose up --build` mounts `./config/production:/app/config/production:ro` and `./data:/app/data`.
- Port 3000 = healthcheck + optional webhook.

## Style & Workflow

- Biome handles both linting and formatting. No ESLint/Prettier.
- Do not add new dependencies unless absolutely necessary — prefer existing ones.
- Match existing code style: flat functions (no classes except CharacterStore), type-only interfaces,
  explicit dependency passing.
- When making changes: update → `lint:fix` → `format` → `typecheck` → `test`.
- Remove only imports/variables/functions YOUR changes made unused (don't touch pre-existing dead code).
- If you create new file, refactor existing functions or implement new logic you must update `AGENTS.md`

## Core Behaviors

1. **Access control**: Bot responds only in the allowed `TELEGRAM_ALLOWED_CHAT_ID`. Admin commands
   only in private chat with `TELEGRAM_ADMIN_USER_ID`.
2. **Triggers**: `@bot_username` mention, reply to bot's message, or group command (`/search`, `/help`).
   Replied context may come from user or bot message text, media captions, or Telegram quote text.
3. **Typing indicator**: `sendChatAction('typing')` repeated at interval while LLM processes.
   No placeholder "Thinking..." message.
4. **No streaming in MVP**: Wait for full LLM response, send single message.
5. **MarkdownV2**: Telegram MarkdownV2 formatting. Fallback to plain text on parse error.
6. **Rate limiting**: Per-user + per-chat sliding window. Queue with bounded concurrency + timeout.
7. **Guardrails**: Input checking via external LLM. Fail-open on provider error. Output is NOT checked.
8. **SQLite logging**: Events logged with secrets redacted. Full user message text is NOT stored.
   SHA256 hash is stored for audit traceability instead.
