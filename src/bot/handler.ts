import { TwitterClient } from '../twitter/client';
import { VisionExtractor } from '../vision/extractor';
import { RedditSearch } from '../reddit/search';
import { MentionsDB } from '../db/mentions';
import { Mention } from '../twitter/types';

export class BotHandler {
  private twitter: TwitterClient;
  private vision: VisionExtractor;
  private reddit: RedditSearch;
  private db: MentionsDB;
  private testMode: boolean;

  constructor(
    twitter: TwitterClient,
    vision: VisionExtractor,
    reddit: RedditSearch,
    db: MentionsDB,
    testMode = false
  ) {
    this.twitter = twitter;
    this.vision = vision;
    this.reddit = reddit;
    this.db = db;
    this.testMode = testMode;
  }

  async handleMention(mention: Mention, onProgress?: () => void): Promise<void> {
    console.log(`Processing mention ${mention.id} from @${mention.author_username}`);

    // Check if already processed (skip in test mode)
    if (!this.testMode && this.db.isProcessed(mention.id)) {
      console.log(`Mention ${mention.id} already processed, skipping`);
      return;
    }

    // Track data for saving
    let parentTweetId: string | undefined;
    let parentAuthor: string | undefined;
    let parentText: string | undefined;
    let imageUrl: string | undefined;
    let extractedSubreddit: string | undefined;
    let extractedUsername: string | undefined;
    let extractedTitle: string | undefined;

    // Save immediately with "processing" status so UI shows it right away
    if (!this.testMode) {
      this.db.saveMention({
        mentionId: mention.id,
        authorUsername: mention.author_username,
        authorId: mention.author_id,
        mentionText: mention.text,
        result: 'processing',
      });
      onProgress?.();
    }

    try {
      // Get parent tweet (the one with the screenshot)
      const parentTweet = await this.twitter.getParentTweet(mention.id);

      if (!parentTweet) {
        console.log(`No parent tweet found for mention ${mention.id}`);
        if (!this.testMode) {
          this.db.saveMention({
            mentionId: mention.id,
            authorUsername: mention.author_username,
            authorId: mention.author_id,
            mentionText: mention.text,
            result: 'no_parent',
          });
        }
        return;
      }

      parentTweetId = parentTweet.id;
      parentAuthor = parentTweet.author_username;
      parentText = parentTweet.text;

      if (!parentTweet.media?.length) {
        console.log(`Parent tweet ${parentTweet.id} has no media`);
        if (!this.testMode) {
          this.db.saveMention({
            mentionId: mention.id,
            authorUsername: mention.author_username,
            authorId: mention.author_id,
            mentionText: mention.text,
            parentTweetId,
            parentAuthor,
            parentText,
            result: 'no_media',
          });
        }
        return;
      }

      // Download the first image
      imageUrl = parentTweet.media[0].media_url_https || parentTweet.media[0].url;
      console.log(`Downloading image from ${imageUrl}`);
      const imageBuffer = await this.twitter.downloadImage(imageUrl);

      // Extract Reddit info using vision
      console.log('Extracting Reddit info from image...');
      const redditInfo = await this.vision.extractRedditInfo(imageBuffer);
      console.log('Extracted info:', JSON.stringify(redditInfo, null, 2));

      extractedSubreddit = redditInfo.subreddit || undefined;
      extractedUsername = redditInfo.username || undefined;
      extractedTitle = redditInfo.title || undefined;

      // Only fail if we have absolutely nothing to search with
      if (!redditInfo.title && !redditInfo.username && !redditInfo.subreddit) {
        console.log('No searchable information extracted from image');
        if (!this.testMode) {
          this.db.saveMention({
            mentionId: mention.id,
            authorUsername: mention.author_username,
            authorId: mention.author_id,
            mentionText: mention.text,
            parentTweetId,
            parentAuthor,
            parentText,
            imageUrl,
            result: 'insufficient_info',
          });
        }
        return;
      }

      console.log(`Confidence: ${redditInfo.confidence} - proceeding with search`);

      // Search Reddit
      console.log('Searching Reddit for matching post...');
      const result = await this.reddit.findRedditPost(redditInfo);

      if (result?.error === 'user_not_found') {
        console.log(`Reddit user u/${extractedUsername} not found (deleted or suspended)`);
        if (!this.testMode) {
          this.db.saveMention({
            mentionId: mention.id,
            authorUsername: mention.author_username,
            authorId: mention.author_id,
            mentionText: mention.text,
            parentTweetId,
            parentAuthor,
            parentText,
            imageUrl,
            extractedSubreddit,
            extractedUsername,
            extractedTitle,
            result: 'user_not_found',
          });
        }
      } else if (result?.error === 'rate_limited') {
        console.log('Reddit rate limited - could not complete search');
        if (!this.testMode) {
          this.db.saveMention({
            mentionId: mention.id,
            authorUsername: mention.author_username,
            authorId: mention.author_id,
            mentionText: mention.text,
            parentTweetId,
            parentAuthor,
            parentText,
            imageUrl,
            extractedSubreddit,
            extractedUsername,
            extractedTitle,
            result: 'rate_limited',
          });
        }
      } else if (result && !result.error) {
        console.log(`Found match: ${result.url} (confidence: ${result.matchConfidence})`);
        if (!this.testMode) {
          this.db.saveMention({
            mentionId: mention.id,
            authorUsername: mention.author_username,
            authorId: mention.author_id,
            mentionText: mention.text,
            parentTweetId,
            parentAuthor,
            parentText,
            imageUrl,
            extractedSubreddit,
            extractedUsername,
            extractedTitle,
            result: 'found',
            redditUrl: result.url,
          });
        }
      } else {
        console.log('No matching post found on Reddit');
        if (!this.testMode) {
          this.db.saveMention({
            mentionId: mention.id,
            authorUsername: mention.author_username,
            authorId: mention.author_id,
            mentionText: mention.text,
            parentTweetId,
            parentAuthor,
            parentText,
            imageUrl,
            extractedSubreddit,
            extractedUsername,
            extractedTitle,
            result: 'not_found',
          });
        }
      }
    } catch (error) {
      console.error(`Error handling mention ${mention.id}:`, error);
      if (!this.testMode) {
        this.db.saveMention({
          mentionId: mention.id,
          authorUsername: mention.author_username,
          authorId: mention.author_id,
          mentionText: mention.text,
          parentTweetId,
          parentAuthor,
          parentText,
          imageUrl,
          extractedSubreddit,
          extractedUsername,
          extractedTitle,
          result: 'error',
        });
      }
    }
  }

