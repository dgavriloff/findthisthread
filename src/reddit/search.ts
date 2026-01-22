import stringSimilarity from 'string-similarity';
import { RedditPostInfo } from '../vision/types';
import { RedditSearchResult, RedditSearchResponse, RedditPost, RedditUserCommentsResponse, RedditComment } from './types';

const REDDIT_BASE = 'https://www.reddit.com';
const USER_AGENT = 'FindThisThread/1.0 (bot; contact: findthisthread@example.com)';
const REQUEST_DELAY_MS = 1500; // Delay between Reddit API requests to avoid rate limiting

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

  private async fetchReddit<T>(url: string, silent = false): Promise<T | null> {
    // Rate limiting: ensure minimum delay between requests
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < REQUEST_DELAY_MS) {
      await sleep(REQUEST_DELAY_MS - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
        },
      });

      // Handle rate limiting with retry
      if (response.status === 429) {
        console.log('Rate limited by Reddit, waiting 5 seconds...');
        await sleep(5000);
        this.lastRequestTime = Date.now();
        // Retry once
        const retryResponse = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
        });
        if (!retryResponse.ok) {
          if (!silent) console.error(`Reddit API error (${retryResponse.status}): ${url}`);
          return null;
        }
        return retryResponse.json();
      }

      if (!response.ok) {
        // 404s are expected when subreddits don't exist - only log other errors
        if (response.status !== 404 && !silent) {
          console.error(`Reddit API error (${response.status}): ${url}`);
        }
        return null;
      }

      return response.json();
    } catch (error) {
      if (!silent) console.error('Reddit fetch error:', error);
      return null;
    }
  }

  async findRedditPost(info: RedditPostInfo): Promise<RedditSearchResult | null> {
    // Try multiple search strategies - order matters!
    // Prioritize exact title matches first
    const strategies = [
      { name: 'exactTitle', fn: () => this.searchExactTitle(info) },
      { name: 'titleInSubreddit', fn: () => this.searchByTitleInSubreddit(info) },
      { name: 'authorInSubreddit', fn: () => this.searchByAuthorInSubreddit(info) },
      { name: 'globalWithAuthor', fn: () => this.searchGlobal(info) },
      { name: 'titleGlobal', fn: () => this.searchByTitleGlobal(info) },
      { name: 'bodySnippet', fn: () => this.searchByBodySnippet(info) },
      { name: 'userComments', fn: () => this.searchUserComments(info) },
    ];

    let bestResult: RedditSearchResult | null = null;

    for (const { name, fn } of strategies) {
      const result = await fn();
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

    // Fetch multiple pages of comments to handle active users
    const allComments: Array<{ kind: string; data: RedditComment }> = [];
    let after: string | null = null;
    const maxPages = 10; // Up to 1000 comments

    for (let page = 0; page < maxPages; page++) {
      const url = `${REDDIT_BASE}/user/${sanitizeRedditName(info.username)}/comments.json?sort=new&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      const response = await this.fetchReddit<RedditUserCommentsResponse>(url);

      if (!response?.data?.children?.length) break;

      allComments.push(...response.data.children);
      after = response.data.after;

      if (!after) break; // No more pages
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
