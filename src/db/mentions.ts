import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_mentions (
        mention_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL,
        result TEXT,
        reddit_url TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_processed_at
      ON processed_mentions(processed_at)
    `);
  }

  isProcessed(mentionId: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM processed_mentions WHERE mention_id = ?');
    const result = stmt.get(mentionId);
    return result !== undefined && result !== null;
  }

  markProcessed(mentionId: string, result: string, redditUrl?: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO processed_mentions (mention_id, processed_at, result, reddit_url)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(mentionId, new Date().toISOString(), result, redditUrl || null);
  }

  getLastMentionId(): string | undefined {
    const stmt = this.db.prepare(`
      SELECT mention_id FROM processed_mentions
      ORDER BY processed_at DESC
      LIMIT 1
    `);
    const result = stmt.get() as { mention_id: string } | null;
    return result?.mention_id;
  }

  getStats(): { total: number; successful: number; failed: number } {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM processed_mentions');
    const successStmt = this.db.prepare('SELECT COUNT(*) as count FROM processed_mentions WHERE reddit_url IS NOT NULL');

    const total = (totalStmt.get() as { count: number }).count;
    const successful = (successStmt.get() as { count: number }).count;

    return {
      total,
      successful,
      failed: total - successful,
    };
  }

  close(): void {
    this.db.close();
  }
}
