import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

export interface MentionRecord {
  mention_id: string;
  author_username: string;
  author_id: string;
  mention_text: string;
  parent_tweet_id: string | null;
  parent_author: string | null;
  parent_text: string | null;
  image_url: string | null;
  extracted_subreddit: string | null;
  extracted_username: string | null;
  extracted_title: string | null;
  processed_at: string;
  result: string;
  reddit_url: string | null;
  is_complete: number; // 0 = incomplete (can retry), 1 = complete (final result)
  reply_tweet_id: string | null;
  reply_sent_at: string | null;
}

// Results that are considered complete (final, no retry needed)
// not_found is NOT complete - Reddit search can be flaky, user may want to retry
export const COMPLETE_RESULTS = ['found', 'user_not_found', 'no_parent', 'no_media'];

export class MentionsDB {
  private db: Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    // New expanded schema for dashboard
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mentions (
        mention_id TEXT PRIMARY KEY,
        author_username TEXT NOT NULL,
        author_id TEXT NOT NULL,
        mention_text TEXT,
        parent_tweet_id TEXT,
        parent_author TEXT,
        parent_text TEXT,
        image_url TEXT,
        extracted_subreddit TEXT,
        extracted_username TEXT,
        extracted_title TEXT,
        processed_at TEXT NOT NULL,
        result TEXT NOT NULL,
        reddit_url TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_mentions_processed_at
      ON mentions(processed_at DESC)
    `);

    // Migrate old data if exists
    this.migrateOldSchema();

    // Add is_complete column if it doesn't exist
    this.migrateAddIsComplete();

    // Make not_found retriable (one-time migration)
    this.migrateNotFoundRetriable();

    // Add reply tracking columns
    this.migrateAddReplyColumns();
  }

  private migrateNotFoundRetriable(): void {
    // Mark not_found as incomplete so users can retry
    // This is idempotent - safe to run multiple times
    const result = this.db.prepare(`
      UPDATE mentions
      SET is_complete = 0
      WHERE result = 'not_found' AND is_complete = 1
    `).run();

    if (result.changes > 0) {
      console.log(`Made ${result.changes} not_found records retriable`);
    }
  }

  private migrateAddReplyColumns(): void {
    const columns = this.db.prepare(`PRAGMA table_info(mentions)`).all() as Array<{ name: string }>;
    const hasReplyTweetId = columns.some(col => col.name === 'reply_tweet_id');

    if (!hasReplyTweetId) {
      console.log('Adding reply tracking columns to mentions table...');
      this.db.exec(`ALTER TABLE mentions ADD COLUMN reply_tweet_id TEXT`);
      this.db.exec(`ALTER TABLE mentions ADD COLUMN reply_sent_at TEXT`);
      console.log('Migration complete: reply columns added');
    }
  }

  private migrateAddIsComplete(): void {
    // Check if column exists
    const columns = this.db.prepare(`PRAGMA table_info(mentions)`).all() as Array<{ name: string }>;
    const hasIsComplete = columns.some(col => col.name === 'is_complete');

    if (!hasIsComplete) {
      console.log('Adding is_complete column to mentions table...');
      // Add column with default 0 (incomplete)
      this.db.exec(`ALTER TABLE mentions ADD COLUMN is_complete INTEGER DEFAULT 0`);

      // Mark existing complete results
      this.db.exec(`
        UPDATE mentions
        SET is_complete = 1
        WHERE result IN ('found', 'user_not_found', 'no_parent', 'no_media')
      `);
      console.log('Migration complete: is_complete column added and existing data updated');
    }
  }

  private migrateOldSchema(): void {
    // Check if old table exists
    const oldTable = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='processed_mentions'
    `).get();

