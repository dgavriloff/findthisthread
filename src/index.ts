import { TwitterClient } from './twitter/client';
import { VisionExtractor } from './vision/extractor';
import { RedditSearch } from './reddit/search';
import { MentionsDB } from './db/mentions';
import { BotHandler } from './bot/handler';

// Load environment variables
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_BOT_USERNAME = process.env.TWITTER_BOT_USERNAME || 'findthisthread';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_PATH = process.env.DATABASE_PATH || './data/mentions.db';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);

// Check for test mode via CLI arg or env var
const TEST_MODE = process.argv.includes('--test') || process.env.TEST_MODE === 'true';

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

  console.log('Initializing Reddit Link Bot...');
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
  const handler = new BotHandler(twitter, vision, reddit, db, TEST_MODE);

  // Get last processed mention ID from database
  let lastMentionId: string | undefined = TEST_MODE ? undefined : db.getLastMentionId();
  console.log(`Starting from mention ID: ${lastMentionId || 'beginning'}`);

  // Print initial stats
  const stats = db.getStats();
  console.log(`Database stats: ${stats.total} processed, ${stats.successful} successful, ${stats.failed} failed`);

  console.log('\nBot started. Polling for mentions...\n');

  // Main polling loop
  while (true) {
    try {
      const mentions = await twitter.getMentions(lastMentionId);

      if (mentions.length > 0) {
        console.log(`Found ${mentions.length} new mention(s)`);

        // Process mentions in reverse order (oldest first)
        for (const mention of mentions.reverse()) {
          await handler.handleMention(mention);
        }

        // Update last mention ID to the most recent
        lastMentionId = mentions[0].id;
      }
    } catch (error) {
      console.error('Error during polling:', error);
    }

    // In test mode, only run once
    if (TEST_MODE) {
      console.log('\n[TEST MODE] Single run complete. Exiting.');
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// Handle graceful shutdown
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
