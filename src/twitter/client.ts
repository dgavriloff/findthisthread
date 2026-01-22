import { Tweet, Mention, Media } from './types';
import { MOCK_MENTIONS, MOCK_TWEETS } from './mock';

const TWITTER_API_BASE = 'https://api.twitterapi.io';

export class TwitterClient {
  private apiKey: string;
  private botUsername: string;
  private mockMode: boolean;

  constructor(apiKey: string, botUsername: string, mockMode = false) {
    this.apiKey = apiKey;
    this.botUsername = botUsername;
    this.mockMode = mockMode;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${TWITTER_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Twitter API error (${response.status}): ${text}`);
    }

    return response.json();
  }

  async getMentions(sinceId?: string): Promise<Mention[]> {
    if (this.mockMode) {
      // Return mock mentions
      if (sinceId) {
        return MOCK_MENTIONS.filter(m => m.id > sinceId);
      }
      return MOCK_MENTIONS;
    }

    // Collect mentions from multiple sources to catch filtered replies
    const mentionsMap = new Map<string, Mention>();

    // Method 1: Dedicated mentions endpoint (may filter "low quality" replies)
    try {
      const mentionsResponse = await this.request<{ status: string; tweets: any[] }>(
        `/twitter/user/mentions?userName=${this.botUsername}`
      );
      if (mentionsResponse.tweets) {
        for (const tweet of mentionsResponse.tweets) {
          mentionsMap.set(tweet.id, {
            id: tweet.id,
            text: tweet.text,
            author_id: tweet.author?.id || '',
            author_username: tweet.author?.userName || '',
            in_reply_to_status_id: tweet.inReplyToId || tweet.in_reply_to_status_id,
            created_at: tweet.createdAt || tweet.created_at,
          });
        }
      }
    } catch (error) {
      console.error('Error fetching mentions endpoint:', error);
    }

    // Method 2: Search for @username (catches filtered mentions)
    try {
      const searchResponse = await this.request<{ status: string; tweets: any[] }>(
        `/twitter/tweet/advanced_search?query=${encodeURIComponent(`@${this.botUsername}`)}&queryType=Latest`
      );
      if (searchResponse.tweets) {
        for (const tweet of searchResponse.tweets) {
          // Don't overwrite if we already have it from mentions endpoint
          if (!mentionsMap.has(tweet.id)) {
            mentionsMap.set(tweet.id, {
              id: tweet.id,
              text: tweet.text,
              author_id: tweet.author?.id || '',
              author_username: tweet.author?.userName || '',
              in_reply_to_status_id: tweet.inReplyToId || tweet.in_reply_to_status_id,
              created_at: tweet.createdAt || tweet.created_at,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error fetching search results:', error);
    }

    let mentions = Array.from(mentionsMap.values());

    // Sort by ID (newest first)
    mentions.sort((a, b) => b.id.localeCompare(a.id));

    // Filter to only new mentions if sinceId provided
    if (sinceId) {
      mentions = mentions.filter(m => m.id > sinceId);
    }

    console.log(`Found ${mentions.length} mentions (${mentionsMap.size} total from all sources)`);
    return mentions;
  }

  async getTweet(tweetId: string): Promise<Tweet | null> {
    if (this.mockMode) {
      return MOCK_TWEETS[tweetId] || null;
    }

    try {
      const response = await this.request<{ status: string; tweets: any[] }>(
        `/twitter/tweets?tweet_ids=${tweetId}`
      );

      if (!response.tweets || response.tweets.length === 0) {
        return null;
      }

      const tweet = response.tweets[0];
      const media: Media[] = [];

      // Extract media from extended entities or media field
      if (tweet.extendedEntities?.media) {
        for (const m of tweet.extendedEntities.media) {
          media.push({
            type: m.type,
            url: m.media_url_https || m.url,
            media_url_https: m.media_url_https,
          });
        }
      } else if (tweet.media?.photo) {
        for (const photo of tweet.media.photo) {
          media.push({
            type: 'photo',
            url: photo.media_url_https || photo.url,
            media_url_https: photo.media_url_https,
          });
        }
      }

      return {
        id: tweet.id,
        text: tweet.text,
        author_id: tweet.author?.id || '',
        author_username: tweet.author?.userName || '',
        in_reply_to_status_id: tweet.inReplyToId || tweet.in_reply_to_status_id,
        media: media.length > 0 ? media : undefined,
        created_at: tweet.createdAt || tweet.created_at,
      };
    } catch (error) {
      console.error(`Error fetching tweet ${tweetId}:`, error);
      return null;
    }
  }

  async getParentTweet(replyTweetId: string): Promise<Tweet | null> {
    const tweet = await this.getTweet(replyTweetId);
    if (!tweet?.in_reply_to_status_id) {
      return null;
    }
    return this.getTweet(tweet.in_reply_to_status_id);
  }

  async downloadImage(mediaUrl: string): Promise<Buffer> {
    // Validate URL to prevent SSRF attacks
    try {
      const url = new URL(mediaUrl);
      const allowedHosts = ['pbs.twimg.com', 'video.twimg.com', 'abs.twimg.com', 'ton.twimg.com'];
      if (!allowedHosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
        throw new Error('Invalid media URL: must be from Twitter CDN');
      }
      if (url.protocol !== 'https:') {
        throw new Error('Invalid media URL: must use HTTPS');
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Invalid media URL')) throw e;
      throw new Error('Invalid media URL format');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(mediaUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
      }

      // Check content length to prevent downloading huge files
      const contentLength = response.headers.get('content-length');
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (contentLength && parseInt(contentLength, 10) > maxSize) {
        throw new Error('Image too large');
      }

      const arrayBuffer = await response.arrayBuffer();

      // Double-check actual size
      if (arrayBuffer.byteLength > maxSize) {
        throw new Error('Image too large');
      }

      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timeout);
    }
  }
}
