# Telegram LLM Bot — Agent Instructions

## Project
Node.js ≥22 TypeScript bot. ESM (`"type": "module"`). SQLite + Grammy + Zod + YAML config.

## Commands
- `npm run dev` — run via `tsx` (no build needed)
- `npm run build` — `tsc` to `dist/`
- `npm start` — run compiled `dist/index.js`
- `npm test` — vitest run
- `npm run test:watch` — vitest watch
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — biome check
- `npm run lint:fix` — biome check --write
- `npm run format` — biome format --write

**Order:** `lint:fix` → `typecheck` → `test` before claiming done.

## Config & Secrets
- `.env` required (see `.env.template`). Never commit it.
- `config/production/config.yaml` required at runtime. `config/production/` is gitignored.
- Example configs live in `config/examples/`.
- Config references env var names (e.g., `apiKeyEnv`), never raw secrets.

## TypeScript
- Strict: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` are enabled. Build fails on unused variables.
- Module resolution: `NodeNext`. Imports need `.js` extensions even for `.ts` files.
- Tests are excluded from `tsconfig.json`; they are type-checked by vitest.

## Architecture
- Entry: `src/index.ts` → `createApp()` in `src/app.ts`.
- `createApp()` wires all services (bot, LLM, guardrails, SQLite, health server) via dependency injection through `overrides`.
- Tests mirror `src/` structure under `tests/`.
- Integration tests use in-memory/fake implementations injected via `overrides`.

## Docker
- `docker compose up --build` mounts `./config/production:/app/config/production:ro` and `./data:/app/data`.
- Port 3000 is healthcheck/webhook.

## Style & Workflow
- Biome handles linting and formatting. Do not add ESLint or Prettier config.
- Do not add new dependencies without verifying if existing ones suffice.
- Keep changes surgical. The codebase follows simplicity-first and goal-driven patterns.

## Behavioral Guidelines

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If something is unclear, stop and ask.

### 2. Simplicity First
- Minimum code that solves the problem. No speculative abstractions.
- No features beyond what was asked.
- No error handling for impossible scenarios.

### 3. Surgical Changes
- Touch only what you must.
- Match existing style, even if you'd do it differently.
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

### 4. Goal-Driven Execution
- Define success criteria. Loop until verified.
- For multi-step tasks, state a brief plan with verification steps.
