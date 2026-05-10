import type { Message } from 'grammy/types';
import type { ParsedEvent, UpdateParserConfig } from './types.js';

export function parseMessage(message: Message, config: UpdateParserConfig): ParsedEvent {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const threadId = message.message_thread_id;

  if (userId === undefined) {
    return { type: 'no-op' };
  }

  // Private chat handling
  if (message.chat.type === 'private') {
    if (userId === config.adminUserId) {
      if (message.text && isCommand(message.text)) {
        const { command, args } = parseCommand(message.text);
        return { type: 'admin_command', userId, command, args };
      }
      return { type: 'no-op' };
    }
    return { type: 'ignored' };
  }

  // Not the allowed chat
  if (chatId !== config.allowedChatId) {
    return { type: 'ignored' };
  }

  // Allowed group but no text
  if (!message.text) {
    return { type: 'no-op' };
  }

  const text = message.text;
  const strippedText = stripBotMention(text, config);

  // Check group command
  const groupCmd = parseGroupCommand(strippedText, config) ?? parseGroupCommand(text, config);

  // If there is a command syntax targeting another bot, don't respond at all
  if ((isCommand(strippedText) || isCommand(text)) && !groupCmd) {
    return { type: 'no-op' };
  }

  const isMentioned = isBotMentioned(text, config);
  const isReplyToBot = isReplyToBotMessage(message, config);
  const isInvoked = groupCmd !== null || isMentioned || isReplyToBot;

  if (!isInvoked) {
    return { type: 'no-op' };
  }

  // Check for unsupported replied media before dispatching
  if (
    message.reply_to_message &&
    !extractMessageText(message.reply_to_message) &&
    !extractQuoteText(message) &&
    !isForumTopicServiceMessage(message.reply_to_message)
  ) {
    return { type: 'unsupported_reply', chatId, threadId, userId };
  }

  if (groupCmd) {
    const repliedText = extractRepliedText(message);
    return {
      type: 'group_command',
      chatId,
      threadId,
      userId,
      command: groupCmd.command,
      args: groupCmd.args,
      repliedText,
    };
  }

  const cleanedText = stripBotMention(text, config);
  const repliedText = extractRepliedText(message);
  return {
    type: 'group_request',
    chatId,
    threadId,
    userId,
    text: cleanedText,
    repliedText,
  };
}

function isCommand(text: string): boolean {
  return /^\/\w+/.test(text);
}

function parseCommand(text: string): { command: string; args: string } {
  const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/s);
  if (!match) {
    return { command: '', args: '' };
  }
  return { command: match[1], args: (match[2] || '').trim() };
}

function parseGroupCommand(
  text: string,
  config: UpdateParserConfig,
): { command: string; args: string } | null {
  const match = text.match(/^\/(\w+)(?:@(\w+))?(?:\s+(.*))?$/s);
  if (!match) return null;

  const targetBot = match[2];
  if (targetBot && targetBot.toLowerCase() !== config.botUsername.toLowerCase()) {
    return null;
  }

  return { command: match[1], args: (match[3] || '').trim() };
}

function isBotMentioned(text: string, config: UpdateParserConfig): boolean {
  const pattern = new RegExp(`@${escapeRegex(config.botUsername)}\\b`, 'i');
  return pattern.test(text);
}

function isReplyToBotMessage(message: Message, config: UpdateParserConfig): boolean {
  if (!message.reply_to_message) return false;
  const replyFrom = message.reply_to_message.from;
  if (!replyFrom) return false;
  if (config.botId !== undefined && replyFrom.id === config.botId) return true;
  if (replyFrom.username && replyFrom.username.toLowerCase() === config.botUsername.toLowerCase()) {
    return true;
  }
  return false;
}

function extractRepliedText(message: Message): string | undefined {
  if (message.reply_to_message) {
    return extractMessageText(message.reply_to_message);
  }
  return extractQuoteText(message);
}

function extractMessageText(message: Message): string | undefined {
  if (message.text) return message.text;
  if (message.caption) return message.caption;
  return extractQuoteText(message);
}

function extractQuoteText(message: Message): string | undefined {
  const quote = (message as { quote?: { text?: unknown } }).quote;
  return typeof quote?.text === 'string' ? quote.text : undefined;
}

function isForumTopicServiceMessage(message: Message): boolean {
  return (
    message.forum_topic_created !== undefined ||
    message.forum_topic_edited !== undefined ||
    message.forum_topic_closed !== undefined ||
    message.forum_topic_reopened !== undefined ||
    message.general_forum_topic_hidden !== undefined ||
    message.general_forum_topic_unhidden !== undefined
  );
}

function stripBotMention(text: string, config: UpdateParserConfig): string {
  const pattern = new RegExp(`@${escapeRegex(config.botUsername)}\\b`, 'gi');
  return text.replace(pattern, '').replace(/\s+/g, ' ').trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
