import type { BotEvent, ConsoleEvent, GuardrailEvent } from '../storage/logger.js';
import { type SearchCommandDeps, handleSearch } from './searchCommand.js';
import type { ParsedEvent } from './types.js';

export type CharacterStore = {
  getCurrentCharacter(): { name: string; content: string };
  listCharacters(): string[];
  selectCharacter(name: string): boolean;
};

export type LoggerLike = {
  logBotEvent(event: BotEvent): void;
  logGuardrailEvent(event: GuardrailEvent): void;
  logConsoleEvent(event: ConsoleEvent): void;
};

export type CommandDeps = SearchCommandDeps & {
  characterStore: CharacterStore;
  getUptimeSeconds: () => number;
};

export async function handleGroupCommand(
  deps: CommandDeps,
  event: Extract<ParsedEvent, { type: 'group_command' }>,
): Promise<void> {
  switch (event.command) {
    case 'help': {
      await handleHelp(deps, event);
      return;
    }
    case 'search': {
      await handleSearch(deps, event);
      return;
    }
    default: {
      return;
    }
  }
}

export async function handleAdminCommand(
  deps: CommandDeps,
  event: Extract<ParsedEvent, { type: 'admin_command' }>,
): Promise<void> {
  switch (event.command) {
    case 'status': {
      await handleStatus(deps, event);
      return;
    }
    case 'personas': {
      await handlePersonas(deps, event);
      return;
    }
    case 'persona': {
      await handlePersona(deps, event);
      return;
    }
    case 'search': {
      await handleSearch(deps, event);
      return;
    }
    default: {
      return;
    }
  }
}

function formatStatus(deps: CommandDeps): string {
  const character = deps.characterStore.getCurrentCharacter();
  const uptime = deps.getUptimeSeconds();
  const { config } = deps;

  const lines = [
    config.messages.statusTitle,
    '',
    `Provider: ${config.llm.provider}`,
    `Model: ${config.llm.model}`,
    `API mode: ${config.llm.apiMode}`,
    `Character: ${character.name}`,
    `Guardrails: ${config.guardrails.enabled ? 'enabled' : 'disabled'}`,
    `Telegram mode: ${config.telegram.mode}`,
    `Web search: ${config.llm.supportsWebSearch ? 'available' : 'unavailable'}`,
    `SQLite: ${config.storage.databasePath}`,
    `Uptime: ${formatUptime(uptime)}`,
  ];

  return lines.join('\n');
}

async function handleHelp(
  deps: CommandDeps,
  event: Extract<ParsedEvent, { type: 'group_command' }>,
): Promise<void> {
  const lines = [deps.config.messages.helpText];

  if (deps.config.llm.supportsWebSearch) {
    lines.push('');
    lines.push(deps.config.messages.helpSearchHint);
  }

  const text = lines.join('\n');

  await deps.sendSafeMessage({ api: deps.api, logger: deps.logger }, event.chatId, text, {
    threadId: event.threadId,
  });

  deps.logger.logBotEvent({
    type: 'command_help',
    chatId: String(event.chatId),
    userId: String(event.userId),
  });
}

async function handleStatus(
  deps: CommandDeps,
  event: Extract<ParsedEvent, { type: 'admin_command' }>,
): Promise<void> {
  const text = formatStatus(deps);

  await deps.sendSafeMessage({ api: deps.api, logger: deps.logger }, event.chatId, text);

  deps.logger.logBotEvent({
    type: 'command_status',
    userId: String(event.userId),
  });
}

async function handlePersonas(
  deps: CommandDeps,
  event: Extract<ParsedEvent, { type: 'admin_command' }>,
): Promise<void> {
  const names = deps.characterStore.listCharacters();
  const text =
    names.length > 0
      ? deps.config.messages.personasAvailable.replace(
          '{list}',
          names.map((n) => `• ${n}`).join('\n'),
        )
      : deps.config.messages.personasEmpty;

  await deps.sendSafeMessage({ api: deps.api, logger: deps.logger }, event.chatId, text);

  deps.logger.logBotEvent({
    type: 'command_personas',
    userId: String(event.userId),
  });
}

async function handlePersona(
  deps: CommandDeps,
  event: Extract<ParsedEvent, { type: 'admin_command' }>,
): Promise<void> {
  const name = event.args.trim();
  if (!name) {
    await deps.sendSafeMessage(
      { api: deps.api, logger: deps.logger },
      event.chatId,
      deps.config.messages.personaMissingName,
    );
    return;
  }

  const ok = deps.characterStore.selectCharacter(name);
  if (!ok) {
    await deps.sendSafeMessage(
      { api: deps.api, logger: deps.logger },
      event.chatId,
      deps.config.messages.personaUnknown.replace('{name}', name),
    );
    deps.logger.logBotEvent({
      type: 'command_persona_rejected',
      userId: String(event.userId),
      metadata: { requestedName: name },
    });
    return;
  }

  await deps.sendSafeMessage(
    { api: deps.api, logger: deps.logger },
    event.chatId,
    deps.config.messages.personaChanged.replace('{name}', name),
  );

  deps.logger.logBotEvent({
    type: 'command_persona_selected',
    userId: String(event.userId),
    metadata: { selectedName: name },
  });
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}
