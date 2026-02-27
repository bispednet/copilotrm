/**
 * integrations-telegram — Telegram Bot API client reale.
 * Zero dipendenze esterne — usa fetch nativo (Node 18+).
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN              → token dal BotFather
 *   TELEGRAM_ID_APPROVE_BOT         → chat/group IDs dove il bot può rispondere (virgola-separati)
 *   TELEGRAM_CHANNEL_ID_APPROVE_POST → channel IDs dove il bot può postare (virgola-separati)
 *   TELEGRAM_DEFAULT_CHAT_ID        → chat_id di default per invio diretto
 */
import type { CommunicationDraft } from '@bisp/shared-types';

// ─── Tipi Bot API ─────────────────────────────────────────────────────────────

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendMessageOptions {
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
  disableNotification?: boolean;
  replyToMessageId?: number;
  inlineKeyboard?: InlineKeyboardButton[][];
}

export interface TelegramSendResult {
  ok: boolean;
  provider: 'telegram';
  messageId?: number;
  chatId?: number | string;
  error?: string;
}

// ─── TelegramBotClient (raw HTTP) ────────────────────────────────────────────

export class TelegramBotClient {
  private readonly apiBase: string;

  constructor(
    private readonly token: string,
    apiBase = 'https://api.telegram.org'
  ) {
    this.apiBase = apiBase;
  }

  private async call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${this.apiBase}/bot${this.token}/${method}`, {
        method: body ? 'POST' : 'GET',
        signal: controller.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: T;
        description?: string;
        error_code?: number;
      };
      if (!data.ok) {
        throw new Error(`Telegram ${method} [${data.error_code ?? '?'}]: ${data.description ?? 'unknown error'}`);
      }
      return data.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>('getMe');
  }

  async sendMessage(chatId: string | number, text: string, opts?: SendMessageOptions): Promise<TelegramMessage> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: opts?.parseMode ?? 'HTML',
    };
    if (opts?.disableWebPagePreview) body.disable_web_page_preview = true;
    if (opts?.disableNotification) body.disable_notification = true;
    if (opts?.replyToMessageId) body.reply_to_message_id = opts.replyToMessageId;
    if (opts?.inlineKeyboard) body.reply_markup = { inline_keyboard: opts.inlineKeyboard };
    return this.call<TelegramMessage>('sendMessage', body);
  }

  async getUpdates(offset?: number, limit = 100): Promise<TelegramUpdate[]> {
    const body: Record<string, unknown> = { limit, timeout: 0 };
    if (offset !== undefined) body.offset = offset;
    return this.call<TelegramUpdate[]>('getUpdates', body);
  }

  async setWebhook(url: string, secretToken?: string): Promise<boolean> {
    const body: Record<string, unknown> = { url };
    if (secretToken) body.secret_token = secretToken;
    return this.call<boolean>('setWebhook', body);
  }

  async deleteWebhook(): Promise<boolean> {
    return this.call<boolean>('deleteWebhook');
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    return this.call<boolean>('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
  }
}

// ─── Channel adapter ──────────────────────────────────────────────────────────

function getEnv(key: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
}

function parseChatIds(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export class TelegramChannelAdapter {
  readonly client: TelegramBotClient | null;
  private readonly channelIds: string[];
  private readonly groupIds: string[];

  constructor(config?: { token?: string }) {
    const token = config?.token ?? getEnv('TELEGRAM_BOT_TOKEN');
    this.client = token ? new TelegramBotClient(token) : null;
    this.channelIds = parseChatIds(getEnv('TELEGRAM_CHANNEL_ID_APPROVE_POST'));
    this.groupIds = parseChatIds(getEnv('TELEGRAM_ID_APPROVE_BOT'));
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /** Invia un messaggio a un chat_id specifico */
  async sendMessage(chatId: string | number, text: string, opts?: SendMessageOptions): Promise<TelegramSendResult> {
    if (!this.client) {
      return { ok: false, provider: 'telegram', error: 'TELEGRAM_BOT_TOKEN non configurato' };
    }
    try {
      const msg = await this.client.sendMessage(chatId, text, opts);
      return { ok: true, provider: 'telegram', messageId: msg.message_id, chatId: msg.chat.id };
    } catch (err) {
      return {
        ok: false,
        provider: 'telegram',
        chatId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Invia un draft di comunicazione.
   * Risolve il chat_id da (priorità):
   *   1. `chatId` parametro esplicito
   *   2. `draft.recipientRef`
   *   3. `TELEGRAM_DEFAULT_CHAT_ID` env var
   * Se nessun chat_id → queued: true (in attesa di invio manuale).
   */
  async queueOfferMessage(
    draft: CommunicationDraft,
    chatId?: string
  ): Promise<{ queued: boolean; sent: boolean; channel: string; messageId?: number; error?: string }> {
    const targetChatId = chatId ?? draft.recipientRef ?? getEnv('TELEGRAM_DEFAULT_CHAT_ID');

    if (!this.client || !targetChatId) {
      return { queued: true, sent: false, channel: 'telegram' };
    }

    const result = await this.sendMessage(targetChatId, draft.body, { parseMode: 'HTML' });
    if (result.ok) {
      return { queued: false, sent: true, channel: 'telegram', messageId: result.messageId };
    }
    return { queued: true, sent: false, channel: 'telegram', error: result.error };
  }

  /**
   * Broadcast su canali configurati (one-to-many).
   * Usa TELEGRAM_CHANNEL_ID_APPROVE_POST per i canali.
   */
  async broadcastToChannels(text: string, opts?: SendMessageOptions): Promise<TelegramSendResult[]> {
    if (!this.client || this.channelIds.length === 0) return [];
    return Promise.all(this.channelIds.map((id) => this.sendMessage(id, text, opts)));
  }

  /**
   * Broadcast a gruppi configurati (notifiche team / approvazioni).
   * Usa TELEGRAM_ID_APPROVE_BOT.
   */
  async broadcastToGroups(text: string, opts?: SendMessageOptions): Promise<TelegramSendResult[]> {
    if (!this.client || this.groupIds.length === 0) return [];
    return Promise.all(this.groupIds.map((id) => this.sendMessage(id, text, opts)));
  }
}
