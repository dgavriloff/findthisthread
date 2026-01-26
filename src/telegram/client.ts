const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

export class TelegramClient {
  private botToken: string;
  private chatId: string;
  private timeoutMs: number;
  private lastUpdateId: number = 0;

  constructor(botToken: string, chatId: string, timeoutMs: number = 60000) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.timeoutMs = timeoutMs;
  }

  private async request<T>(method: string, params: Record<string, any> = {}): Promise<T> {
    const url = `${TELEGRAM_API_BASE}${this.botToken}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram API error (${response.status}): ${text}`);
    }

    const data = await response.json() as { ok: boolean; result: T; description?: string };
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`);
    }

    return data.result;
  }

  async sendMessage(text: string, replyMarkup?: any): Promise<{ message_id: number }> {
    return this.request<{ message_id: number }>('sendMessage', {
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  }

  async getUpdates(offset?: number, timeout: number = 30): Promise<any[]> {
    return this.request<any[]>('getUpdates', {
      offset,
      timeout,
      allowed_updates: ['message'],
    });
  }

  async clearPendingUpdates(): Promise<void> {
    // Get all pending updates and mark them as read
    const updates = await this.getUpdates(undefined, 0);
    if (updates.length > 0) {
      this.lastUpdateId = updates[updates.length - 1].update_id + 1;
    }
  }

  /**
   * Request approval for a reply. Sends a message and waits for a response.
   * @returns The custom reply text if user responds, or null if timeout/skip
   */
  async requestApproval(context: {
    mentionAuthor: string;
    redditUrl: string;
    extractedTitle?: string;
    extractedSubreddit?: string;
    tweetUrl: string;
    defaultReply: string;
  }): Promise<{ approved: boolean; customText?: string }> {
    const defaultReply = context.defaultReply;

    // Build the message
    let message = `<b>New mention from @${context.mentionAuthor}</b>\n\n`;
    if (context.extractedTitle) {
      message += `<b>Title:</b> ${this.escapeHtml(context.extractedTitle)}\n`;
    }
    if (context.extractedSubreddit) {
      message += `<b>Subreddit:</b> r/${context.extractedSubreddit}\n`;
    }
    message += `<b>Reddit:</b> ${context.redditUrl}\n`;
    message += `<b>Tweet:</b> ${context.tweetUrl}\n\n`;
    message += `<b>Default reply:</b>\n<code>${this.escapeHtml(defaultReply)}</code>\n\n`;
    message += `Reply with custom text, or wait 1 min to send default.\nSend "skip" to not reply.`;

    // Clear any pending updates first
    await this.clearPendingUpdates();

    // Send the message
    await this.sendMessage(message);

    // Wait for response with timeout
    const startTime = Date.now();
    const pollInterval = 2000; // Check every 2 seconds

    while (Date.now() - startTime < this.timeoutMs) {
      try {
        const updates = await this.getUpdates(this.lastUpdateId, 2);

        for (const update of updates) {
          this.lastUpdateId = update.update_id + 1;

          // Check if it's a message from our chat
          if (update.message?.chat?.id?.toString() === this.chatId) {
            const text = update.message.text?.trim();

            if (text?.toLowerCase() === 'skip') {
              await this.sendMessage('Skipped reply.');
              return { approved: false };
            }

            if (text) {
              // User provided custom text
              await this.sendMessage(`Sending custom reply:\n<code>${this.escapeHtml(text)}</code>`);
              return { approved: true, customText: text };
            }
          }
        }
      } catch (error) {
        console.error('Error polling Telegram:', error);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout - send default
    await this.sendMessage('Timeout. Sending default reply.');
    return { approved: true };
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