  async reprocessMention(mentionId: string): Promise<{ success: boolean; message: string; url?: string }> {
    console.log(`Reprocessing mention ${mentionId}...`);

    // Get the existing mention record
    const existingMention = this.db.getMention(mentionId);
    if (!existingMention) {
      return { success: false, message: 'Mention not found in database' };
    }

    if (!existingMention.image_url) {
      return { success: false, message: 'No image URL stored for this mention' };
    }

    try {
      // Download the image again
      console.log(`Downloading image from ${existingMention.image_url}`);
      const imageBuffer = await this.twitter.downloadImage(existingMention.image_url);

      // Extract Reddit info using vision
      console.log('Extracting Reddit info from image...');
      const redditInfo = await this.vision.extractRedditInfo(imageBuffer);
      console.log('Extracted info:', JSON.stringify(redditInfo, null, 2));

      if (!redditInfo.title && !redditInfo.username && !redditInfo.subreddit && !redditInfo.bodySnippet) {
        return { success: false, message: 'No searchable information extracted from image' };
      }

      // Search Reddit
      console.log('Searching Reddit for matching post...');
      const result = await this.reddit.findRedditPost(redditInfo);

      if (result) {
        console.log(`Found match: ${result.url} (confidence: ${result.matchConfidence})`);
        // Update the database record
        this.db.saveMention({
          mentionId,
          authorUsername: existingMention.author_username,
          authorId: existingMention.author_id,
          mentionText: existingMention.mention_text || '',
          parentTweetId: existingMention.parent_tweet_id || undefined,
          parentAuthor: existingMention.parent_author || undefined,
          parentText: existingMention.parent_text || undefined,
          imageUrl: existingMention.image_url || undefined,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'found',
          redditUrl: result.url,
        });
        return { success: true, message: 'Found matching post', url: result.url };
      } else {
        console.log('No matching post found on Reddit');
        return { success: false, message: 'No matching post found on Reddit' };
      }
    } catch (error) {
      console.error(`Error reprocessing mention ${mentionId}:`, error);
      return { success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }
}
