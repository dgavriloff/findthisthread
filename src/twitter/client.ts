import { Tweet, Mention, Media } from './types';
import { MOCK_MENTIONS, MOCK_TWEETS } from './mock';

const TWITTER_API_BASE = 'https://api.twitterapi.io';

export class TwitterClient {
  private apiKey: string;
  private botUsername: string;
  private mockMode: boolean;
  private mockProcessed: Set<string> = new Set();

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
      // Return mock mentions that haven't been "processed" yet
      const unprocessed = MOCK_MENTIONS.filter(m => !this.mockProcessed.has(m.id));
      if (sinceId) {
        return unprocessed.filter(m => m.id > sinceId);
      }
      return unprocessed;
    }

    const params = new URLSearchParams({
      query: `@${this.botUsername}`,
    });
    if (sinceId) {
      params.append('sinceId', sinceId);
    }

    const response = await this.request<{ status: string; tweets: any[] }>(
      `/twitter/tweet/advanced_search?${params.toString()}`
    );

    if (!response.tweets) {
      return [];
    }

    return response.tweets.map((tweet: any) => ({
      id: tweet.id,
      text: tweet.text,
      author_id: tweet.author?.id || '',
      author_username: tweet.author?.userName || '',
      in_reply_to_status_id: tweet.inReplyToId || tweet.in_reply_to_status_id,
      created_at: tweet.createdAt || tweet.created_at,
    }));
  }

  async getTweet(tweetId: string): Promise<Tweet | null> {
    if (this.mockMode) {
      return MOCK_TWEETS[tweetId] || null;
    }

    try {
      const response = await this.request<{ status: string; tweet: any }>(
        `/twitter/tweet/${tweetId}`
      );

      if (!response.tweet) {
        return null;
      }

      const tweet = response.tweet;
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

  async postReply(inReplyToId: string, text: string): Promise<void> {
    if (this.mockMode) {
      console.log(`\n[MOCK REPLY to ${inReplyToId}]:\n${text}\n`);
      this.mockProcessed.add(inReplyToId);
      return;
    }

    await this.request('/twitter/tweet', {
      method: 'POST',
      body: JSON.stringify({
        text,
        reply: {
          in_reply_to_tweet_id: inReplyToId,
        },
      }),
    });
  }

  async downloadImage(mediaUrl: string): Promise<Buffer> {
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
