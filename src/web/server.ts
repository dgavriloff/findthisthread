import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { MentionsDB, MentionRecord } from '../db/mentions';

export interface BotState {
  lastCheckTime: number;
  nextCheckTime: number;
  pollIntervalMs: number;
  isRunning: boolean;
}

export function createServer(
  db: MentionsDB,
  getState: () => BotState,
  onRefresh?: () => void,
  onReprocess?: (mentionId: string) => Promise<{ success: boolean; message: string; url?: string }>
) {
  const app = new Hono();

  // Health check endpoint (for Railway)
  app.get('/health', (c) => c.text('OK'));

  // Enable CORS for API routes
  app.use('/api/*', cors());

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

  // Serve static files from public directory
  app.use('/*', serveStatic({ root: './public' }));

  // Fallback to index.html for SPA routing
  app.get('*', async (c) => {
    try {
      const html = await Bun.file('./public/index.html').text();
      return c.html(html);
    } catch {
      // If index.html not found, return a basic status page
      return c.html(`
        <!DOCTYPE html>
        <html>
        <head><title>FindThisThread Bot</title></head>
        <body>
          <h1>FindThisThread Bot</h1>
          <p>Bot is running. <a href="/api/status">View API Status</a></p>
        </body>
        </html>
      `);
    }
  });

  return app;
}
