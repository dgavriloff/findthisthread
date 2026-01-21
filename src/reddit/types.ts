export interface RedditSearchResult {
  url: string;
  title: string;
  author: string;
  subreddit: string;
  matchConfidence: number;
  isComment?: boolean;
}

export interface RedditPost {
  id: string;
  title: string;
  author: string;
  subreddit: string;
  permalink: string;
  selftext?: string;
  created_utc: number;
}

export interface RedditComment {
  id: string;
  body: string;
  author: string;
  subreddit: string;
  permalink: string;
  link_title: string; // Title of the parent post
  created_utc: number;
}

export interface RedditSearchResponse {
  kind: string;
  data: {
    children: Array<{
      kind: string;
      data: RedditPost;
    }>;
  };
}

export interface RedditUserCommentsResponse {
  kind: string;
  data: {
    children: Array<{
      kind: string; // "t1" for comments
      data: RedditComment;
    }>;
  };
}
