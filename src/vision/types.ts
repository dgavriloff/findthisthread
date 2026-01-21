export interface RedditPostInfo {
  subreddit: string | null;
  username: string | null;
  title: string | null;
  bodySnippet: string | null;
  timestamp: string | null;
  confidence: 'high' | 'medium' | 'low';
  error?: string;
}
