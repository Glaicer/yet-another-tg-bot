export type UpdateParserConfig = {
  allowedChatId: number;
  adminUserId: number;
  botUsername: string;
  botId?: number;
};

export type ParsedEvent =
  | { type: 'ignored' }
  | {
      type: 'new_chat_member';
      chatId: number;
      threadId?: number;
      userId: number;
    }
  | {
      type: 'group_request';
      chatId: number;
      threadId?: number;
      userId: number;
      text: string;
      repliedText?: string;
    }
  | {
      type: 'group_command';
      chatId: number;
      threadId?: number;
      userId: number;
      command: string;
      args: string;
      repliedText?: string;
    }
  | {
      type: 'admin_command';
      userId: number;
      command: string;
      args: string;
    }
  | {
      type: 'admin_request';
      chatId: number;
      userId: number;
      text: string;
    }
  | {
      type: 'unsupported_reply';
      chatId: number;
      threadId?: number;
      userId: number;
    }
  | { type: 'no-op' };
