#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${CYAN}  info:${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}    ok:${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}  warn:${NC} %s\n" "$1"; }
err()   { printf "${RED}  err:${NC} %s\n" "$1" >&2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

copy_if_missing() {
  local src="$1" dest="$2" label="$3"
  if [ -f "$dest" ]; then
    warn "$label already exists — skipped"
  else
    cp "$src" "$dest"
    ok "Created $label"
  fi
}

prompt_value() {
  local varname="$1" prompt_text="$2"
  if [ -z "${!varname:-}" ]; then
      printf "  ${BOLD}${prompt_text}:${NC} "
    read -r value
    printf '%s=%s\n' "$varname" "$value" >> "$SCRIPT_DIR/.env"
  else
    printf '%s=%s\n' "$varname" "${!varname}" >> /dev/null
  fi
}

printf "\n${BOLD}╔══════════════════════════════════════╗\n"
printf "║  Yet Another TG Bot — Installer      ║\n"
printf "╚══════════════════════════════════════╝${NC}\n\n"

# ── 1. .env ──────────────────────────────────────────────────────────────────

info "Setting up environment variables"
if [ -f .env ]; then
  warn ".env already exists — skipping setup"
else
  printf '# Yet Another TG Bot\n' > .env

  printf "\n${BOLD}Required secrets${NC}\n"

  prompt_value "TELEGRAM_BOT_TOKEN"      "Telegram Bot Token (from @BotFather)"
  prompt_value "TELEGRAM_ALLOWED_CHAT_ID" "Allowed Chat ID (group ID where bot operates)"
  prompt_value "TELEGRAM_ADMIN_USER_ID"   "Admin User ID (your Telegram user ID)"
  prompt_value "MAIN_LLM_API_KEY"         "Main LLM API Key"
  prompt_value "GUARDRAILS_API_KEY"        "Guardrails API Key"

  printf "\n${BOLD}Optional settings${NC}\n"
  prompt_value "FIRECRAWL_API_KEY"        "Firecrawl API key (optional, press Enter to skip)" ""

  printf 'SQLITE_DATABASE_PATH=./data/bot.sqlite\n' >> .env

  printf "\n${BOLD}Provider API keys (optional)${NC}\n"

  printf 'OPENAI_API_KEY=\n' >> .env
  printf 'OPENROUTER_API_KEY=\n' >> .env
  printf 'OLLAMA_CLOUD_API_KEY=\n' >> .env
  printf 'OPENCODE_GO_API_KEY=\n' >> .env

  printf "\n"
  ok "Secrets written to .env"
fi

# ── 2. Production config ─────────────────────────────────────────────────────

info "Setting up production config"

mkdir -p config/production/characters config/production/prompts

copy_if_missing "config/examples/config.yaml"        "config/production/config.yaml"        "config/production/config.yaml"
copy_if_missing "config/examples/characters/default.md" "config/production/characters/default.md" "default character"
copy_if_missing "config/examples/prompts/system.md"   "config/production/prompts/system.md"   "system prompt"

# ── 3. Data directory ─────────────────────────────────────────────────────────

mkdir -p data
ok "Ensured data/ directory exists"

# ── Summary ───────────────────────────────────────────────────────────────────

printf "\n${BOLD}Setup complete.${NC}\n\n"

printf "Before starting the bot, review and edit these files:\n\n"
printf "  ${BOLD}1.${NC}  ${CYAN}.env${NC}                            — all secrets and API keys\n"
printf "  ${BOLD}2.${NC}  ${CYAN}config/production/config.yaml${NC}   — LLM model, guardrails, rate limits\n"
printf "  ${BOLD}3.${NC}  ${CYAN}config/production/prompts/system.md${NC} — bot personality and behavior\n"
printf "  ${BOLD}4.${NC}  ${CYAN}config/production/characters/${NC}      — add or edit character .md files\n\n"

printf "When ready, start the bot:\n\n"
printf "  ${GREEN}docker compose up --build -d${NC}\n\n"

printf "Check logs:\n\n"
printf "  ${GREEN}docker compose logs -f${NC}\n\n"