    if (oldTable) {
      // Migrate data from old table to new
      this.db.exec(`
        INSERT OR IGNORE INTO mentions (mention_id, author_username, author_id, mention_text, processed_at, result, reddit_url)
        SELECT mention_id, 'unknown', 'unknown', '', processed_at, COALESCE(result, 'unknown'), reddit_url
        FROM processed_mentions
      `);
      // Drop old table
      this.db.exec('DROP TABLE processed_mentions');
      console.log('Migrated old database schema to new format');
    }
  }

  isProcessed(mentionId: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM mentions WHERE mention_id = ?');
    const result = stmt.get(mentionId);
    return result !== undefined && result !== null;
  }

  saveMention(data: {
    mentionId: string;
    authorUsername: string;
    authorId: string;
    mentionText: string;
    parentTweetId?: string;
    parentAuthor?: string;
    parentText?: string;
    imageUrl?: string;
    extractedSubreddit?: string;
    extractedUsername?: string;
    extractedTitle?: string;
    result: string;
    redditUrl?: string;
    isComplete?: boolean;
    replyTweetId?: string;
    replySentAt?: string;
  }): void {
    // Determine if complete based on result if not explicitly set
    const isComplete = data.isComplete ?? COMPLETE_RESULTS.includes(data.result);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO mentions (
        mention_id, author_username, author_id, mention_text,
        parent_tweet_id, parent_author, parent_text, image_url,
        extracted_subreddit, extracted_username, extracted_title,
        processed_at, result, reddit_url, is_complete, reply_tweet_id, reply_sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      data.mentionId,
      data.authorUsername,
      data.authorId,
      data.mentionText,
      data.parentTweetId || null,
      data.parentAuthor || null,
      data.parentText || null,
      data.imageUrl || null,
      data.extractedSubreddit || null,
      data.extractedUsername || null,
      data.extractedTitle || null,
      new Date().toISOString(),
      data.result,
      data.redditUrl || null,
      isComplete ? 1 : 0,
      data.replyTweetId || null,
      data.replySentAt || null
    );
  }

  updateReplyStatus(mentionId: string, replyTweetId: string): void {
    const stmt = this.db.prepare(`
      UPDATE mentions
      SET reply_tweet_id = ?, reply_sent_at = ?
      WHERE mention_id = ?
    `);
    stmt.run(replyTweetId, new Date().toISOString(), mentionId);
  }

  getMentionsNeedingReply(limit: number = 10): MentionRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM mentions
      WHERE result = 'found'
        AND reddit_url IS NOT NULL
        AND reply_tweet_id IS NULL
        AND mention_id NOT LIKE 'upload_%'
      ORDER BY processed_at ASC
      LIMIT ?
    `);
    return stmt.all(limit) as MentionRecord[];
  }

  // Legacy method for compatibility
  markProcessed(mentionId: string, result: string, redditUrl?: string): void {
    const isComplete = COMPLETE_RESULTS.includes(result) ? 1 : 0;
    // Check if mention already exists
    const existing = this.db.prepare('SELECT 1 FROM mentions WHERE mention_id = ?').get(mentionId);
    if (existing) {
      // Update existing record
      const stmt = this.db.prepare(`
        UPDATE mentions SET result = ?, reddit_url = ?, processed_at = ?, is_complete = ?
        WHERE mention_id = ?
      `);
      stmt.run(result, redditUrl || null, new Date().toISOString(), isComplete, mentionId);
    } else {
      // Insert minimal record
      this.saveMention({
        mentionId,
        authorUsername: 'unknown',
        authorId: 'unknown',
        mentionText: '',
        result,
        redditUrl,
      });
    }
  }

  getLastMentionId(): string | undefined {
    // Only consider real Twitter IDs (numeric), not upload IDs
    // This prevents upload IDs like "upload_xxx" from breaking the sinceId filter
    // since string comparison would filter out all tweets (digits < 'u' in ASCII)
    const stmt = this.db.prepare(`
      SELECT mention_id FROM mentions
      WHERE mention_id NOT LIKE 'upload_%'
      ORDER BY mention_id DESC
      LIMIT 1
    `);
    const result = stmt.get() as { mention_id: string } | null;
    return result?.mention_id;
  }

  getStats(): { total: number; successful: number; failed: number } {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM mentions');
    const successStmt = this.db.prepare('SELECT COUNT(*) as count FROM mentions WHERE reddit_url IS NOT NULL');

    const total = (totalStmt.get() as { count: number }).count;
    const successful = (successStmt.get() as { count: number }).count;

    return {
      total,
      successful,
      failed: total - successful,
    };
  }

  // New methods for dashboard
  getAllMentions(limit: number = 50): MentionRecord[] {
    // Filter out no_parent and no_media - they're saved to prevent re-processing
    // but shouldn't clutter the UI
    const stmt = this.db.prepare(`
      SELECT * FROM mentions
      WHERE result NOT IN ('no_parent', 'no_media')
      ORDER BY processed_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as MentionRecord[];
  }

  getMention(mentionId: string): MentionRecord | null {
    const stmt = this.db.prepare('SELECT * FROM mentions WHERE mention_id = ?');
    return (stmt.get(mentionId) as MentionRecord) || null;
  }

  deleteMention(mentionId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM mentions WHERE mention_id = ?');
    const result = stmt.run(mentionId);
    return result.changes > 0;
  }

  getRecentSuccesses(limit: number = 10): MentionRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM mentions
      WHERE reddit_url IS NOT NULL
      ORDER BY processed_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as MentionRecord[];
  }

  close(): void {
    this.db.close();
  }
}
