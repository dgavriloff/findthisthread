import stringSimilarity from 'string-similarity';
import { RedditPostInfo } from '../vision/types';
import { RedditSearchResult, RedditSearchResponse, RedditPost, RedditUserCommentsResponse, RedditComment } from './types';

const REDDIT_BASE = 'https://www.reddit.com';
const REDDIT_OAUTH_BASE = 'https://oauth.reddit.com';
const USER_AGENT = 'FindThisThread/1.0 (bot; contact: findthisthread@example.com)';
const BASE_DELAY_MS = 1000; // 1 second between requests (OAuth allows 60 req/min)
const UNAUTH_DELAY_MS = 6000; // 6 seconds for unauthenticated

// Sanitize Reddit username/subreddit to prevent URL injection
function sanitizeRedditName(name: string): string {
  // Reddit names are alphanumeric with underscores, max 20 chars for users, 21 for subreddits
  return name.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 25);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class RedditSearch {
  private lastRequestTime = 0;
  private currentDelay: number;
  private rateLimitedUntil = 0;

  // OAuth credentials
  private clientId: string | null;
  private clientSecret: string | null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor() {
    this.clientId = process.env.REDDIT_CLIENT_ID || null;
    this.clientSecret = process.env.REDDIT_CLIENT_SECRET || null;
    this.currentDelay = this.clientId ? BASE_DELAY_MS : UNAUTH_DELAY_MS;

    if (this.clientId && this.clientSecret) {
      console.log('Reddit OAuth credentials configured - using authenticated API (60 req/min)');
    } else {
      console.log('No Reddit OAuth credentials - using unauthenticated API (10 req/min)');
    }
  }

  private async getAccessToken(): Promise<string | null> {
    if (!this.clientId || !this.clientSecret) return null;

    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    try {
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const response = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: 'grant_type=client_credentials',
      });

      if (!response.ok) {
        console.error(`Reddit OAuth error (${response.status}): ${await response.text()}`);
        return null;
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
      console.log('Reddit OAuth token obtained, expires in', data.expires_in, 'seconds');
      return this.accessToken;
    } catch (error) {
      console.error('Reddit OAuth error:', error);
      return null;
    }
  }

  // Track last fetch status for error detection
  private lastFetchStatus: number = 0;

  private async fetchReddit<T>(url: string, silent = false): Promise<T | null> {
    // If we're in rate limit cooldown, skip entirely
    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      const waitTime = Math.ceil((this.rateLimitedUntil - now) / 1000);
      console.log(`Rate limited, skipping request (${waitTime}s remaining)`);
      this.lastFetchStatus = 429;
      return null;
    }

    // Rate limiting: ensure minimum delay between requests
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.currentDelay) {
      await sleep(this.currentDelay - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();

    try {
      // Try OAuth first
      const token = await this.getAccessToken();
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
      let requestUrl = url;

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        // Use OAuth endpoint instead of www
        requestUrl = url.replace(REDDIT_BASE, REDDIT_OAUTH_BASE);
      }

      const response = await fetch(requestUrl, { headers });
      this.lastFetchStatus = response.status;

      // Handle rate limiting with exponential backoff
      if (response.status === 429) {
        const baseDelay = token ? BASE_DELAY_MS : UNAUTH_DELAY_MS;
        this.currentDelay = Math.min(this.currentDelay * 2, 60000);
        this.rateLimitedUntil = Date.now() + 60000;
        console.log(`Rate limited by Reddit. Cooling down for 60s. Next delay: ${this.currentDelay/1000}s`);
        return null;
      }

      // Success - gradually reduce delay back to base
      const baseDelay = this.accessToken ? BASE_DELAY_MS : UNAUTH_DELAY_MS;
      if (this.currentDelay > baseDelay) {
        this.currentDelay = Math.max(baseDelay, this.currentDelay * 0.8);
      }

      if (!response.ok) {
        if (response.status !== 404 && !silent) {
          console.error(`Reddit API error (${response.status}): ${requestUrl}`);
        }
        return null;
      }

      return response.json();
    } catch (error) {
      if (!silent) console.error('Reddit fetch error:', error);
      this.lastFetchStatus = 0;
      return null;
    }
  }

  // Check if last fetch was a 404 (user/subreddit not found)
  wasNotFound(): boolean {
    return this.lastFetchStatus === 404;
  }

  // Check if we're currently rate limited
  isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }

  async findRedditPost(info: RedditPostInfo): Promise<RedditSearchResult | null> {
    // Search strategies ordered by effectiveness
    // With OAuth we can use more strategies (60 req/min vs 10)
    const strategies = [
      { name: 'titleInSubreddit', fn: () => this.searchByTitleInSubreddit(info) },
      { name: 'authorInSubreddit', fn: () => this.searchByAuthorInSubreddit(info) },
      { name: 'exactTitle', fn: () => this.searchExactTitle(info) },
      { name: 'globalWithAuthor', fn: () => this.searchGlobal(info) },
      { name: 'userComments', fn: () => this.searchUserComments(info) },
    ];

    let bestResult: RedditSearchResult | null = null;

    for (const { name, fn } of strategies) {
      // Stop if we hit rate limit
      if (this.isRateLimited()) {
        console.log('Rate limited - stopping search early');
        break;
      }

      const result = await fn();

      // If we got a user_not_found error, return it immediately
      if (result?.error === 'user_not_found') {
        console.log(`Strategy '${name}' found user does not exist`);
        return result;
      }

      // Only return immediately if confidence is very high (>0.8)
      if (result && result.matchConfidence >= 0.8) {
        console.log(`Strategy '${name}' found high-confidence match`);
        return result;
      }
      // Keep track of best result
      if (result && (!bestResult || result.matchConfidence > bestResult.matchConfidence)) {
        bestResult = result;
      }
    }

    // Return best result if above 0.4
    if (bestResult && bestResult.matchConfidence >= 0.4) {
      console.log(`Returning best match with confidence: ${bestResult.matchConfidence.toFixed(3)}`);
      return bestResult;
    }

    return null;
  }

  private async searchExactTitle(info: RedditPostInfo): Promise<RedditSearchResult | null> {
    if (!info.title) return null;

    // Search for exact title match (in quotes)
    console.log(`Searching for exact title: "${info.title}"`);
    const url = `${REDDIT_BASE}/search.json?q=${encodeURIComponent(`"${info.title}"`)}&sort=relevance&limit=25`;
    const response = await this.fetchReddit<RedditSearchResponse>(url);

    if (!response?.data?.children?.length) {
      console.log('No exact title matches found');
      return null;
    }

    console.log(`Found ${response.data.children.length} exact title matches`);
    return this.findBestMatch(response.data.children.map((c: { data: RedditPost }) => c.data), info);
  }

  private async searchByBodySnippet(info: RedditPostInfo): Promise<RedditSearchResult | null> {
    if (!info.bodySnippet) return null;

    const keywords = this.extractKeywords(info.bodySnippet);
    if (!keywords) return null;

    console.log(`Searching by body snippet: "${keywords}"`);

    const url = `${REDDIT_BASE}/search.json?q=${encodeURIComponent(keywords)}&sort=relevance&limit=25`;
    const response = await this.fetchReddit<RedditSearchResponse>(url);

    if (!response?.data?.children?.length) return null;

    return this.findBestMatch(response.data.children.map((c: { data: RedditPost }) => c.data), info);
  }

  private async searchByAuthorInSubreddit(info: RedditPostInfo): Promise<RedditSearchResult | null> {
    if (!info.subreddit || !info.username) return null;

    const url = `${REDDIT_BASE}/r/${sanitizeRedditName(info.subreddit)}/search.json?q=author:${encodeURIComponent(sanitizeRedditName(info.username))}&restrict_sr=on&sort=new&limit=25`;
    const response = await this.fetchReddit<RedditSearchResponse>(url);

    if (!response?.data?.children?.length) return null;

    return this.findBestMatch(response.data.children.map((c: { data: RedditPost }) => c.data), info);
  }

  private async searchByTitleInSubreddit(info: RedditPostInfo): Promise<RedditSearchResult | null> {
    if (!info.subreddit || !info.title) return null;

    // Extract key words from title (remove common words)
    const keywords = this.extractKeywords(info.title);
    if (!keywords) return null;

    const url = `${REDDIT_BASE}/r/${sanitizeRedditName(info.subreddit)}/search.json?q=${encodeURIComponent(keywords)}&restrict_sr=on&sort=relevance&limit=25`;
    const response = await this.fetchReddit<RedditSearchResponse>(url);

    if (!response?.data?.children?.length) return null;

    return this.findBestMatch(response.data.children.map((c: { data: RedditPost }) => c.data), info);
  }

  private async searchGlobal(info: RedditPostInfo): Promise<RedditSearchResult | null> {
    if (!info.title || !info.username) return null;

    const keywords = this.extractKeywords(info.title);
    if (!keywords) return null;

    const url = `${REDDIT_BASE}/search.json?q=${encodeURIComponent(keywords)}+author:${encodeURIComponent(sanitizeRedditName(info.username))}&sort=relevance&limit=25`;
    const response = await this.fetchReddit<RedditSearchResponse>(url);

    if (!response?.data?.children?.length) return null;

    return this.findBestMatch(response.data.children.map((c: { data: RedditPost }) => c.data), info);
  }

  private async searchByTitleGlobal(info: RedditPostInfo): Promise<RedditSearchResult | null> {
    if (!info.title) return null;

    // Try with full title first (in quotes for exact phrase)
    console.log(`Searching globally for title: "${info.title}"`);
    let url = `${REDDIT_BASE}/search.json?q=${encodeURIComponent(`"${info.title}"`)}&sort=relevance&limit=25`;
    let response = await this.fetchReddit<RedditSearchResponse>(url);

    // If no results, try with keywords
    if (!response?.data?.children?.length) {
      const keywords = this.extractKeywords(info.title);
      if (!keywords) return null;
      console.log(`No exact match, trying keywords: "${keywords}"`);
      url = `${REDDIT_BASE}/search.json?q=${encodeURIComponent(keywords)}&sort=relevance&limit=25`;
      response = await this.fetchReddit<RedditSearchResponse>(url);
    }

    if (!response?.data?.children?.length) return null;

    console.log(`Found ${response.data.children.length} results`);
    return this.findBestMatch(response.data.children.map((c: { data: RedditPost }) => c.data), info);
  }

  private extractKeywords(title: string): string {
    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'is', 'it', 'this', 'that', 'was', 'were', 'be',
      'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
      'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
    ]);

    const words = title
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Take first 6 significant words
    return words.slice(0, 6).join(' ');
  }

  private findBestMatch(posts: RedditPost[], info: RedditPostInfo): RedditSearchResult | null {
    let bestMatch: RedditSearchResult | null = null;
    let bestScore = 0;

    for (const post of posts) {
      let score = 0;

      // Title similarity (most important - 60% weight)
      if (info.title && post.title) {
        const titleSimilarity = stringSimilarity.compareTwoStrings(
          info.title.toLowerCase(),
          post.title.toLowerCase()
        );
        score += titleSimilarity * 0.6;

        // Bonus for exact title match
        if (titleSimilarity > 0.9) {
          score += 0.15;
        }
      }

      // Author match (20% weight) - skip if extracted as "redacted" or similar
      if (info.username && post.author &&
          !['redacted', 'deleted', '[deleted]', 'unknown'].includes(info.username.toLowerCase())) {
        const authorSimilarity = stringSimilarity.compareTwoStrings(
          info.username.toLowerCase(),
          post.author.toLowerCase()
        );
        score += authorSimilarity * 0.2;
      }

      // Subreddit match with fuzzy matching (20% weight)
      if (info.subreddit && post.subreddit) {
        const subredditSimilarity = stringSimilarity.compareTwoStrings(
          info.subreddit.toLowerCase(),
          post.subreddit.toLowerCase()
        );
        score += subredditSimilarity * 0.2;
      }

      // Body snippet match bonus - if body contains similar text
      if (info.bodySnippet && post.selftext) {
        const bodyWords = this.extractKeywords(info.bodySnippet);
        const postWords = this.extractKeywords(post.selftext.substring(0, 200));
        if (bodyWords && postWords) {
          const bodySimilarity = stringSimilarity.compareTwoStrings(bodyWords, postWords);
          if (bodySimilarity > 0.5) {
            score += 0.1; // Bonus for matching body content
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          url: `https://www.reddit.com${post.permalink}`,
          title: post.title,
          author: post.author,
          subreddit: post.subreddit,
          matchConfidence: Math.min(score, 1), // Cap at 1
        };
        console.log(`  New best: "${post.title}" in r/${post.subreddit} (score: ${score.toFixed(3)})`);
      }
    }

    if (bestMatch) {
      console.log(`Best match: ${bestMatch.url} (confidence: ${bestMatch.matchConfidence.toFixed(3)})`);
    }

    return bestMatch;
  }

  private async searchUserComments(info: RedditPostInfo): Promise<RedditSearchResult | null> {
    // Skip if username is missing or generic
    if (!info.username ||
        ['redacted', 'deleted', '[deleted]', 'unknown'].includes(info.username.toLowerCase())) {
      return null;
    }

    console.log(`Searching user comments for u/${info.username}...`);

    // Fetch up to 5 pages (500 comments) - OAuth allows more requests
    const allComments: Array<{ kind: string; data: RedditComment }> = [];
    let after: string | null = null;
    const maxPages = 5;
    let userNotFound = false;

    for (let page = 0; page < maxPages; page++) {
      // Check rate limit before each page
      if (this.isRateLimited()) {
        console.log('Rate limited - stopping comment fetch');
        break;
      }

      const url = `${REDDIT_BASE}/user/${sanitizeRedditName(info.username)}/comments.json?sort=new&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      const response = await this.fetchReddit<RedditUserCommentsResponse>(url);

      // Check if user doesn't exist (404)
      if (!response && this.wasNotFound()) {
        console.log(`User u/${info.username} not found (deleted or suspended)`);
        userNotFound = true;
        break;
      }

      if (!response?.data?.children?.length) break;

      allComments.push(...response.data.children);
      after = response.data.after;

      if (!after) break; // No more pages
    }

    // Return special error result if user not found
    if (userNotFound) {
      return {
        url: '',
        title: '',
        author: info.username,
        subreddit: '',
        matchConfidence: 0,
        error: 'user_not_found',
      };
    }

    if (!allComments.length) {
      console.log(`No comments found for user ${info.username}`);
      return null;
    }

    console.log(`Found ${allComments.length} comments from u/${info.username}`);

    // Search through comments for matching text
    const searchText = (info.title || '') + ' ' + (info.bodySnippet || '');
    const searchKeywords = this.extractKeywords(searchText);
    // Normalize: remove newlines/extra whitespace that OCR might introduce
    const rawSnippet = (info.bodySnippet || info.title || '').toLowerCase().replace(/\s+/g, ' ').trim();



    // Lower threshold for short snippets (they're more likely to be partial matches)
    const threshold = rawSnippet.length < 80 ? 0.2 : 0.3;

    let bestMatch: RedditSearchResult | null = null;
    let bestScore = 0;
    let debugBestScore = 0;
    let debugBestComment = '';

    for (const child of allComments) {
      if (child.kind !== 't1') continue; // t1 = comment
      const comment = child.data;
      // Normalize comment body for comparison
      const commentBody = comment.body.toLowerCase().replace(/\s+/g, ' ').trim();

      // Compare comment body with extracted text
      const commentKeywords = this.extractKeywords(comment.body.substring(0, 300));
      if (!commentKeywords || !searchKeywords) continue;

      const textSimilarity = stringSimilarity.compareTwoStrings(
        searchKeywords.toLowerCase(),
        commentKeywords.toLowerCase()
      );

      // Also try direct text comparison
      const directSimilarity = stringSimilarity.compareTwoStrings(
        rawSnippet.substring(0, 150),
        commentBody.substring(0, 150)
      );

      // Check if comment contains the snippet (for short exact matches)
      // Try multiple substring lengths and also a word-based check
      let containsMatch = false;

      // Method 1: Full snippet (minus 5 chars to allow for trailing punctuation differences)
      const checkLen = Math.min(50, rawSnippet.length - 5);
      if (checkLen > 10) {
        const snippetToFind = rawSnippet.substring(0, checkLen);
        containsMatch = commentBody.includes(snippetToFind);
      }

      // Method 2: If no exact match, try a key phrase from the middle of the snippet
      // This helps when the start has common words like "true", "yeah", etc.
      if (!containsMatch && rawSnippet.length > 30) {
        // Extract a unique phrase - skip first 10 chars and take next 40
        const midSnippet = rawSnippet.substring(10, 50).trim();
        if (midSnippet.length > 15) {
          containsMatch = commentBody.includes(midSnippet);
        }
      }

      const containsBonus = containsMatch ? 0.5 : 0;
      const score = Math.max(textSimilarity, directSimilarity, containsBonus);

      // Track best score for debugging
      if (score > debugBestScore) {
        debugBestScore = score;
        debugBestComment = comment.body.substring(0, 60);
      }

      if (score > bestScore && score > threshold) {
        bestScore = score;
        bestMatch = {
          url: `https://www.reddit.com${comment.permalink}?context=3`,
          title: `Comment on: ${comment.link_title}`,
          author: comment.author,
          subreddit: comment.subreddit,
          matchConfidence: Math.min(score + 0.2, 1), // Boost confidence since we matched user
          isComment: true,
        };
        console.log(`  Found matching comment (score: ${score.toFixed(3)}): "${comment.body.substring(0, 60)}..."`);
      }
    }

    // Debug: show best score even if below threshold
    if (!bestMatch && debugBestScore > 0) {
      console.log(`  Best score was ${debugBestScore.toFixed(3)} (below ${threshold} threshold): "${debugBestComment}..."`);
    }

    return bestMatch;
  }
}
