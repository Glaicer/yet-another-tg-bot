import type { Message } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import type { UpdateParserConfig } from '../../src/telegram/types.js';
import { parseMessage } from '../../src/telegram/updateParser.js';

const BASE_CONFIG: UpdateParserConfig = {
  allowedChatId: -1001234567890,
  adminUserId: 12345,
  botUsername: 'testbot',
  botId: 999,
};

function makeMessage(
  partial: Partial<Message> & { chat: Message['chat']; from?: Message['from'] },
): Message {
  return {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    ...partial,
  } as Message;
}

function makeUser(id: number, username?: string): NonNullable<Message['from']> {
  return {
    id,
    is_bot: false,
    first_name: 'User',
    username,
  };
}

function makeBotUser(id: number, username: string): NonNullable<Message['from']> {
  return {
    id,
    is_bot: true,
    first_name: 'Bot',
    username,
  };
}

function makePrivateChat(id: number): Message['chat'] {
  return { id, type: 'private', first_name: 'User', username: 'user' };
}

function makeSupergroupChat(id: number): Message['chat'] {
  return { id, type: 'supergroup', title: 'Test Group' };
}

describe('parseMessage', () => {
  it('returns ignored for non-allowed group chat', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(-1009999999999),
      from: makeUser(111),
      text: 'Hello @testbot',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('ignored');
  });

  it('returns ignored for non-admin private command', () => {
    const message = makeMessage({
      chat: makePrivateChat(111),
      from: makeUser(111),
      text: '/status',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('ignored');
  });

  it('returns no-op for non-command admin private message', () => {
    const message = makeMessage({
      chat: makePrivateChat(BASE_CONFIG.adminUserId),
      from: makeUser(BASE_CONFIG.adminUserId),
      text: 'Hello bot',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('no-op');
  });

  it('returns admin_command for admin private command', () => {
    const message = makeMessage({
      chat: makePrivateChat(BASE_CONFIG.adminUserId),
      from: makeUser(BASE_CONFIG.adminUserId),
      text: '/status',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result).toEqual({
      type: 'admin_command',
      userId: BASE_CONFIG.adminUserId,
      command: 'status',
      args: '',
    });
  });

  it('parses admin command with args', () => {
    const message = makeMessage({
      chat: makePrivateChat(BASE_CONFIG.adminUserId),
      from: makeUser(BASE_CONFIG.adminUserId),
      text: '/persona wizard',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result).toEqual({
      type: 'admin_command',
      userId: BASE_CONFIG.adminUserId,
      command: 'persona',
      args: 'wizard',
    });
  });

  it('returns no-op for unrelated group message', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: 'Just a regular message',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('no-op');
  });

  it('returns no-op for group message without text or caption', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('no-op');
  });

  it('returns unsupported_reply for image reply to bot without caption', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeBotUser(BASE_CONFIG.botId ?? 999, BASE_CONFIG.botUsername),
        text: 'Previous answer',
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('unsupported_reply');
    if (result.type === 'unsupported_reply') {
      expect(result.chatId).toBe(BASE_CONFIG.allowedChatId);
      expect(result.userId).toBe(111);
    }
  });

  it('returns unsupported_reply for image with caption mentioning bot', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      caption: '@testbot what do you think?',
      photo: [{ file_id: 'abc', file_unique_id: 'def', width: 100, height: 100 }],
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('unsupported_reply');
    if (result.type === 'unsupported_reply') {
      expect(result.chatId).toBe(BASE_CONFIG.allowedChatId);
      expect(result.userId).toBe(111);
    }
  });

  it('returns unsupported_reply for image with caption replying to bot', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      caption: 'Nice one',
      photo: [{ file_id: 'abc', file_unique_id: 'def', width: 100, height: 100 }],
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeBotUser(BASE_CONFIG.botId ?? 999, BASE_CONFIG.botUsername),
        text: 'Previous answer',
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('unsupported_reply');
  });

  it('returns no-op for image with caption not mentioning bot', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      caption: 'Just a photo',
      photo: [{ file_id: 'abc', file_unique_id: 'def', width: 100, height: 100 }],
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('no-op');
  });

  it('returns group_request for mention in allowed group', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '@testbot What is the weather?',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result).toEqual({
      type: 'group_request',
      chatId: BASE_CONFIG.allowedChatId,
      userId: 111,
      text: 'What is the weather?',
    });
  });

  it('strips bot mention and normalizes whitespace', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '  @testbot   hello   world  ',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_request');
    if (result.type === 'group_request') {
      expect(result.text).toBe('hello world');
    }
  });

  it('preserves message_thread_id for topic groups', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '@testbot hello',
      message_thread_id: 42,
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_request');
    if (result.type === 'group_request') {
      expect(result.threadId).toBe(42);
    }
  });

  it('ignores forum topic service reply context for topic text messages', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '@testbot hello',
      message_thread_id: 42,
      is_topic_message: true,
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        forum_topic_created: {
          name: 'Support',
          icon_color: 0x6fb9f0,
        },
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result).toEqual({
      type: 'group_request',
      chatId: BASE_CONFIG.allowedChatId,
      threadId: 42,
      userId: 111,
      text: 'hello',
      repliedText: undefined,
    });
  });

  it('returns group_request for reply-to-bot without mention', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: 'Thanks for the info',
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeBotUser(BASE_CONFIG.botId ?? 999, BASE_CONFIG.botUsername),
        text: 'Here is the answer',
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_request');
    if (result.type === 'group_request') {
      expect(result.text).toBe('Thanks for the info');
      expect(result.repliedText).toBe('Here is the answer');
    }
  });

  it('returns group_request for reply-to-other-user with mention', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '@testbot Can you explain this?',
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeUser(222),
        text: 'The sky is blue',
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_request');
    if (result.type === 'group_request') {
      expect(result.text).toBe('Can you explain this?');
      expect(result.repliedText).toBe('The sky is blue');
    }
  });

  it('returns group_request for reply-to-bot by username match', () => {
    const config: UpdateParserConfig = { ...BASE_CONFIG, botId: undefined };
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: 'Follow up question',
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeBotUser(888, BASE_CONFIG.botUsername),
        text: 'Previous answer',
      }),
    });
    const result = parseMessage(message, config);
    expect(result.type).toBe('group_request');
    if (result.type === 'group_request') {
      expect(result.repliedText).toBe('Previous answer');
    }
  });

  it('returns group_command for command in allowed group', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '/help',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result).toEqual({
      type: 'group_command',
      chatId: BASE_CONFIG.allowedChatId,
      userId: 111,
      command: 'help',
      args: '',
    });
  });

  it('returns group_command with args', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '/search how to bake bread',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_command');
    if (result.type === 'group_command') {
      expect(result.command).toBe('search');
      expect(result.args).toBe('how to bake bread');
    }
  });

  it('returns group_command when mentioned alongside command', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '@testbot /help',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_command');
    if (result.type === 'group_command') {
      expect(result.command).toBe('help');
    }
  });

  it('ignores command targeting another bot', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '/help@otherbot',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('no-op');
  });

  it('ignores command targeting another bot even when mentioned', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '/help@otherbot @testbot',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('no-op');
  });

  it('returns unsupported_reply when replying to unsupported media', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '@testbot What is this?',
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeUser(222),
        // no text field - simulating a photo/video message
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('unsupported_reply');
    if (result.type === 'unsupported_reply') {
      expect(result.chatId).toBe(BASE_CONFIG.allowedChatId);
      expect(result.userId).toBe(111);
    }
  });

  it('returns unsupported_reply for reply-to-bot media without mention', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: 'Nice photo',
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeBotUser(BASE_CONFIG.botId ?? 999, BASE_CONFIG.botUsername),
        // no text - bot sent a photo
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('unsupported_reply');
  });

  it('returns group_request with empty text for mention-only message', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '@testbot',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_request');
    if (result.type === 'group_request') {
      expect(result.text).toBe('');
    }
  });

  it('returns no-op when message has no from field', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      text: '@testbot hello',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('no-op');
  });

  it('extracts repliedText for group command with text reply', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '/search',
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeUser(222),
        text: 'What is quantum computing?',
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_command');
    if (result.type === 'group_command') {
      expect(result.repliedText).toBe('What is quantum computing?');
    }
  });

  it('extracts replied caption for group command', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '/search proof check this',
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeUser(222),
        caption: 'Original caption to verify',
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_command');
    if (result.type === 'group_command') {
      expect(result.repliedText).toBe('Original caption to verify');
    }
  });

  it('extracts quoted reply text for group command when reply text is unavailable', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '/search proof check this',
      quote: {
        text: 'Quoted part to verify',
        position: 0,
      },
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_command');
    if (result.type === 'group_command') {
      expect(result.repliedText).toBe('Quoted part to verify');
    }
  });

  it('returns unsupported_reply for group command replying to media', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '/search',
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeUser(222),
        // no text - media message
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('unsupported_reply');
  });

  it('preserves threadId for unsupported_reply', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '@testbot explain',
      message_thread_id: 7,
      reply_to_message: makeMessage({
        chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
        from: makeUser(222),
        // no text
      }),
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('unsupported_reply');
    if (result.type === 'unsupported_reply') {
      expect(result.threadId).toBe(7);
    }
  });

  it('is case-insensitive for bot username in mentions', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '@TestBot hello',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_request');
    if (result.type === 'group_request') {
      expect(result.text).toBe('hello');
    }
  });

  it('is case-insensitive for bot username in commands', () => {
    const message = makeMessage({
      chat: makeSupergroupChat(BASE_CONFIG.allowedChatId),
      from: makeUser(111),
      text: '/help@TestBot',
    });
    const result = parseMessage(message, BASE_CONFIG);
    expect(result.type).toBe('group_command');
    if (result.type === 'group_command') {
      expect(result.command).toBe('help');
    }
  });
});
