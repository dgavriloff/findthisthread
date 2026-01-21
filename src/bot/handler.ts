import { TwitterClient } from '../twitter/client';
import { VisionExtractor } from '../vision/extractor';
import { RedditSearch } from '../reddit/search';
import { MentionsDB } from '../db/mentions';
import { Mention } from '../twitter/types';
import { RedditPostInfo } from '../vision/types';

const REPLIES = {
  found: (url: string) => `Found it!\n\n${url}`,

  notFound: (info: RedditPostInfo) => {
    const parts: string[] = ["Couldn't locate this post. It may be deleted or from a private subreddit."];
    if (info.subreddit || info.username) {
      const searchInfo: string[] = [];
      if (info.subreddit) searchInfo.push(`r/${info.subreddit}`);
      if (info.username) searchInfo.push(`u/${info.username}`);
      parts.push(`\nSearched: ${searchInfo.join(' • ')}`);
    }
    return parts.join('');
  },

  noImage: () =>
    "I need an image to work with! Tag me on a tweet that contains a Reddit screenshot.",

  notReddit: () =>
    "That doesn't look like a Reddit screenshot. I can only find links for Reddit posts.",

  error: () =>
    "Something went wrong on my end. Please try again later!",
};

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

  async handleMention(mention: Mention): Promise<void> {
    console.log(`Processing mention ${mention.id} from @${mention.author_username}`);

    // Check if already processed (skip in test mode)
    if (!this.testMode && this.db.isProcessed(mention.id)) {
      console.log(`Mention ${mention.id} already processed, skipping`);
      return;
    }

    try {
      // Get parent tweet (the one with the screenshot)
      const parentTweet = await this.twitter.getParentTweet(mention.id);

      if (!parentTweet) {
        console.log(`No parent tweet found for mention ${mention.id}`);
        await this.twitter.postReply(mention.id, REPLIES.noImage());
        if (!this.testMode) this.db.markProcessed(mention.id, 'no_parent');
        return;
      }

      if (!parentTweet.media?.length) {
        console.log(`Parent tweet ${parentTweet.id} has no media`);
        await this.twitter.postReply(mention.id, REPLIES.noImage());
        if (!this.testMode) this.db.markProcessed(mention.id, 'no_media');
        return;
      }

      // Download the first image
      const imageUrl = parentTweet.media[0].media_url_https || parentTweet.media[0].url;
      console.log(`Downloading image from ${imageUrl}`);
      const imageBuffer = await this.twitter.downloadImage(imageUrl);

      // Extract Reddit info using vision
      console.log('Extracting Reddit info from image...');
      const redditInfo = await this.vision.extractRedditInfo(imageBuffer);
      console.log('Extracted info:', JSON.stringify(redditInfo, null, 2));

      // Only fail if we have absolutely nothing to search with
      if (!redditInfo.title && !redditInfo.username && !redditInfo.subreddit) {
        console.log('No searchable information extracted from image');
        await this.twitter.postReply(mention.id, REPLIES.notReddit());
        if (!this.testMode) this.db.markProcessed(mention.id, 'insufficient_info');
        return;
      }

      console.log(`Confidence: ${redditInfo.confidence} - proceeding with search anyway`);

      // Search Reddit
      console.log('Searching Reddit for matching post...');
      const result = await this.reddit.findRedditPost(redditInfo);

      if (result) {
        console.log(`Found match: ${result.url} (confidence: ${result.matchConfidence})`);
        await this.twitter.postReply(mention.id, REPLIES.found(result.url));
        if (!this.testMode) this.db.markProcessed(mention.id, 'found', result.url);
      } else {
        console.log('No matching post found on Reddit');
        await this.twitter.postReply(mention.id, REPLIES.notFound(redditInfo));
        if (!this.testMode) this.db.markProcessed(mention.id, 'not_found');
      }
    } catch (error) {
      console.error(`Error handling mention ${mention.id}:`, error);
      try {
        await this.twitter.postReply(mention.id, REPLIES.error());
      } catch (replyError) {
        console.error('Failed to send error reply:', replyError);
      }
      if (!this.testMode) this.db.markProcessed(mention.id, 'error');
    }
  }
}
