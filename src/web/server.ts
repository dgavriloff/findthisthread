import { Hono } from 'hono';
import { MentionsDB, MentionRecord } from '../db/mentions';
import { Mention, WebhookPayload } from '../twitter/types';

export interface BotState {
  lastCheckTime: number;
  nextCheckTime: number;
  pollIntervalMs: number;
  isRunning: boolean;
}

export interface WebhookConfig {
  apiKey: string;
  onMention: (mention: Mention) => Promise<void>;
  onBroadcast: () => void;
}

export function createServer(
  db: MentionsDB,
  getState: () => BotState,
  onRefresh?: () => void,
  onReprocess?: (mentionId: string) => Promise<{ success: boolean; message: string; url?: string }>,
  webhookConfig?: WebhookConfig
) {
  const app = new Hono();

  // Health check endpoint (for Railway)
  app.get('/health', (c) => c.text('OK'));
  app.get('/', (c) => c.json({ status: 'ok', service: 'findthisthread-api' }));

  // Webhook: Receive mentions from twitterapi.io
  app.post('/webhook/twitter', async (c) => {
    if (!webhookConfig) {
      return c.json({ error: 'Webhook not configured' }, 503);
    }

    // Verify API key
    const apiKey = c.req.header('X-API-Key') || c.req.header('x-api-key');
    if (!apiKey || apiKey !== webhookConfig.apiKey) {
      console.log('Webhook received with invalid API key');
      return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
      const payload = await c.req.json<WebhookPayload>();
      console.log(`Webhook received: ${payload.tweets?.length || 0} tweets, event: ${payload.event_type}`);

      if (!payload.tweets || payload.tweets.length === 0) {
        return c.json({ success: true, message: 'No tweets to process' });
      }

      // Process each tweet asynchronously (don't block the webhook response)
      const processPromises = payload.tweets.map(async (tweet) => {
        const mention: Mention = {
          id: tweet.id,
          text: tweet.text,
          author_id: tweet.author?.id || '',
          author_username: tweet.author?.username || tweet.author?.userName || '',
          in_reply_to_status_id: tweet.inReplyToId || tweet.in_reply_to_status_id,
          created_at: tweet.createdAt || tweet.created_at || new Date().toISOString(),
        };

        try {
          await webhookConfig.onMention(mention);
          webhookConfig.onBroadcast();
        } catch (err) {
          console.error(`Error processing webhook mention ${mention.id}:`, err);
        }
      });

      // Process in background, respond immediately
      Promise.all(processPromises).catch(console.error);

      return c.json({ success: true, message: `Processing ${payload.tweets.length} tweet(s)` });
    } catch (err) {
      console.error('Webhook parse error:', err);
      return c.json({ error: 'Invalid payload' }, 400);
    }
  });

  // API: Get bot status and timer info
  app.get('/api/status', (c) => {
    const state = getState();
    const stats = db.getStats();
    return c.json({
      ...state,
      stats,
      currentTime: Date.now(),
      timeUntilNextCheck: Math.max(0, state.nextCheckTime - Date.now()),
    });
  });

  // API: Trigger manual refresh
  app.post('/api/refresh', (c) => {
    if (onRefresh) {
      onRefresh();
      return c.json({ success: true, message: 'Refresh triggered' });
    }
    return c.json({ success: false, message: 'Refresh not available' }, 503);
  });

  // API: Reprocess a mention
  app.post('/api/reprocess/:id', async (c) => {
    const mentionId = c.req.param('id');
    if (onReprocess) {
      const result = await onReprocess(mentionId);
      return c.json(result);
    }
    return c.json({ success: false, message: 'Reprocess not available' }, 503);
  });

  // API: Get all mentions
  app.get('/api/mentions', (c) => {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 500);
    const mentions = db.getAllMentions(limit);
    return c.json({ mentions });
  });

  // API: Get recent successes
  app.get('/api/successes', (c) => {
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10', 10) || 10, 1), 100);
    const successes = db.getRecentSuccesses(limit);
    return c.json({ successes });
  });

  // API: Get single mention
  app.get('/api/mentions/:id', (c) => {
    const mention = db.getMention(c.req.param('id'));
    if (!mention) {
      return c.json({ error: 'Mention not found' }, 404);
    }
    return c.json({ mention });
  });

  return app;
}
