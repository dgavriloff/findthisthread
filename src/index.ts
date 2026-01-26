import { TwitterClient } from './twitter/client';
import { VisionExtractor } from './vision/extractor';
import { RedditSearch } from './reddit/search';
import { MentionsDB } from './db/mentions';
import { BotHandler } from './bot/handler';
import { TelegramClient } from './telegram/client';
import { createServer, BotState, WebhookConfig } from './web/server';
import type { ServerWebSocket } from 'bun';

// Load environment variables
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_BOT_USERNAME = process.env.TWITTER_BOT_USERNAME || 'findthisthread';
const TWITTER_BOT_EMAIL = process.env.TWITTER_BOT_EMAIL;
const TWITTER_BOT_PASSWORD = process.env.TWITTER_BOT_PASSWORD;
const TWITTER_PROXY = process.env.TWITTER_PROXY;
const TWITTER_TOTP_SECRET = process.env.TWITTER_TOTP_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_TIMEOUT_MS = parseInt(process.env.TELEGRAM_TIMEOUT_MS || '60000', 10);
const DATABASE_PATH = process.env.DATABASE_PATH || (process.env.RAILWAY_ENVIRONMENT ? '/data/mentions.db' : './data/mentions.db');
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '300000', 10);
const PORT = parseInt(process.env.PORT || '3000', 10);
const TEST_MODE = process.argv.includes('--test') || process.env.TEST_MODE === 'true';

// WebSocket clients
const wsClients = new Set<ServerWebSocket<unknown>>();

// Manual refresh trigger
let refreshRequested = false;
export function triggerRefresh() {
  refreshRequested = true;
}

// Bot state for dashboard
const botState: BotState = {
  lastCheckTime: Date.now(),
  nextCheckTime: Date.now() + POLL_INTERVAL_MS,
  pollIntervalMs: POLL_INTERVAL_MS,
  isRunning: true,
};

// Broadcast to all WebSocket clients
function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const client of wsClients) {
    try {
      client.send(message);
    } catch (e) {
      wsClients.delete(client);
    }
  }
}

