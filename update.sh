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
err()   { printf "${RED}  err:${NC} %s\n" "$1" >&2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

printf "\n${BOLD}╔══════════════════════════════════════╗\n"
printf "║  Yet Another TG Bot — Updater        ║\n"
printf "╚══════════════════════════════════════╝${NC}\n\n"

# ── 1. Pull latest changes ────────────────────────────────────────────────────

info "Fetching latest changes from git"
OLD_REV="$(git rev-parse HEAD)"
git pull --ff-only
NEW_REV="$(git rev-parse HEAD)"

if [ "$OLD_REV" = "$NEW_REV" ]; then
  ok "Already up to date (${OLD_REV:0:7})"
  printf "\n"
  exit 0
fi

ok "Updated ${OLD_REV:0:7} → ${NEW_REV:0:7}"

# ── 2. Rebuild and restart ────────────────────────────────────────────────────

info "Stopping containers"
docker compose down

info "Rebuilding and starting containers"
docker compose up --build -d

ok "Containers restarted"

# ── 3. Show status ────────────────────────────────────────────────────────────

printf "\n"
docker compose ps
printf "\n"
info "Follow logs with: docker compose logs -f\n"
