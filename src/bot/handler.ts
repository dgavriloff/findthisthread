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
      } else if (result?.error === 'api_error') {
        console.log('Reddit API error - could not access user profile');
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
            result: 'api_error',
          });
        }
      } else if (result && !result.error) {
        console.log(`Found match: ${result.url} (confidence: ${result.matchConfidence})`);

        // Try to send a reply
        let replyTweetId: string | undefined;
        let replySentAt: string | undefined;

        if (!this.testMode) {
          const replyResult = await this.sendReplyToMention(mention.id, result.url, mention.author_username);
          if (replyResult.success && replyResult.tweetId) {
            replyTweetId = replyResult.tweetId;
            replySentAt = new Date().toISOString();
            console.log(`Reply sent! Tweet ID: ${replyTweetId}`);
          } else {
            console.log(`Failed to send reply: ${replyResult.error}`);
          }
        }

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
            replyTweetId,
            replySentAt,
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

  async handleUpload(imageBuffer: Buffer): Promise<{ success: boolean; message: string; url?: string; mentionId: string }> {
    // Generate a unique ID for this upload
    const mentionId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    console.log(`Processing uploaded image ${mentionId}...`);

    // Convert image to data URL for storage
    const base64Image = imageBuffer.toString('base64');
    const imageUrl = `data:image/png;base64,${base64Image}`;

    // Save immediately with "processing" status
    this.db.saveMention({
      mentionId,
      authorUsername: 'upload',
      authorId: 'upload',
      mentionText: 'Manual upload',
      imageUrl,
      result: 'processing',
    });

    try {
      // Extract Reddit info using vision
      console.log('Extracting Reddit info from uploaded image...');
      const redditInfo = await this.vision.extractRedditInfo(imageBuffer);
      console.log('Extracted info:', JSON.stringify(redditInfo, null, 2));

      if (!redditInfo.title && !redditInfo.username && !redditInfo.subreddit) {
        console.log('No searchable information extracted from image');
        this.db.saveMention({
          mentionId,
          authorUsername: 'upload',
          authorId: 'upload',
          mentionText: 'Manual upload',
          imageUrl,
          result: 'insufficient_info',
        });
        return { success: false, message: 'No searchable information found in image', mentionId };
      }

      // Search Reddit
      console.log('Searching Reddit for matching post...');
      const result = await this.reddit.findRedditPost(redditInfo);

      if (result?.error === 'user_not_found') {
        console.log(`Reddit user not found (deleted or suspended)`);
        this.db.saveMention({
          mentionId,
          authorUsername: 'upload',
          authorId: 'upload',
          mentionText: 'Manual upload',
          imageUrl,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'user_not_found',
        });
        return { success: false, message: 'Reddit user not found', mentionId };
      } else if (result?.error === 'rate_limited') {
        console.log('Reddit rate limited');
        this.db.saveMention({
          mentionId,
          authorUsername: 'upload',
          authorId: 'upload',
          mentionText: 'Manual upload',
          imageUrl,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'rate_limited',
        });
        return { success: false, message: 'Reddit rate limited - try later', mentionId };
      } else if (result?.error === 'api_error') {
        console.log('Reddit API error');
        this.db.saveMention({
          mentionId,
          authorUsername: 'upload',
          authorId: 'upload',
          mentionText: 'Manual upload',
          imageUrl,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'api_error',
        });
        return { success: false, message: 'Reddit API error - try later', mentionId };
      } else if (result && !result.error) {
        console.log(`Found match: ${result.url}`);
        this.db.saveMention({
          mentionId,
          authorUsername: 'upload',
          authorId: 'upload',
          mentionText: 'Manual upload',
          imageUrl,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'found',
          redditUrl: result.url,
        });
        return { success: true, message: 'Found matching post', url: result.url, mentionId };
      } else {
        console.log('No matching post found');
        this.db.saveMention({
          mentionId,
          authorUsername: 'upload',
          authorId: 'upload',
          mentionText: 'Manual upload',
          imageUrl,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'not_found',
        });
        return { success: false, message: 'No matching post found', mentionId };
      }
    } catch (error) {
      console.error(`Error processing upload ${mentionId}:`, error);
      this.db.saveMention({
        mentionId,
        authorUsername: 'upload',
        authorId: 'upload',
        mentionText: 'Manual upload',
        imageUrl,
        result: 'error',
      });
      return { success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`, mentionId };
    }
  }

  async reprocessMention(mentionId: string): Promise<{ success: boolean; message: string; url?: string }> {
    console.log(`Reprocessing mention ${mentionId}...`);

    // Get the existing mention record
    const existingMention = this.db.getMention(mentionId);
    if (!existingMention) {
      return { success: false, message: 'Mention not found in database' };
    }

    // Track data - start with existing, may be updated if we re-fetch
    let parentTweetId = existingMention.parent_tweet_id || undefined;
    let parentAuthor = existingMention.parent_author || undefined;
    let parentText = existingMention.parent_text || undefined;
    let imageUrl = existingMention.image_url || undefined;

    try {
      // If we don't have an image URL, re-fetch from Twitter
      if (!imageUrl) {
        console.log('No image URL stored, re-fetching from Twitter...');

        // Get the parent tweet using the mention ID
        const parentTweet = await this.twitter.getParentTweet(mentionId);

        if (!parentTweet) {
          console.log('Still no parent tweet found');
          this.db.saveMention({
            mentionId,
            authorUsername: existingMention.author_username,
            authorId: existingMention.author_id,
            mentionText: existingMention.mention_text || '',
            result: 'no_parent',
          });
          return { success: false, message: 'Could not find parent tweet' };
        }

        parentTweetId = parentTweet.id;
        parentAuthor = parentTweet.author_username;
        parentText = parentTweet.text;

        if (!parentTweet.media?.length) {
          console.log('Parent tweet has no media');
          this.db.saveMention({
            mentionId,
            authorUsername: existingMention.author_username,
            authorId: existingMention.author_id,
            mentionText: existingMention.mention_text || '',
            parentTweetId,
            parentAuthor,
            parentText,
            result: 'no_media',
          });
          return { success: false, message: 'Parent tweet has no image' };
        }

        imageUrl = parentTweet.media[0].media_url_https || parentTweet.media[0].url;
        console.log(`Found image URL: ${imageUrl}`);
      }

      // Download the image
      console.log(`Downloading image from ${imageUrl}`);
      const imageBuffer = await this.twitter.downloadImage(imageUrl);

      // Extract Reddit info using vision
      console.log('Extracting Reddit info from image...');
      const redditInfo = await this.vision.extractRedditInfo(imageBuffer);
      console.log('Extracted info:', JSON.stringify(redditInfo, null, 2));

      if (!redditInfo.title && !redditInfo.username && !redditInfo.subreddit && !redditInfo.bodySnippet) {
        this.db.saveMention({
          mentionId,
          authorUsername: existingMention.author_username,
          authorId: existingMention.author_id,
          mentionText: existingMention.mention_text || '',
          parentTweetId,
          parentAuthor,
          parentText,
          imageUrl,
          result: 'insufficient_info',
        });
        return { success: false, message: 'No searchable information extracted from image' };
      }

      // Search Reddit
      console.log('Searching Reddit for matching post...');
      const result = await this.reddit.findRedditPost(redditInfo);

      if (result?.error === 'user_not_found') {
        console.log(`Reddit user not found (deleted or suspended)`);
        this.db.saveMention({
          mentionId,
          authorUsername: existingMention.author_username,
          authorId: existingMention.author_id,
          mentionText: existingMention.mention_text || '',
          parentTweetId,
          parentAuthor,
          parentText,
          imageUrl,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'user_not_found',
        });
        return { success: false, message: 'Reddit user not found (deleted or suspended)' };
      } else if (result?.error === 'rate_limited') {
        console.log('Reddit rate limited - could not complete search');
        this.db.saveMention({
          mentionId,
          authorUsername: existingMention.author_username,
          authorId: existingMention.author_id,
          mentionText: existingMention.mention_text || '',
          parentTweetId,
          parentAuthor,
          parentText,
          imageUrl,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'rate_limited',
        });
        return { success: false, message: 'Reddit says try again later' };
      } else if (result?.error === 'api_error') {
        console.log('Reddit API error - could not access user profile');
        this.db.saveMention({
          mentionId,
          authorUsername: existingMention.author_username,
          authorId: existingMention.author_id,
          mentionText: existingMention.mention_text || '',
          parentTweetId,
          parentAuthor,
          parentText,
          imageUrl,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'api_error',
        });
        return { success: false, message: 'Reddit API error - try again later' };
      } else if (result && !result.error) {
        console.log(`Found match: ${result.url} (confidence: ${result.matchConfidence})`);
        this.db.saveMention({
          mentionId,
          authorUsername: existingMention.author_username,
          authorId: existingMention.author_id,
          mentionText: existingMention.mention_text || '',
          parentTweetId,
          parentAuthor,
          parentText,
          imageUrl,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'found',
          redditUrl: result.url,
        });
        return { success: true, message: 'Found matching post', url: result.url };
      } else {
        console.log('No matching post found on Reddit');
        this.db.saveMention({
          mentionId,
          authorUsername: existingMention.author_username,
          authorId: existingMention.author_id,
          mentionText: existingMention.mention_text || '',
          parentTweetId,
          parentAuthor,
          parentText,
          imageUrl,
          extractedSubreddit: redditInfo.subreddit || undefined,
          extractedUsername: redditInfo.username || undefined,
          extractedTitle: redditInfo.title || undefined,
          result: 'not_found',
        });
        return { success: false, message: 'No matching post found on Reddit' };
      }
    } catch (error) {
      console.error(`Error reprocessing mention ${mentionId}:`, error);
      return { success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  private async sendReplyToMention(
    mentionId: string,
    redditUrl: string,
    authorUsername: string
  ): Promise<{ success: boolean; tweetId?: string; error?: string }> {
    // Compose the reply message
    const replyText = `@${authorUsername} Found it! ${redditUrl}`;

    // Send the reply
    return this.twitter.sendReply(mentionId, replyText);
  }

  async retryPendingReplies(): Promise<{ sent: number; failed: number }> {
    const pendingMentions = this.db.getMentionsNeedingReply(10);
    let sent = 0;
    let failed = 0;

    for (const mention of pendingMentions) {
      if (!mention.reddit_url) continue;

      console.log(`Retrying reply for mention ${mention.mention_id}...`);
      const result = await this.sendReplyToMention(
        mention.mention_id,
        mention.reddit_url,
        mention.author_username
      );

      if (result.success && result.tweetId) {
        this.db.updateReplyStatus(mention.mention_id, result.tweetId);
        sent++;
        console.log(`Reply sent for ${mention.mention_id}`);
      } else {
        failed++;
        console.log(`Failed to send reply for ${mention.mention_id}: ${result.error}`);
      }

      // Small delay between replies to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return { sent, failed };
  }
}