function validateEnv(): void {
  if (!TWITTER_API_KEY && !TEST_MODE) {
    throw new Error('TWITTER_API_KEY environment variable is required');
  }
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  validateEnv();

  console.log('Initializing FindThisThread Bot...');
  console.log(`Bot username: @${TWITTER_BOT_USERNAME}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);

  if (TEST_MODE) {
    console.log('\n*** RUNNING IN TEST MODE - Using mock Twitter data ***\n');
  }

  // Initialize components
  const twitter = new TwitterClient(TWITTER_API_KEY || 'mock-key', TWITTER_BOT_USERNAME, TEST_MODE);
  const vision = new VisionExtractor(GEMINI_API_KEY!);
  const reddit = new RedditSearch();
  const db = new MentionsDB(DATABASE_PATH);

  // Initialize Telegram for reply approval (optional)
  let telegram: TelegramClient | null = null;
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    telegram = new TelegramClient(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_TIMEOUT_MS);
    console.log('Telegram approval configured - replies will require approval');
  } else {
    console.log('Telegram not configured - replies will be sent automatically');
  }

  const handler = new BotHandler(twitter, vision, reddit, db, TEST_MODE, telegram);

  // Set up Twitter credentials for posting replies
  if (TWITTER_BOT_EMAIL && TWITTER_BOT_PASSWORD && TWITTER_PROXY) {
    twitter.setCredentials(TWITTER_BOT_EMAIL, TWITTER_BOT_PASSWORD, TWITTER_PROXY, TWITTER_TOTP_SECRET);
    console.log('Twitter posting credentials configured');

    // Attempt login (will retry later if fails)
    const loggedIn = await twitter.login();
    if (loggedIn) {
      console.log('Successfully logged in to Twitter for posting replies');

      // Retry any pending replies from previous runs
      const { sent, failed, skipped } = await handler.retryPendingReplies();
      if (sent > 0 || failed > 0 || skipped > 0) {
        console.log(`Retried pending replies: ${sent} sent, ${failed} failed, ${skipped} skipped`);
      }
    } else {
      console.log('WARNING: Could not login to Twitter - replies will not be sent');
    }
  } else {
    console.log('WARNING: Twitter posting credentials not configured - replies will not be sent');
    console.log('  Set TWITTER_BOT_EMAIL, TWITTER_BOT_PASSWORD, and TWITTER_PROXY to enable replies');
  }

  // Create webhook config for twitterapi.io
  const webhookConfig: WebhookConfig = {
    apiKey: TWITTER_API_KEY || '',
    onMention: async (mention) => {
      await handler.handleMention(mention, () => {
        broadcast('mentions', db.getAllMentions(50));
      });
      broadcast('mentions', db.getAllMentions(50));
      broadcast('status', { ...botState, stats: db.getStats(), currentTime: Date.now(), timeUntilNextCheck: Math.max(0, botState.nextCheckTime - Date.now()) });
    },
    onBroadcast: () => {
      broadcast('mentions', db.getAllMentions(50));
    },
  };

  // Create Hono app for REST endpoints
  const app = createServer(db, () => botState, triggerRefresh, (mentionId) => handler.reprocessMention(mentionId), webhookConfig);

  console.log(`Starting API server on port ${PORT}...`);

  const server = Bun.serve({
    port: PORT,
    hostname: '0.0.0.0',

    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined as any;
        return new Response('WebSocket upgrade failed', { status: 400 });
      }

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }

      try {
        const response = await app.fetch(req);
        const headers = new Headers(response.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch (error) {
        console.error('Server error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    },

    websocket: {
      open(ws) {
        wsClients.add(ws);
        console.log(`WebSocket client connected (${wsClients.size} total)`);
        // Send initial state
        const stats = db.getStats();
        const mentions = db.getAllMentions(50);
        ws.send(JSON.stringify({
          type: 'init',
          data: {
            status: { ...botState, stats, currentTime: Date.now(), timeUntilNextCheck: Math.max(0, botState.nextCheckTime - Date.now()) },
            mentions,
          },
          timestamp: Date.now(),
        }));
      },
      message(ws, message) {
        // Handle incoming messages (e.g., refresh request)
        try {
          const data = JSON.parse(message.toString());
          if (data.type === 'refresh') {
            triggerRefresh();
            // refresh_complete will be broadcast after checkMentions finishes
          } else if (data.type === 'reprocess' && data.mentionId) {
            handler.reprocessMention(data.mentionId).then(result => {
              ws.send(JSON.stringify({ type: 'reprocess_result', data: result, timestamp: Date.now() }));
              // Broadcast updated mentions
              broadcast('mentions', db.getAllMentions(50));
            });
          } else if (data.type === 'delete' && data.mentionId) {
            const deleted = db.deleteMention(data.mentionId);
            ws.send(JSON.stringify({
              type: 'delete_result',
              data: { success: deleted, mentionId: data.mentionId },
              timestamp: Date.now()
            }));
            if (deleted) {
              // Broadcast updated mentions to all clients
              broadcast('mentions', db.getAllMentions(50));
            }
          } else if (data.type === 'upload' && data.imageData) {
            // Handle uploaded image (base64 encoded)
            try {
              const imageBuffer = Buffer.from(data.imageData, 'base64');
              // Broadcast updated mentions immediately to show "processing" state
              broadcast('mentions', db.getAllMentions(50));
              handler.handleUpload(imageBuffer).then(result => {
                ws.send(JSON.stringify({ type: 'upload_result', data: result, timestamp: Date.now() }));
                // Broadcast updated mentions after processing
                broadcast('mentions', db.getAllMentions(50));
              });
            } catch (e) {
              ws.send(JSON.stringify({
                type: 'upload_result',
                data: { success: false, message: 'Invalid image data' },
                timestamp: Date.now()
              }));
            }
          }
        } catch (e) {
          // Ignore invalid messages
        }
      },
      close(ws) {
        wsClients.delete(ws);
        console.log(`WebSocket client disconnected (${wsClients.size} total)`);
      },
    },
  });

  console.log(`API server running at http://0.0.0.0:${server.port}`);
  console.log(`WebSocket available at ws://0.0.0.0:${server.port}/ws`);

  // Get last processed mention ID from database
  let lastMentionId: string | undefined = TEST_MODE ? undefined : db.getLastMentionId();
  console.log(`Database path: ${DATABASE_PATH}`);
  console.log(`Starting from mention ID: ${lastMentionId || 'beginning (database empty)'}`);

  const stats = db.getStats();
  console.log(`Database stats: ${stats.total} processed, ${stats.successful} successful, ${stats.failed} failed`);

  if (stats.total === 0) {
    console.log('WARNING: Database is empty - all mentions will be processed from scratch');
  }
  console.log('\nBot started. Polling for mentions...\n');

  // Check for mentions - returns count of new mentions found
  async function checkMentions(): Promise<number> {
    console.log('Checking for new mentions...');
    botState.lastCheckTime = Date.now();
    botState.nextCheckTime = Date.now() + POLL_INTERVAL_MS;

    // Broadcast status update
    broadcast('status', { ...botState, stats: db.getStats(), currentTime: Date.now(), timeUntilNextCheck: POLL_INTERVAL_MS });

    try {
      const mentions = await twitter.getMentions(lastMentionId);

      if (mentions.length > 0) {
        console.log(`Found ${mentions.length} new mention(s)`);

        for (const mention of mentions.reverse()) {
          // Pass onProgress callback to broadcast immediately when processing starts
          await handler.handleMention(mention, () => {
            broadcast('mentions', db.getAllMentions(50));
          });
          // Broadcast updated mentions after each one is processed
          broadcast('mentions', db.getAllMentions(50));
          broadcast('status', { ...botState, stats: db.getStats(), currentTime: Date.now(), timeUntilNextCheck: Math.max(0, botState.nextCheckTime - Date.now()) });
        }

        lastMentionId = mentions[0].id;
        return mentions.length;
      } else {
        console.log('No new mentions');
        return 0;
      }
    } catch (error) {
      console.error('Error during polling:', error);
      return 0;
    }
  }

  // Initial check
  await checkMentions();

  if (TEST_MODE) {
    console.log('\n[TEST MODE] Single run complete. Server still running for dashboard...');
    botState.isRunning = false;
    await new Promise(() => {});
  }

  // Broadcast timer updates every second
  setInterval(() => {
    const now = Date.now();
    broadcast('tick', {
      currentTime: now,
      timeUntilNextCheck: Math.max(0, botState.nextCheckTime - now),
      lastCheckTime: botState.lastCheckTime,
      nextCheckTime: botState.nextCheckTime,
    });
  }, 1000);

  // Main polling loop
  while (true) {
    await sleep(1000);

    // Only check when manually triggered (no auto-polling)
    if (refreshRequested) {
      console.log('Manual refresh triggered');
      refreshRequested = false;
      const foundCount = await checkMentions();
      // Broadcast completion with count so frontend can show feedback
      broadcast('refresh_complete', { found: foundCount });
    }
  }
}

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  process.exit(0);
});

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
